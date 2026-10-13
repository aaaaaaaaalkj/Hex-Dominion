#!/usr/bin/env node
/**
 * Plays two Dominion strategies against each other on the vector engine.
 *
 *   node scripts/ai-match.mjs <A> <B> [pairs] [openingPlies]
 *
 * Strategies:
 *   random                         uniformly random legal moves
 *   search:<ms>                    the alpha-beta engine (vectorEngine.ts) with <ms> per move
 *   conc[:key=value,...]           the concentration bot (concentrationAI.ts); keys override
 *                                  DEFAULT_WEIGHTS, e.g. conc:mobility=8,plies=2
 *
 * Each pair starts from the same random opening (openingPlies random moves,
 * default 4) and is played twice with colours swapped. A game is drawn after
 * MAX_PLIES. Prints A's wins/draws/losses and score.
 */
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

function strategy(spec) {
  const [kind, arg = ''] = spec.split(':');
  if (kind === 'random') return (s) => { const ms = V.legalMoves(s); return ms[Math.floor(Math.random() * ms.length)]; };
  if (kind === 'search') return (s) => V.chooseMove(s, Number(arg || 50)).move;
  if (kind === 'conc') {
    const w = { ...C.DEFAULT_WEIGHTS };
    for (const kv of arg.split(',').filter(Boolean)) {
      const [k, v] = kv.split('=');
      if (!(k in w)) throw new Error(`Unknown weight ${k}`);
      w[k] = Number(v);
    }
    return (s) => C.chooseMove(s, w).move;
  }
  throw new Error(`Unknown strategy ${spec}`);
}

const [specA, specB, pairs = '10', openingPlies = '4'] = process.argv.slice(2);
if (!specA || !specB) {
  console.log('usage: node scripts/ai-match.mjs <A> <B> [pairs] [openingPlies]');
  process.exit(1);
}
const A = strategy(specA), B = strategy(specB);
const { units } = generateGameMap('dominion');
const start = V.fromGameState({ mode: 'dominion', units, currentTurn: 'player', roundNumber: 1, winner: null });

function play(opening, blue, red) {
  let s = opening, plies = 0;
  while (!s.winner && plies++ < MAX_PLIES) s = V.applyMove(s, (s.side === 1 ? blue : red)(s));
  return { winner: s.winner, plies };
}

const time = { A: 0, B: 0 }, moves = { A: 0, B: 0 };
const timed = (fn, who) => (s) => { const t = performance.now(); const m = fn(s); time[who] += performance.now() - t; moves[who]++; return m; };
const tA = timed(A, 'A'), tB = timed(B, 'B');
let w = 0, d = 0, l = 0, totalPlies = 0;
for (let p = 0; p < Number(pairs); p++) {
  let opening = start;
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
}
const n = w + d + l;
console.log(
  `${specA} vs ${specB}: +${w} =${d} -${l}  score ${(100 * (w + d / 2) / n).toFixed(0)}%  ` +
    `avg ${(totalPlies / n).toFixed(0)} plies  ms/move A ${(time.A / moves.A).toFixed(1)} B ${(time.B / moves.B).toFixed(1)}`
);
await server.close();
