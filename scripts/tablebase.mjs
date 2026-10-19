#!/usr/bin/env node
/**
 * Solves small Dominion endgames exactly by retrograde analysis on the vector engine.
 *
 *   node scripts/tablebase.mjs [maxUnits]
 *
 * Every material with both Kings and at most maxUnits units (default 3) is solved,
 * smaller materials first so that captures resolve through finished tables.
 * A position is the units' tiles, their moved flags and the side to move, reduced
 * by the 12 symmetries of the hexagon. Values are plies to the end of the game
 * from Blue's point of view: +d Blue wins, -d Red wins, 0 never resolved (Dominion
 * has no draw rule, so these games go on forever with best play).
 *
 * Each table is written to tablebase/<material>.tb: Int32 raw indices of the
 * canonical positions followed by their Int16 values, with the layout in
 * tablebase/<material>.json. A sample of positions, including non-canonical ones,
 * is re-checked against its successors after solving.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const CHECK_SAMPLES = 20000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const V = await server.ssrLoadModule('/src/utils/vectorEngine.ts');
await server.close();

const MAX_UNITS = Number(process.argv[2] ?? 3);
if (!(MAX_UNITS >= 2 && MAX_UNITS <= 3)) {
  console.error('maxUnits must be 2 or 3 (the dense index does not fit in memory beyond that)');
  process.exit(1);
}

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

// ---- Materials --------------------------------------------------------------
// A material is its signed ranks sorted descending, e.g. [4, 1, -4] (King and Scout vs King).
const LETTERS = { 1: 'S', 2: 'C', 3: 'G', 4: 'K' };
const half = (ranks, g) => ranks.filter((v) => v * g > 0).map((v) => v * g).sort((a, b) => b - a).map((v) => LETTERS[v]).join('');
const nameOf = (ranks) => `${half(ranks, 1)}-${half(ranks, -1)}`;

function materials(maxUnits) {
  const out = [[4, -4]];
  const extras = [1, 2, 3, -1, -2, -3];
  if (maxUnits >= 3) for (const x of extras) out.push([4, x, -4].sort((a, b) => b - a));
  return out;
}

// ---- Indexing -----------------------------------------------------------------
// raw = ((tile_0 * P + tile_1) * P + ...) * 2^n + movedBits) * 2 + sideBit
function indexer(ranks) {
  const n = ranks.length, M = 1 << n;
  const size = P ** n * M * 2;
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
    size,
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

function stateOf(ranks, tl, mv, side) {
  const u = new Int8Array(V.N), moved = new Uint8Array(V.N);
  for (let i = 0; i < ranks.length; i++) { u[PT[tl[i]]] = ranks[i]; moved[PT[tl[i]]] = mv[i]; }
  return { u, moved, I: V.influenceOf(u), side, winner: 0, round: 0, h1: 0, h2: 0 };
}

const tables = new Map();

/**
 * Calls onEdge(id) for successors in the same table, and onKnown(sign, plies) for
 * the end of the game (plies 0) or a capture into a solved table (sign 0: unresolved).
 * Returns the number of legal moves.
 */
function forEachSuccessor(table, s, onEdge, onKnown) {
  const moves = V.legalMoves(s);
  for (const m of moves) {
    const ns = V.applyMove(s, m);
    if (ns.winner) { onKnown(ns.winner, 0); continue; }
    const units = [];
    for (let p = 0; p < P; p++) if (ns.u[PT[p]]) units.push([ns.u[PT[p]], p, ns.moved[PT[p]]]);
    units.sort((a, b) => b[0] - a[0]);
    const tl = Int32Array.from(units, (x) => x[1]), mv = Uint8Array.from(units, (x) => x[2]);
    const sideBit = ns.side === 1 ? 0 : 1;
    if (units.length === table.ix.n) onEdge(table.idOf[table.ix.canonical(tl, mv, sideBit)]);
    else {
      const v = lookup(tables.get(nameOf(units.map((x) => x[0]))), tl, mv, sideBit);
      onKnown(Math.sign(v), Math.abs(v));
    }
  }
  return moves.length;
}

const lookup = (table, tl, mv, sideBit) => table.val[table.idOf[table.ix.canonical(tl, mv, sideBit)]];

const distinct = (tl) => {
  for (let i = 0; i < tl.length; i++) for (let j = 0; j < i; j++) if (tl[i] === tl[j]) return false;
  return true;
};

function solve(ranks) {
  const started = Date.now();
  const ix = indexer(ranks), n = ix.n;
  const tl = new Int32Array(n), mv = new Uint8Array(n);

  // Canonical positions
  const idOf = new Int32Array(ix.size).fill(-1);
  const rawList = [];
  for (let raw = 0; raw < ix.size; raw++) {
    const sideBit = ix.decode(raw, tl, mv);
    if (distinct(tl) && ix.canonical(tl, mv, sideBit) === raw) { idOf[raw] = rawList.length; rawList.push(raw); }
  }
  const nodes = rawList.length;
  const rawOf = Int32Array.from(rawList);
  const table = { ranks, ix, idOf, rawOf, val: new Int16Array(nodes) };

  // Forward pass: in-table edges, known results seeded into the bucket queue
  const sideOf = new Int8Array(nodes), remaining = new Int32Array(nodes);
  const edgeFrom = [], edgeTo = [];
  const buckets = []; // buckets[d]: events "a successor of x ends in d plies with winner sign"
  const push = (d, x, sign) => (buckets[d] ??= []).push(x * 2 + (sign === 1 ? 0 : 1));
  for (let x = 0; x < nodes; x++) {
    const side = ix.decode(rawOf[x], tl, mv) ? -1 : 1;
    sideOf[x] = side;
    remaining[x] = forEachSuccessor(
      table,
      stateOf(ranks, tl, mv, side),
      (y) => { edgeFrom.push(x); edgeTo.push(y); },
      (sign, d) => { if (sign) push(d, x, sign); },
    );
  }

  // Predecessor lists (CSR)
  const start = new Int32Array(nodes + 1);
  for (const y of edgeTo) start[y + 1]++;
  for (let i = 0; i < nodes; i++) start[i + 1] += start[i];
  const preds = new Int32Array(edgeTo.length), fill = start.slice(0, nodes);
  for (let e = 0; e < edgeTo.length; e++) preds[fill[edgeTo[e]]++] = edgeFrom[e];

  // Retrograde: events in increasing distance, so a win takes the shortest route
  // and a loss the longest one
  const val = table.val;
  for (let d = 0; d < buckets.length; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (const e of b) {
      const x = e >> 1, sign = e & 1 ? -1 : 1;
      if (val[x]) continue;
      if (sign === sideOf[x] || --remaining[x] === 0) {
        val[x] = sign * (d + 1);
        for (let i = start[x]; i < start[x + 1]; i++) push(d + 1, preds[i], sign);
      }
    }
    buckets[d] = null;
  }
  tables.set(nameOf(ranks), table);

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
    `${nameOf(ranks).padEnd(6)} nodes ${String(nodes).padStart(8)}  edges ${String(edgeTo.length).padStart(9)}` +
      `  Blue ${pct(blue)}  Red ${pct(red)}  open ${pct(nodes - blue - red)}  longest ${String(longest).padStart(3)}` +
      `  check ${errors ? `${errors} ERRORS` : 'ok'}  ${((Date.now() - started) / 1000).toFixed(1)}s`,
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
    if (lookup(table, tl, mv, sideBit) !== expected) errors++;
  }
  return errors;
}

function write(table) {
  const dir = path.join(root, 'tablebase');
  fs.mkdirSync(dir, { recursive: true });
  const name = nameOf(table.ranks);
  fs.writeFileSync(
    path.join(dir, `${name}.tb`),
    Buffer.concat([Buffer.from(table.rawOf.buffer), Buffer.from(table.val.buffer)]),
  );
  fs.writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify({
      ranks: table.ranks,
      nodes: table.rawOf.length,
      tiles: PT.map((t) => V.coords[t]),
      layout: 'Int32 raw[nodes] then Int16 value[nodes]; raw = ((tile_0*61 + tile_1)*61 + ...)*2^n + movedBits)*2 + sideBit (1 = Red to move); value = plies to the end, + Blue wins, - Red wins, 0 unresolved',
    }, null, 1),
  );
}

let errors = 0;
for (const ranks of materials(MAX_UNITS)) errors += solve(ranks);
process.exit(errors ? 1 : 0);
