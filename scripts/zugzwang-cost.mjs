#!/usr/bin/env node
/**
 * Measures what the obligation to move costs a King or General in game positions.
 *
 *   node scripts/zugzwang-cost.mjs [positions=300] [budgetMs=300]
 *
 * Games are played by the search bot from random openings. Every few plies, a
 * position whose side to move must move its King or General next is searched
 * twice for budgetMs: as it is, and with that unit marked as already moved (so
 * the next unit moves instead, or the side passes). The difference, from the
 * mover's point of view, is the cost of the obligation: positive when the forced
 * move hurts. Prints the distribution by game stage.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const PLAY_MS = 20, PLAY_MARGIN = 60, OPENING_PLIES = 6, MAX_PLIES = 300, EVERY = 6;
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
await server.close();

const [count = '300', budget = '300'] = process.argv.slice(2);
const PT = V.playableTiles;
const units = (s) => PT.reduce((n, t) => n + (s.u[t] ? 1 : 0), 0);
const moverScore = (s) => {
  const { ranked } = V.analyze(s, Number(budget));
  const v = ranked[0].score;
  return Math.max(-2000, Math.min(2000, s.side === -1 ? v : -v)); // cap forced wins
};

const samples = []; // { units, rank, cost }
while (samples.length < Number(count)) {
  const { units: init } = generateGameMap('dominion');
  let s = V.fromGameState({ mode: 'dominion', units: init, currentTurn: 'player', roundNumber: 1, winner: null });
  for (let i = 0; i < OPENING_PLIES && !s.winner; i++) {
    const ms = V.legalMoves(s);
    s = V.applyMove(s, ms[Math.floor(Math.random() * ms.length)]);
  }
  for (let ply = 0; !s.winner && ply < MAX_PLIES && samples.length < Number(count); ply++) {
    const rank = V.moveRank(s, s.side);
    if (ply % EVERY === 0 && rank >= 3) {
      const moved = s.moved.slice();
      for (const t of PT) if (s.u[t] === rank * s.side) moved[t] = 1;
      const skip = V.makeState(s.u.slice(), moved, s.side, s.round);
      samples.push({ units: units(s), rank, cost: moverScore(skip) - moverScore(s) });
      if (samples.length % 25 === 0) console.error(`${samples.length} positions`);
    }
    s = V.applyMove(s, V.chooseMove(s, PLAY_MS, { randomMargin: PLAY_MARGIN }).move);
  }
}

const pct = (k, n) => `${((100 * k) / n).toFixed(0)}%`.padStart(4);
console.log('cost = score if the unit could skip its move - score when it must move (mover\'s view, Scout = 100)');
for (const rank of [4, 3]) {
  for (const [lo, hi] of [[5, 8], [9, 14], [15, 20]]) {
    const xs = samples.filter((x) => x.rank === rank && x.units >= lo && x.units <= hi).map((x) => x.cost);
    if (!xs.length) continue;
    const n = xs.length, mean = xs.reduce((a, b) => a + b, 0) / n;
    console.log(
      `${rank === 4 ? 'King   ' : 'General'} ${String(lo).padStart(2)}-${String(hi).padEnd(2)} units  n ${String(n).padStart(4)}` +
        `  hurts >= 1 Scout ${pct(xs.filter((c) => c >= 100).length, n)}  >= 1 Captain ${pct(xs.filter((c) => c >= 400).length, n)}` +
        `  helps >= 1 Scout ${pct(xs.filter((c) => c <= -100).length, n)}  mean ${mean.toFixed(0).padStart(5)}`,
    );
  }
}
