#!/usr/bin/env node
/**
 * Replays a Dominion match transcript (the game's text export) on the vector
 * engine and reviews every move with the value network: the best score the
 * mover had, the score after the move played, and the loss in between.
 *
 *   node scripts/review-game.mjs <transcript.txt> [budgetMs=1000] [minLoss=100]
 *
 * Scores are from Blue's point of view (Scout = 100; ±1000000 a forced win).
 * Moves losing at least minLoss for the mover are marked. Uses $VALUE_NET or
 * src/data/value-net.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

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
const NET = await server.ssrLoadModule('/src/utils/valueNet.ts');
await server.close();

const [file, budget = '1000', minLoss = '100'] = process.argv.slice(2);
if (!file) {
  console.log('usage: node scripts/review-game.mjs <transcript.txt> [budgetMs=1000] [minLoss=100]');
  process.exit(1);
}
const weights = JSON.parse(fs.readFileSync(process.env.VALUE_NET ?? path.join(root, 'src/data/value-net.json'), 'utf8'));
const evaluator = NET.netEvaluator(NET.createValueNet(weights));
const options = { evaluator, extendForced: true };

// "# 57 [R4] PLAYER King      (-1,1)   -> (0,0)    | ..."
const plies = [...fs.readFileSync(file, 'utf8').matchAll(/^#\s*(\d+) \[R\d+\] (PLAYER|AI)\s+(\w+)\s+\((-?\d+),(-?\d+)\)\s+->\s+\((-?\d+),(-?\d+)\)/gm)].map(
  (m) => ({ n: Number(m[1]), side: m[2] === 'PLAYER' ? 1 : -1, unit: m[3], from: [Number(m[4]), Number(m[5])], to: [Number(m[6]), Number(m[7])] }),
);
const { units } = generateGameMap('dominion');
let s = V.fromGameState({ mode: 'dominion', units, currentTurn: 'player', roundNumber: 1, winner: null });

const blueView = (score, side) => (side === 1 ? score : -score); // mover's view -> Blue's
const fmt = (v) => (Math.abs(v) >= 900000 ? (v > 0 ? '+WIN' : '-WIN') : (v >= 0 ? '+' : '') + v.toFixed(0)).padStart(6);
for (const p of plies) {
  while (V.legalMoves(s)[0] === V.PASS) s = V.applyMove(s, V.PASS);
  if (s.side !== p.side) throw new Error(`#${p.n}: expected ${s.side === 1 ? 'Blue' : 'Red'} to move`);
  const move = V.legalMoves(s).find((m) => {
    const a = V.moveFrom(m), b = V.moveTo(m);
    return a.q === p.from[0] && a.r === p.from[1] && b.q === p.to[0] && b.r === p.to[1];
  });
  if (move === undefined) throw new Error(`#${p.n}: ${p.unit} (${p.from}) -> (${p.to}) is not legal here`);
  const best = V.chooseMove(s, Number(budget), options);
  const next = V.applyMove(s, move);
  let after;
  if (next.winner) after = next.winner === s.side ? 1e6 : -1e6;
  else {
    const reply = V.chooseMove(next, Number(budget), options);
    after = next.side === s.side ? reply.score : -reply.score; // mover's view
  }
  const loss = Math.max(0, best.score - after);
  const mark = loss >= Number(minLoss) ? `  <-- loses ${loss >= 900000 ? 'the game' : loss.toFixed(0)}` : '';
  const bestMove = best.move !== move ? `  (best ${['(' + V.moveTo(best.move).q, V.moveTo(best.move).r + ')'].join(',')})` : '';
  console.log(`#${String(p.n).padStart(3)} ${p.side === 1 ? 'Blue' : 'Red '} ${p.unit.padEnd(8)} (${p.from}) -> (${p.to})`.padEnd(46) +
    `best ${fmt(blueView(best.score, s.side))}  played ${fmt(blueView(after, s.side))}${mark}${loss >= Number(minLoss) ? bestMove : ''}`);
  s = next;
}
