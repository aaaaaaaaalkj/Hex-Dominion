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
 * into are solved first, or loaded from tablebase/ (or $TABLEBASE_DIR) when already there, so a long
 * run can be split into one material per invocation.
 *
 * Indexing and the file format are described in scripts/lib/tablebase-store.mjs.
 * After solving, a sample of positions, including non-canonical ones, is
 * re-checked against its successors.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createStore, forEachCanonical, idOfRaw, mirrorName, nameOf, parseMaterial, prefixOf } from './lib/tablebase-store.mjs';

const CHECK_SAMPLES = 20000;
const DEFAULT_MATERIALS = ['K-K', 'KS-K', 'KC-K', 'KG-K', 'KS-KS', 'KC-KC', 'KG-KG', 'KS-KC', 'KS-KG', 'KC-KG'];
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

const store = createStore(V, process.env.TABLEBASE_DIR ?? path.join(root, 'tablebase'));
const { P, ORBIT_MIN, indexer, unitsOf, idOfUnits, stateOf, tables, valueOf } = store;

const log = (msg) => process.stderr.write(`  ${msg}\n`);
const seconds = (t) => `${((Date.now() - t) / 1000).toFixed(1)}s`;

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
  store.write(table);
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

/** Solves `ranks` (or loads it), after every table a capture leads into. */
function ensure(ranks) {
  const name = nameOf(ranks);
  if (tables.has(name) || tables.has(mirrorName(name))) return 0;
  if (store.load(name) || store.load(mirrorName(name))) {
    log(`${name}: loaded`);
    return 0;
  }
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
