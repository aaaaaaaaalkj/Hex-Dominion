#!/usr/bin/env node
/**
 * Plays two Dominion strategies against each other on the vector engine.
 *
 *   node scripts/ai-match.mjs <A> <B> [pairs] [openingPlies] [positions.bin]
 *
 * Strategies:
 *   random                         uniformly random legal moves
 *   search:<ms>[:depth=N,forced=R] the alpha-beta engine (vectorEngine.ts) with <ms> per move,
 *                                  searching at most N plies deep; units of rank >= R (4 King,
 *                                  3 General) may not stand pat in the quiescence search
 *   net:<ms>[:depth=N,units=N,forced=R,file=F]
 *                                  the alpha-beta engine scoring positions with the value
 *                                  network (valueNet.ts) where at most N units are left, and
 *                                  with the hand-written evaluation elsewhere; the weights
 *                                  are F, $VALUE_NET or ml/checkpoints/value-net.json (ml/export.py)
 *   conc[:key=value,...]           the concentration bot (concentrationAI.ts); keys override
 *                                  DEFAULT_WEIGHTS, e.g. conc:mobility=8,plies=2
 *   hybrid:<ms>[:key=value,...]    the alpha-beta engine scoring positions with the
 *                                  concentration bot's evaluation
 *
 * Each pair starts from the same random opening (openingPlies random moves,
 * default 4) and is played twice with colours swapped. With a positions file
 * (ml/hexdata.py RECORD, e.g. from scripts/label-positions.mjs) the openings
 * start from random positions of that file instead of the initial setup. A game
 * is drawn after MAX_PLIES. Prints A's wins/draws/losses and score.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const MAX_PLIES = 300;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const { generateGameMap } = await server.ssrLoadModule('/src/utils/mapGenerator.ts');
const V = await server.ssrLoadModule('/src/utils/vectorEngine.ts');
const C = await server.ssrLoadModule('/src/utils/concentrationAI.ts');
const NET = await server.ssrLoadModule('/src/utils/valueNet.ts');

const options = (arg) => Object.fromEntries(arg.split(',').filter(Boolean).map((kv) => kv.split('=')));
const searchOptions = (arg) => {
  const { depth = 30, forced } = options(arg);
  return { maxDepth: Number(depth), forcedRank: forced ? Number(forced) : undefined };
};

function loadNet(name = process.env.VALUE_NET ?? path.join(root, 'ml/checkpoints/value-net.json')) {
  const file = JSON.parse(fs.readFileSync(name, 'utf8'));
  const net = NET.createValueNet(file);
  const error = NET.selfTest(file, net);
  if (Math.abs(error) > 1e-4) throw new Error(`Value network self-test off by ${error}`);
  return net;
}

function weights(arg) {
  const w = { ...C.DEFAULT_WEIGHTS };
  for (const kv of arg.split(',').filter(Boolean)) {
    const [k, v] = kv.split('=');
    if (!(k in w)) throw new Error(`Unknown weight ${k}`);
    w[k] = Number(v);
  }
  return w;
}

function strategy(spec) {
  const [kind, arg = '', arg2 = ''] = spec.split(':');
  if (kind === 'random') return (s) => { const ms = V.legalMoves(s); return ms[Math.floor(Math.random() * ms.length)]; };
  if (kind === 'search') {
    const o = searchOptions(arg2);
    return (s) => V.chooseMove(s, Number(arg || 50), o);
  }
  if (kind === 'net') {
    const { units = Infinity, file } = options(arg2);
    const o = { ...searchOptions(arg2), evaluator: NET.netEvaluator(loadNet(file), Number(units)) };
    return (s) => V.chooseMove(s, Number(arg || 50), o);
  }
  if (kind === 'conc') {
    const w = weights(arg);
    return (s) => C.chooseMove(s, w).move;
  }
  if (kind === 'hybrid') {
    const evaluator = C.asEvaluator(weights(arg2));
    return (s) => V.chooseMove(s, Number(arg || 50), { evaluator }).move;
  }
  throw new Error(`Unknown strategy ${spec}`);
}

const [specA, specB, pairs = '10', openingPlies = '4', positionsFile] = process.argv.slice(2);
if (!specA || !specB) {
  console.log('usage: node scripts/ai-match.mjs <A> <B> [pairs] [openingPlies] [positions.bin]');
  process.exit(1);
}
const A = strategy(specA), B = strategy(specB);
const { units } = generateGameMap('dominion');
const start = V.fromGameState({ mode: 'dominion', units, currentTurn: 'player', roundNumber: 1, winner: null });
const positions = positionsFile ? fs.readFileSync(positionsFile) : null;

// A random position of the positions file (128-byte records: u[61], moved[61], side, units, value)
function storedPosition() {
  const o = 128 * Math.floor(Math.random() * (positions.length / 128));
  const u = new Int8Array(V.N), moved = new Uint8Array(V.N);
  V.playableTiles.forEach((t, p) => { u[t] = positions.readInt8(o + p); moved[t] = positions[o + 61 + p]; });
  return V.makeState(u, moved, positions.readInt8(o + 122));
}

function play(opening, blue, red) {
  let s = opening, plies = 0;
  while (!s.winner && plies++ < MAX_PLIES) s = V.applyMove(s, (s.side === 1 ? blue : red)(s));
  return { winner: s.winner, plies };
}

// Strategies return a move or a search result ({ move, depth })
const time = { A: 0, B: 0 }, moves = { A: 0, B: 0 }, depth = { A: 0, B: 0 };
const timed = (fn, who) => (s) => {
  const t = performance.now();
  const m = fn(s);
  time[who] += performance.now() - t;
  moves[who]++;
  if (typeof m === 'number') return m;
  depth[who] += m.depth;
  return m.move;
};
const tA = timed(A, 'A'), tB = timed(B, 'B');
let w = 0, d = 0, l = 0, totalPlies = 0;
for (let p = 0; p < Number(pairs); p++) {
  let opening = positions ? storedPosition() : start;
  for (let i = 0; i < Number(openingPlies) && !opening.winner; i++) {
    const ms = V.legalMoves(opening);
    opening = V.applyMove(opening, ms[Math.floor(Math.random() * ms.length)]);
  }
  for (const aSide of [1, -1]) {
    const r = aSide === 1 ? play(opening, tA, tB) : play(opening, tB, tA);
    totalPlies += r.plies;
    if (!r.winner) d++;
    else if (r.winner === aSide) w++;
    else l++;
  }
  console.error(`pair ${p + 1}/${pairs}: +${w} =${d} -${l}`);
}
const n = w + d + l;
console.log(
  `${specA} vs ${specB}: +${w} =${d} -${l}  score ${(100 * (w + d / 2) / n).toFixed(0)}%  ` +
    `avg ${(totalPlies / n).toFixed(0)} plies  ms/move A ${(time.A / moves.A).toFixed(1)} B ${(time.B / moves.B).toFixed(1)}` +
    `  depth A ${(depth.A / moves.A).toFixed(1)} B ${(depth.B / moves.B).toFixed(1)}`
);
await server.close();
