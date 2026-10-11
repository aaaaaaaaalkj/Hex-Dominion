#!/usr/bin/env node
/**
 * Differential test: plays random Dominion games with the app's engine and checks
 * that src/utils/vectorEngine.ts produces the same legal moves and the same
 * next state (units, moved flags, side to move, round, winner, influence, hash)
 * at every step.
 *
 *   node scripts/check-vector-engine.mjs [games]
 */
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
const { getActions, applyAction } = await server.ssrLoadModule('/src/utils/gameState.ts');
const { computeInfluenceMap } = await server.ssrLoadModule('/src/utils/gameRules.ts');
const V = await server.ssrLoadModule('/src/utils/vectorEngine.ts');

const games = Number(process.argv[2] ?? 40);
let seed = 12345;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const k = (c) => `${c.q},${c.r}`;
let steps = 0;
let failures = 0;
const fail = (msg) => {
  if (failures++ < 10) console.log('MISMATCH', msg);
};

// App action -> "from>to" (or "pass")
const appKey = (st, a) =>
  a.kind === 'pass' ? 'pass' : `${k(st.units.find((u) => u.id === a.unitId).coord)}>${k(a.move.target)}`;
const vecKey = (m) => (m === V.PASS ? 'pass' : `${k(V.moveFrom(m))}>${k(V.moveTo(m))}`);

function sameState(vs, st, tiles, where) {
  const ref = V.fromGameState(st);
  if (ref.u.some((x, i) => x !== vs.u[i])) return fail(`${where}: units differ`);
  if (ref.moved.some((x, i) => x !== vs.moved[i])) return fail(`${where}: moved flags differ`);
  if (ref.side !== vs.side || ref.round !== vs.round || ref.winner !== vs.winner) {
    return fail(`${where}: side/round/winner ${vs.side}/${vs.round}/${vs.winner} vs ${ref.side}/${ref.round}/${ref.winner}`);
  }
  if (ref.h1 !== vs.h1 || ref.h2 !== vs.h2) return fail(`${where}: incremental hash differs from a fresh hash`);
  const game = computeInfluenceMap(tiles, st.units);
  for (const [key, val] of game) {
    const [q, r] = key.split(',').map(Number);
    if (vs.I[V.tileIndex(q, r)] !== val) return fail(`${where}: influence differs at ${key}`);
  }
}

for (let g = 0; g < games && failures === 0; g++) {
  const { tiles, units } = generateGameMap('dominion');
  let st = { mode: 'dominion', units, currentTurn: 'player', roundNumber: 1, winner: null };
  let vs = V.fromGameState(st);
  for (let i = 0; i < 400 && !st.winner && failures === 0; i++) {
    const acts = getActions(st, tiles);
    const vmoves = V.legalMoves(vs);
    const appKeys = acts.map((a) => appKey(st, a)).sort();
    const vecKeys = vmoves.map(vecKey).sort();
    if (appKeys.join() !== vecKeys.join()) {
      fail(`game ${g} ply ${i}: legal moves differ (${appKeys.length} vs ${vecKeys.length})`);
      break;
    }
    const a = acts[Math.floor(rnd() * acts.length)];
    const wanted = appKey(st, a);
    const vm = vmoves.find((m) => vecKey(m) === wanted);
    st = applyAction(st, tiles, a);
    vs = V.applyMove(vs, vm);
    sameState(vs, st, tiles, `game ${g} ply ${i} (${wanted})`);
    steps++;
  }
}
console.log(`${steps} steps compared, ${failures} mismatches`);
await server.close();
process.exit(failures ? 1 : 0);
