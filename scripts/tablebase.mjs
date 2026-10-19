#!/usr/bin/env node
/**
 * Solves small Dominion endgames exactly by retrograde analysis on the vector engine.
 *
 *   node scripts/tablebase.mjs [material ...]
 *
 * A material names Blue's units, then Red's, by rank letter (K King, G General,
 * C Captain, S Scout), e.g. KS-KG; both sides keep their King, since its capture
 * ends the game. The default is every endgame with up to three units plus the
 * four-unit duels with one extra unit per side; materials with two extra units
 * against a bare King can be named explicitly. Colour mirrors (KG-KS for KS-KG)
 * are not solved but read from the mirrored table. Tables that a capture leads
 * into are solved first, or loaded from tablebase/ when already there, so a long
 * run can be split into one material per invocation.
 *
 * A position is the units' tiles, their moved flags and the side to move, reduced
 * by the 12 symmetries of the hexagon to its smallest raw index:
 *   raw = ((tile_0 * 61 + tile_1) * 61 + ...) * 2^n + movedBits) * 2 + sideBit
 * with units in material order (signed ranks descending, Blue positive) and
 * sideBit 1 when Red is to move. Values are plies to the end of the game from
 * Blue's point of view: +d Blue wins, -d Red wins, 0 never resolved (Dominion has
 * no draw rule, so such games go on forever with best play).
 *
 * tablebase/<material>.tb holds the canonical raws as a bitset (Uint32 words,
 * bit raw & 31 of word raw >> 5) followed by their Int16 values in increasing raw
 * order; tablebase/<material>.json describes it. After solving, a sample of
 * positions, including non-canonical ones, is re-checked against its successors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const CHECK_SAMPLES = 20000;
const FORMAT = 2;
const DEFAULT_MATERIALS = ['K-K', 'KS-K', 'KC-K', 'KG-K', 'KS-KS', 'KC-KC', 'KG-KG', 'KS-KC', 'KS-KG', 'KC-KG'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'tablebase');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const V = await server.ssrLoadModule('/src/utils/vectorEngine.ts');
await server.close();

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

const log = (msg) => process.stderr.write(`  ${msg}\n`);
const seconds = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

// ---- Materials --------------------------------------------------------------
// A material is its signed ranks sorted descending, e.g. [4, 1, -4] for KS-K.
const LETTERS = { 1: 'S', 2: 'C', 3: 'G', 4: 'K' };
const RANK_OF = { S: 1, C: 2, G: 3, K: 4 };
const byRank = (a, b) => b - a;
const half = (ranks, g) => ranks.filter((v) => v * g > 0).map((v) => v * g).sort(byRank).map((v) => LETTERS[v]).join('');
const nameOf = (ranks) => `${half(ranks, 1)}-${half(ranks, -1)}`;
const mirrorName = (name) => name.split('-').reverse().join('-');

function parseMaterial(name) {
  const halves = name.toUpperCase().split('-');
  if (halves.length !== 2 || !halves.every((h) => /^K[GCS]*$/.test(h))) {
    throw new Error(`Bad material ${name}: expected e.g. KS-KG (King first on both sides)`);
  }
  const ranks = [...halves[0]].map((c) => RANK_OF[c]).concat([...halves[1]].map((c) => -RANK_OF[c])).sort(byRank);
  if (ranks.length > 4) throw new Error(`${name}: at most four units`);
  return ranks;
}

// ---- Indexing -----------------------------------------------------------------
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

const popcount = (x) => {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
};

/** Rank directory over the canonical bitset: prefix[w] = canonical raws below word w. */
function prefixOf(bits) {
  const prefix = new Int32Array(bits.length + 1);
  for (let w = 0; w < bits.length; w++) prefix[w + 1] = prefix[w] + popcount(bits[w]);
  return prefix;
}

/** Calls fn(raw) for every canonical raw in increasing order (= increasing id). */
function forEachCanonical(table, fn) {
  const { bits } = table;
  for (let w = 0; w < bits.length; w++) {
    for (let word = bits[w]; word; word &= word - 1) fn(w * 32 + (31 - Math.clz32(word & -word)));
  }
}

const idOfRaw = (table, raw) => table.prefix[raw >>> 5] + popcount(table.bits[raw >>> 5] & ((1 << (raw & 31)) - 1));

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

/** Value of a position in any solved table, reading colour mirrors from their counterpart. */
function valueOf(units, sideBit) {
  const name = nameOf(units.map((x) => x[0]));
  const table = tables.get(name);
  if (table) return table.val[idOfUnits(table, units, sideBit)];
  const flipped = units.map(([v, p, m]) => [-v, p, m]).sort((a, b) => b[0] - a[0]);
  return -tables.get(mirrorName(name)).val[idOfUnits(tables.get(mirrorName(name)), flipped, sideBit ^ 1)];
}

function stateOf(ranks, tl, mv, side) {
  const u = new Int8Array(V.N), moved = new Uint8Array(V.N);
  for (let i = 0; i < ranks.length; i++) { u[PT[tl[i]]] = ranks[i]; moved[PT[tl[i]]] = mv[i]; }
  return { u, moved, I: V.influenceOf(u), side, winner: 0, round: 0, h1: 0, h2: 0 };
}

const tables = new Map();

/**
 * Calls onEdge(id) for successors in the same table, and onKnown(sign, plies) for
 * the end of the game (plies 0) or a capture into a solved table (sign 0: unresolved).
 */
function forEachSuccessor(table, s, onEdge, onKnown) {
  for (const m of V.legalMoves(s)) {
    const ns = V.applyMove(s, m);
    if (ns.winner) { onKnown(ns.winner, 0); continue; }
    const units = unitsOf(ns), sideBit = ns.side === 1 ? 0 : 1;
    if (units.length === table.ix.n) onEdge(idOfUnits(table, units, sideBit));
    else {
      const v = valueOf(units, sideBit);
      onKnown(Math.sign(v), Math.abs(v));
    }
  }
}

const distinct = (tl) => {
  for (let i = 0; i < tl.length; i++) for (let j = 0; j < i; j++) if (tl[i] === tl[j]) return false;
  return true;
};

// Growable Int32 list in 64 MB chunks (the move lists of four-unit tables run to 10^8)
class IntList {
  chunks = [];
  length = 0;
  push(v) {
    const k = this.length >>> 24;
    if (k === this.chunks.length) this.chunks.push(new Int32Array(1 << 24));
    this.chunks[k][this.length++ & 0xffffff] = v;
  }
  get(i) { return this.chunks[i >>> 24][i & 0xffffff]; }
}

function solve(ranks) {
  const started = Date.now(), name = nameOf(ranks);
  const ix = indexer(ranks), n = ix.n;
  const tl = new Int32Array(n), mv = new Uint8Array(n);

  // Canonical positions
  let t = Date.now();
  const bits = new Uint32Array(Math.ceil(ix.size / 32));
  const block = ix.size / P; // raws per tile of the first unit
  for (const p0 of ORBIT_MIN) {
    for (let raw = p0 * block; raw < (p0 + 1) * block; raw++) {
      const sideBit = ix.decode(raw, tl, mv);
      if (distinct(tl) && ix.canonical(tl, mv, sideBit) === raw) bits[raw >>> 5] |= 1 << (raw & 31);
    }
  }
  const prefix = prefixOf(bits), nodes = prefix[bits.length];
  const table = { ranks, ix, bits, prefix, val: new Int16Array(nodes) };
  log(`${name}: ${nodes} positions (${seconds(t)})`);

  // Forward pass: in-table moves, plus the best and worst known results per position
  t = Date.now();
  const NONE = 0x7fff;
  const sideOf = new Int8Array(nodes), remaining = new Uint8Array(nodes);
  const winMin = new Int16Array(nodes).fill(NONE), lossMax = new Int16Array(nodes).fill(-1);
  const first = new Int32Array(nodes + 1), succ = new IntList();
  let x = 0;
  forEachCanonical(table, (raw) => {
    const side = ix.decode(raw, tl, mv) ? -1 : 1;
    let open = 0;
    sideOf[x] = side;
    first[x] = succ.length;
    forEachSuccessor(table, stateOf(ranks, tl, mv, side), (y) => succ.push(y), (sign, d) => {
      if (!sign) open = 1;
      else if (sign === side) winMin[x] = Math.min(winMin[x], d);
      else lossMax[x] = Math.max(lossMax[x], d);
    });
    // An unresolved capture keeps the count above zero, so the position is never lost
    remaining[x] = succ.length - first[x] + open;
    if (succ.length - first[x] + open > 255) throw new Error('more than 255 moves');
    if (++x % 1000000 === 0) log(`${name}: ${x / 1e6}M / ${(nodes / 1e6).toFixed(1)}M positions expanded (${seconds(t)})`);
  });
  first[nodes] = succ.length;
  const edges = succ.length;
  log(`${name}: ${edges} in-table moves (${seconds(t)})`);

  // Predecessor lists (CSR)
  const start = new Int32Array(nodes + 1);
  for (let e = 0; e < edges; e++) start[succ.get(e) + 1]++;
  for (let i = 0; i < nodes; i++) start[i + 1] += start[i];
  const preds = new Int32Array(edges), fill = start.slice(0, nodes);
  for (let from = 0; from < nodes; from++) for (let e = first[from]; e < first[from + 1]; e++) preds[fill[succ.get(e)]++] = from;
  succ.chunks = null;

  // Retrograde in layers of increasing distance d: a win takes the shortest route,
  // a loss the longest one. A position whose last open move fails at layer d is
  // lost at max(d, its worst known loss) + 1, unless a known win is still pending.
  t = Date.now();
  const val = table.val;
  let horizon = 0;
  const resolve = (x, v) => {
    val[x] = v;
    horizon = Math.max(horizon, Math.abs(v));
  };
  for (let x = 0; x < nodes; x++) {
    if (winMin[x] !== NONE) horizon = Math.max(horizon, winMin[x]);
    else if (!remaining[x]) resolve(x, -sideOf[x] * (lossMax[x] + 1));
  }
  for (let d = 0; d <= horizon; d++) {
    for (let x = 0; x < nodes; x++) if (!val[x] && winMin[x] === d) resolve(x, sideOf[x] * (d + 1));
    if (!d) continue;
    for (let y = 0; y < nodes; y++) {
      const v = val[y];
      if (v !== d && v !== -d) continue;
      const sign = v > 0 ? 1 : -1;
      for (let i = start[y]; i < start[y + 1]; i++) {
        const x = preds[i];
        if (val[x]) continue;
        if (sign === sideOf[x]) resolve(x, sign * (d + 1));
        else if (--remaining[x] === 0 && winMin[x] === NONE) resolve(x, sign * (Math.max(d, lossMax[x]) + 1));
      }
    }
  }
  log(`${name}: retrograde ${horizon} plies (${seconds(t)})`);
  tables.set(name, table);

  // Stats
  let blue = 0, red = 0, longest = 0;
  for (const v of val) {
    if (v > 0) blue++;
    else if (v < 0) red++;
    longest = Math.max(longest, Math.abs(v));
  }
  const errors = check(table);
  const pct = (k) => `${((100 * k) / nodes).toFixed(1)}%`.padStart(6);
  console.log(
    `${name.padEnd(6)} nodes ${String(nodes).padStart(9)}  edges ${String(edges).padStart(10)}` +
      `  Blue ${pct(blue)}  Red ${pct(red)}  open ${pct(nodes - blue - red)}  longest ${String(longest).padStart(3)}` +
      `  check ${errors ? `${errors} ERRORS` : 'ok'}  ${seconds(started)}`,
  );
  write(table);
  return errors;
}

/** Re-derives random positions (any symmetry) from their successors and counts mismatches. */
function check(table) {
  const { ranks, ix } = table;
  const tl = new Int32Array(ix.n), mv = new Uint8Array(ix.n);
  let errors = 0;
  for (let k = 0; k < CHECK_SAMPLES; k++) {
    const raw = Math.floor(Math.random() * ix.size);
    const sideBit = ix.decode(raw, tl, mv);
    if (!distinct(tl)) continue;
    const side = sideBit ? -1 : 1;
    let win = Infinity, loss = 0, open = false;
    const see = (sign, d) => {
      if (sign === side) win = Math.min(win, d);
      else if (sign) loss = Math.max(loss, d);
      else open = true;
    };
    forEachSuccessor(table, stateOf(ranks, tl, mv, side), (y) => see(Math.sign(table.val[y]), Math.abs(table.val[y])), see);
    const expected = win < Infinity ? side * (win + 1) : open ? 0 : -side * (loss + 1);
    if (table.val[idOfRaw(table, ix.canonical(tl, mv, sideBit))] !== expected) errors++;
  }
  return errors;
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

function load(name) {
  const metaPath = path.join(dir, `${name}.json`);
  if (!fs.existsSync(metaPath)) return false;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  if (meta.format !== FORMAT) return false;
  const buf = fs.readFileSync(path.join(dir, `${name}.tb`));
  const data = new Uint8Array(buf).buffer; // aligned copy
  const bits = new Uint32Array(data, 0, meta.words);
  tables.set(name, { ranks: meta.ranks, ix: indexer(meta.ranks), bits, prefix: prefixOf(bits), val: new Int16Array(data, meta.words * 4, meta.nodes) });
  log(`${name}: loaded`);
  return true;
}

/** Solves `ranks` (or loads it), after every table a capture leads into. */
function ensure(ranks) {
  const name = nameOf(ranks);
  if (tables.has(name) || tables.has(mirrorName(name)) || load(name) || load(mirrorName(name))) return 0;
  let errors = 0;
  for (let i = 0; i < ranks.length; i++) {
    if (Math.abs(ranks[i]) !== 4) errors += ensure(ranks.filter((_, j) => j !== i));
  }
  return errors + solve(ranks);
}

const names = process.argv.slice(2);
let errors = 0;
for (const name of names.length ? names : DEFAULT_MATERIALS) errors += ensure(parseMaterial(name));
process.exit(errors ? 1 : 0);
