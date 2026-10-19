#!/usr/bin/env node
/**
 * Collects Dominion positions from search-bot games and labels them with a
 * deeper search that scores tablebase positions exactly, and with the result of
 * the game they came from.
 *
 *   node scripts/label-positions.mjs <out.rec> [minutes=60] [budgetMs=1000] [units=5-20]
 *
 * Games start from a random opening and are played to the end by the alpha-beta
 * engine with a random margin, so they differ; a game ends early once a
 * tablebase covers it (four units or fewer). Every few plies a position with one
 * of the requested unit counts (e.g. 5,6 or 5-20) is a candidate, and PER_GAME
 * random candidates per game are kept. Each kept position is searched for
 * budgetMs with the tablebases in tablebase/ as a probe, so captures into four
 * units or fewer are exact.
 *
 * Both labels are from the side to move's point of view. value: +1/-1 when the
 * search proves a win or loss, otherwise tanh(score / SCALE). result: +1/-1 when
 * the game was won/lost, 0 when it was never resolved or hit MAX_PLIES.
 * Records are appended to <out.rec> as 132 bytes each (ml/hexdata.py GAME_RECORD):
 *   Int8 u[61], Uint8 moved[61] (tiles in playableTiles order), Int8 side,
 *   Uint8 units, Float32 value, Int8 result, 3 bytes padding
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createStore } from './lib/tablebase-store.mjs';

const PLAY_MS = 20; // per move while playing the games
const PLAY_MARGIN = 60; // random margin while playing, for varied games
const OPENING_PLIES = 6;
const MAX_PLIES = 400;
const KEEP_EVERY = 4; // plies between candidate positions of one game
const PER_GAME = 8;
// A Captain up (KC-KS) wins about 88% of tablebase positions; tanh(300/300) = 0.76
const SCALE = 300;

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

const [out, minutes = '60', budget = '1000', unitArg = '5-20'] = process.argv.slice(2);
if (!out) {
  console.log('usage: node scripts/label-positions.mjs <out.rec> [minutes=60] [budgetMs=1000] [units=5-20]');
  process.exit(1);
}
// Unit counts such as "5,6" or "5-20"
const wanted = new Set(unitArg.split(',').flatMap((part) => {
  const [lo, hi = lo] = part.split('-').map(Number);
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}));
const store = createStore(V, process.env.TABLEBASE_DIR ?? path.join(root, 'tablebase'));
const PT = V.playableTiles;
const countUnits = (s) => PT.reduce((n, t) => n + (s.u[t] ? 1 : 0), 0);

function record(s, value, result) {
  const buf = Buffer.alloc(132);
  PT.forEach((t, p) => { buf.writeInt8(s.u[t], p); buf.writeUInt8(s.moved[t], 61 + p); });
  buf.writeInt8(s.side, 122);
  buf.writeUInt8(countUnits(s), 123);
  buf.writeFloatLE(value, 124);
  buf.writeInt8(result * s.side, 128);
  return buf;
}

function label(s) {
  const { ranked } = V.analyze(s, Number(budget), 30, store.probe);
  const score = s.side === -1 ? ranked[0].score : -ranked[0].score; // mover's view
  const proven = Math.abs(score) >= store.TB_WIN - 1000;
  return { value: proven ? Math.sign(score) : Math.tanh(score / SCALE), proven };
}

const deadline = Date.now() + Number(minutes) * 60000;
const started = Date.now();
let games = 0, kept = 0, proven = 0;
while (Date.now() < deadline) {
  const { units } = generateGameMap('dominion');
  let s = V.fromGameState({ mode: 'dominion', units, currentTurn: 'player', roundNumber: 1, winner: null });
  for (let i = 0; i < OPENING_PLIES && !s.winner; i++) {
    const ms = V.legalMoves(s);
    s = V.applyMove(s, ms[Math.floor(Math.random() * ms.length)]);
  }
  const candidates = [];
  let sinceKept = KEEP_EVERY, winner = 0; // +1 Blue, -1 Red
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    if (s.winner) { winner = s.winner; break; }
    const exact = store.probe(s); // Red's point of view
    if (exact != null) { winner = -Math.sign(exact); break; }
    if (wanted.has(countUnits(s)) && ++sinceKept >= KEEP_EVERY) {
      candidates.push(s);
      sinceKept = 0;
    }
    s = V.applyMove(s, V.chooseMove(s, PLAY_MS, { randomMargin: PLAY_MARGIN, probe: store.probe }).move);
  }
  games++;
  // PER_GAME random candidates, in game order
  const positions = candidates
    .map((p, i) => ({ p, i, r: Math.random() }))
    .sort((a, b) => a.r - b.r)
    .slice(0, PER_GAME)
    .sort((a, b) => a.i - b.i)
    .map((c) => c.p);
  if (!positions.length) continue;
  const bufs = positions.map((p) => {
    const l = label(p);
    if (l.proven) proven++;
    return record(p, l.value, winner);
  });
  fs.appendFileSync(out, Buffer.concat(bufs));
  kept += positions.length;
  const mins = (Date.now() - started) / 60000;
  console.log(`games ${games}  positions ${kept}  proven ${((100 * proven) / kept).toFixed(0)}%  ${(kept / mins).toFixed(0)}/min`);
}
