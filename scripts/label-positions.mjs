#!/usr/bin/env node
/**
 * Collects Dominion positions with few units from search-bot games and labels
 * them with a deeper search that scores tablebase positions exactly.
 *
 *   node scripts/label-positions.mjs <out.bin> [minutes=60] [budgetMs=1000] [units=5,6]
 *
 * Games start from a random opening and are played by the alpha-beta engine with
 * a random margin, so they differ. Once a game is down to one of the requested
 * unit counts, every few plies a position is kept (at most PER_GAME per game);
 * each kept position is then searched for budgetMs with the tablebases in
 * tablebase/ as a probe. Captures into four units or fewer are therefore exact.
 *
 * The label is from the side to move's point of view: +1/-1 when the search
 * proves a win or loss, otherwise tanh(score / SCALE). Records are appended to
 * <out.bin> as 128 bytes each (ml/hexdata.py RECORD):
 *   Int8 u[61], Uint8 moved[61] (tiles in playableTiles order), Int8 side,
 *   Uint8 units, Float32 value
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
const KEEP_EVERY = 4; // plies between kept positions of one game
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

const [out, minutes = '60', budget = '1000', unitArg = '5,6'] = process.argv.slice(2);
if (!out) {
  console.log('usage: node scripts/label-positions.mjs <out.bin> [minutes=60] [budgetMs=1000] [units=5,6]');
  process.exit(1);
}
const wanted = new Set(unitArg.split(',').map(Number));
const store = createStore(V, process.env.TABLEBASE_DIR ?? path.join(root, 'tablebase'));
const PT = V.playableTiles;
const countUnits = (s) => PT.reduce((n, t) => n + (s.u[t] ? 1 : 0), 0);

function record(s, value) {
  const buf = Buffer.alloc(128);
  PT.forEach((t, p) => { buf.writeInt8(s.u[t], p); buf.writeUInt8(s.moved[t], 61 + p); });
  buf.writeInt8(s.side, 122);
  buf.writeUInt8(countUnits(s), 123);
  buf.writeFloatLE(value, 124);
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
  const positions = [];
  let sinceKept = KEEP_EVERY;
  for (let ply = 0; !s.winner && ply < MAX_PLIES && positions.length < PER_GAME; ply++) {
    if (wanted.has(countUnits(s)) && ++sinceKept >= KEEP_EVERY) {
      positions.push(s);
      sinceKept = 0;
    }
    s = V.applyMove(s, V.chooseMove(s, PLAY_MS, 30, PLAY_MARGIN).move);
  }
  games++;
  if (!positions.length) continue;
  const bufs = positions.map((p) => {
    const l = label(p);
    if (l.proven) proven++;
    return record(p, l.value);
  });
  fs.appendFileSync(out, Buffer.concat(bufs));
  kept += positions.length;
  const mins = (Date.now() - started) / 60000;
  console.log(`games ${games}  positions ${kept}  proven ${((100 * proven) / kept).toFixed(0)}%  ${(kept / mins).toFixed(0)}/min`);
}
