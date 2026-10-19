/**
 * Endgame tablebase storage shared by the solver (scripts/tablebase.mjs) and the
 * position labeller (scripts/label-positions.mjs): position indexing under the
 * 12 hexagon symmetries, table files, lookups and a search probe.
 *
 * A position is the units' tiles, their moved flags and the side to move, reduced
 * to its smallest raw index over the symmetries:
 *   raw = ((tile_0 * 61 + tile_1) * 61 + ...) * 2^n + movedBits) * 2 + sideBit
 * with units in material order (signed ranks descending, Blue positive) and
 * sideBit 1 when Red is to move. Values are plies to the end of the game from
 * Blue's point of view: +d Blue wins, -d Red wins, 0 never resolved.
 *
 * <dir>/<material>.tb holds the canonical raws as a bitset (Uint32 words, bit
 * raw & 31 of word raw >> 5) followed by their Int16 values in increasing raw
 * order; <dir>/<material>.json describes it.
 */
import fs from 'node:fs';
import path from 'node:path';

export const FORMAT = 2;
const LETTERS = { 1: 'S', 2: 'C', 3: 'G', 4: 'K' };
const RANK_OF = { S: 1, C: 2, G: 3, K: 4 };
const byRank = (a, b) => b - a;
const half = (ranks, g) => ranks.filter((v) => v * g > 0).map((v) => v * g).sort(byRank).map((v) => LETTERS[v]).join('');

/** Material name of signed ranks, Blue first: [4, 1, -2, -4] -> 'KS-KC'. */
export const nameOf = (ranks) => `${half(ranks, 1)}-${half(ranks, -1)}`;
export const mirrorName = (name) => name.split('-').reverse().join('-');

/** Signed ranks sorted descending of a material name such as 'KS-KG'. */
export function parseMaterial(name) {
  const halves = name.toUpperCase().split('-');
  if (halves.length !== 2 || !halves.every((h) => /^K[GCS]*$/.test(h))) {
    throw new Error(`Bad material ${name}: expected e.g. KS-KG (King first on both sides)`);
  }
  const ranks = [...halves[0]].map((c) => RANK_OF[c]).concat([...halves[1]].map((c) => -RANK_OF[c])).sort(byRank);
  if (ranks.length > 4) throw new Error(`${name}: at most four units`);
  return ranks;
}

export const popcount = (x) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
};

/** Rank directory over a canonical bitset: prefix[w] = canonical raws below word w. */
export function prefixOf(bits) {
  const prefix = new Int32Array(bits.length + 1);
  for (let w = 0; w < bits.length; w++) prefix[w + 1] = prefix[w] + popcount(bits[w]);
  return prefix;
}

export const idOfRaw = (table, raw) => table.prefix[raw >>> 5] + popcount(table.bits[raw >>> 5] & ((1 << (raw & 31)) - 1));

/** Calls fn(raw) for every canonical raw in increasing order (= increasing id). */
export function forEachCanonical(table, fn) {
  const { bits } = table;
  for (let w = 0; w < bits.length; w++) {
    for (let word = bits[w]; word; word &= word - 1) fn(w * 32 + (31 - Math.clz32(word & -word)));
  }
}

/** Tablebase storage over the vector engine module V, with tables in `dir`. */
export function createStore(V, dir) {
  const PT = V.playableTiles;
  const P = PT.length; // 61
  const pIndex = new Int32Array(V.N).fill(-1);
  PT.forEach((t, p) => (pIndex[t] = p));

  // The 12 symmetries of the hexagon as permutations of the playable tiles
  const SYMS = [];
  for (let refl = 0; refl < 2; refl++) {
    for (let rot = 0; rot < 6; rot++) {
      SYMS.push(Int32Array.from(PT, (t) => {
        let { q, r } = V.coords[t];
        if (refl) [q, r] = [r, q];
        for (let k = 0; k < rot; k++) [q, r] = [-r, q + r];
        return pIndex[V.tileIndex(q, r)];
      }));
    }
  }
  // A canonical position starts with the smallest tile of its first unit's orbit
  const ORBIT_MIN = PT.map((_, p) => p).filter((p) => SYMS.every((g) => g[p] >= p));

  function indexer(ranks) {
    const n = ranks.length, M = 1 << n;
    const groups = []; // runs of identical units, which are interchangeable
    for (let i = 0; i < n; ) {
      let j = i;
      while (j < n && ranks[j] === ranks[i]) j++;
      if (j - i > 1) groups.push([i, j]);
      i = j;
    }
    const tt = new Int32Array(n), mm = new Uint8Array(n);
    const encode = (tl, mv, sideBit) => {
      let x = 0, mb = 0;
      for (let i = 0; i < n; i++) { x = x * P + tl[i]; mb |= mv[i] << i; }
      return (x * M + mb) * 2 + sideBit;
    };
    return {
      n,
      size: P ** n * M * 2,
      decode(raw, tl, mv) {
        const sideBit = raw % 2;
        raw = (raw - sideBit) / 2;
        const mb = raw % M;
        raw = (raw - mb) / M;
        for (let i = n - 1; i >= 0; i--) { tl[i] = raw % P; raw = (raw - tl[i]) / P; mv[i] = (mb >> i) & 1; }
        return sideBit;
      },
      canonical(tl, mv, sideBit) {
        let best = Infinity;
        for (const g of SYMS) {
          for (let i = 0; i < n; i++) { tt[i] = g[tl[i]]; mm[i] = mv[i]; }
          for (const [a, b] of groups) {
            for (let i = a + 1; i < b; i++) {
              for (let j = i; j > a && tt[j - 1] > tt[j]; j--) {
                [tt[j - 1], tt[j]] = [tt[j], tt[j - 1]];
                [mm[j - 1], mm[j]] = [mm[j], mm[j - 1]];
              }
            }
          }
          const x = encode(tt, mm, sideBit);
          if (x < best) best = x;
        }
        return best;
      },
    };
  }

  // Units of a state as [signed rank, tile, moved], in material order
  function unitsOf(s) {
    const units = [];
    for (let p = 0; p < P; p++) if (s.u[PT[p]]) units.push([s.u[PT[p]], p, s.moved[PT[p]]]);
    return units.sort((a, b) => b[0] - a[0]);
  }

  const scratchTl = new Int32Array(4), scratchMv = new Uint8Array(4);
  function idOfUnits(table, units, sideBit) {
    units.forEach(([, p, m], i) => { scratchTl[i] = p; scratchMv[i] = m; });
    return idOfRaw(table, table.ix.canonical(scratchTl, scratchMv, sideBit));
  }

  function stateOf(ranks, tl, mv, side) {
    const u = new Int8Array(V.N), moved = new Uint8Array(V.N);
    for (let i = 0; i < ranks.length; i++) { u[PT[tl[i]]] = ranks[i]; moved[PT[tl[i]]] = mv[i]; }
    return { u, moved, I: V.influenceOf(u), side, winner: 0, round: 0, h1: 0, h2: 0 };
  }

  const tables = new Map();

  /** Value of a position in any loaded table, reading colour mirrors from their counterpart. */
  function valueOf(units, sideBit) {
    const name = nameOf(units.map((x) => x[0]));
    const table = tables.get(name);
    if (table) return table.val[idOfUnits(table, units, sideBit)];
    const mirror = tables.get(mirrorName(name));
    const flipped = units.map(([v, p, m]) => [-v, p, m]).sort((a, b) => b[0] - a[0]);
    return -mirror.val[idOfUnits(mirror, flipped, sideBit ^ 1)];
  }

  function write(table) {
    fs.mkdirSync(dir, { recursive: true });
    const name = nameOf(table.ranks);
    fs.writeFileSync(path.join(dir, `${name}.tb`), Buffer.concat([Buffer.from(table.bits.buffer), Buffer.from(table.val.buffer)]));
    fs.writeFileSync(
      path.join(dir, `${name}.json`),
      JSON.stringify({
        format: FORMAT,
        ranks: table.ranks,
        nodes: table.val.length,
        words: table.bits.length,
        tiles: PT.map((t) => V.coords[t]),
        layout:
          'Uint32 bitset[words] of canonical raws, then Int16 value[nodes] in increasing raw order; ' +
          'raw = ((tile_0*61 + tile_1)*61 + ...)*2^n + movedBits)*2 + sideBit (1 = Red to move); ' +
          'value = plies to the end, + Blue wins, - Red wins, 0 unresolved',
      }, null, 1),
    );
  }

  /** Loads a table from disk; false if it is missing or in an older format. */
  function load(name) {
    const metaPath = path.join(dir, `${name}.json`);
    if (!fs.existsSync(metaPath)) return false;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (meta.format !== FORMAT) return false;
    const data = new Uint8Array(fs.readFileSync(path.join(dir, `${name}.tb`))).buffer; // aligned copy
    const bits = new Uint32Array(data, 0, meta.words);
    tables.set(name, { ranks: meta.ranks, ix: indexer(meta.ranks), bits, prefix: prefixOf(bits), val: new Int16Array(data, meta.words * 4, meta.nodes) });
    return true;
  }

  /** True when the material (or its colour mirror) is loaded, loading it on first use. */
  const missing = new Set();
  function available(name) {
    if (tables.has(name) || tables.has(mirrorName(name))) return true;
    if (missing.has(name)) return false;
    if (load(name) || load(mirrorName(name))) return true;
    missing.add(name);
    return false;
  }

  /**
   * Search probe (vectorEngine's Prober): the exact score from Red's point of view
   * of a position with at most four units, or null when no table covers it. A win
   * in d plies scores TB_WIN - d, so quicker wins rank higher; never-resolved is 0.
   */
  const TB_WIN = V.WIN - 1000;
  function probe(s) {
    let count = 0;
    for (let p = 0; p < P; p++) if (s.u[PT[p]] && ++count > 4) return null;
    const units = unitsOf(s);
    if (!available(nameOf(units.map((x) => x[0])))) return null;
    const v = valueOf(units, s.side === 1 ? 0 : 1);
    return v === 0 ? 0 : -Math.sign(v) * (TB_WIN - Math.abs(v));
  }

  return { P, PT, SYMS, ORBIT_MIN, indexer, unitsOf, idOfUnits, stateOf, tables, valueOf, write, load, probe, TB_WIN };
}
