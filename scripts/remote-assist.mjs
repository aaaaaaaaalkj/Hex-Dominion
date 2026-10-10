#!/usr/bin/env node
/**
 * Local assistant for the remote opponent (dev only, see vite.config.ts).
 *
 *   node scripts/remote-assist.mjs watch      analyze every new position the page posts
 *   node scripts/remote-assist.mjs move <n>   answer the current position with legal move n
 *
 * `watch` prints one line per turn: the clocks, the best candidate moves from a timed
 * alpha-beta search (Dominion: the vector engine in lib/vector-engine.mjs; Gambit: the
 * game's own rules), and King-safety notes. The search only
 * advises; the agent still chooses the move. Full results go to .remote/analysis.txt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import * as V from './lib/vector-engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, '.remote');
const positionFile = path.join(dir, 'position.json');
const signalFile = path.join(dir, 'state.json');
const analysisFile = path.join(dir, 'analysis.txt');

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const [command, arg] = process.argv.slice(2);

if (command === 'move') {
  const position = readJson(positionFile);
  const index = Number(arg);
  if (!position) throw new Error('No position posted yet');
  if (!Number.isInteger(index) || index < 0 || index >= position.actionKeys.length) {
    throw new Error(`Move index must be 0..${position.actionKeys.length - 1}`);
  }
  fs.writeFileSync(path.join(dir, 'move.json'), JSON.stringify({ token: position.token, index }));
  console.log(`sent move ${index} (${position.actionKeys[index]}) for ${position.token}`);
  process.exit(0);
}

if (command !== 'watch') {
  console.error('usage: remote-assist.mjs watch | move <n>');
  process.exit(1);
}

// Load the game's own modules (TypeScript) through Vite, without the app's plugins
const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const load = (p) => server.ssrLoadModule(p);
const { generateGameMap } = await load('/src/utils/mapGenerator.ts');
const { getActions, applyAction, opponentOf } = await load('/src/utils/gameState.ts');
const { calculateLegalMovesForUnit, computeInfluenceMap, countInfluencedTiles } = await load('/src/utils/gameRules.ts');
const { describeAction, actionKey } = await load('/src/utils/remoteOpponent.ts');
const { formatClock } = await load('/src/utils/clock.ts');

const ME = 'ai';
const WIN = 1_000_000;
const VALUE = {
  dominion: { 1: 100, 2: 180, 3: 260, 4: 0 },
  gambit: { 1: 100, 2: 380, 3: 420, 4: 0 },
};
const tilesByMode = {
  dominion: generateGameMap('dominion').tiles,
  gambit: generateGameMap('gambit').tiles,
};

function evaluate(st, tiles) {
  if (st.winner) return st.winner === ME ? WIN : -WIN;
  if (st.isDraw) return 0;
  let score = 0;
  for (const u of st.units) if (!u.isDefeated) score += (u.team === ME ? 1 : -1) * VALUE[st.mode][u.rank];
  if (st.mode === 'dominion') {
    const { player, ai } = countInfluencedTiles(computeInfluenceMap(tiles, st.units));
    score += (ai - player) * 3;
  }
  return score;
}

class Timeout extends Error {}

function captureFirst(actions) {
  const weight = (a) => (a.kind === 'move' && a.move.isAttack ? 10 + (a.move.targetUnitRank ?? 0) : 0);
  return actions.sort((a, b) => weight(b) - weight(a));
}

function search(st, tiles, depth, alpha, beta, ctx) {
  if ((++ctx.nodes & 1023) === 0 && Date.now() > ctx.deadline) throw new Timeout();
  if (depth === 0 || st.winner || st.isDraw) {
    const v = evaluate(st, tiles);
    return v === WIN ? v + depth : v === -WIN ? v - depth : v; // prefer faster wins, slower losses
  }
  const key = depth > 1 ? `${depth}|${st.currentTurn}|${st.units.map((u) => (u.isDefeated ? 'x' : `${u.coord.q},${u.coord.r},${u.facing ?? ''}${u.hasMovedThisRound ? 'm' : ''}`)).join(';')}` : null;
  const hit = key && ctx.tt.get(key);
  if (hit) {
    if (hit.lo >= beta) return hit.lo;
    if (hit.hi <= alpha) return hit.hi;
  }
  const maximizing = st.currentTurn === ME;
  const a0 = alpha;
  const b0 = beta;
  let best = maximizing ? -Infinity : Infinity;
  for (const action of captureFirst(getActions(st, tiles))) {
    const v = search(applyAction(st, tiles, action), tiles, depth - 1, alpha, beta, ctx);
    if (maximizing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (alpha >= beta) break;
  }
  if (key) ctx.tt.set(key, { lo: best > a0 ? best : -Infinity, hi: best < b0 ? best : Infinity });
  return best;
}

// Iterative deepening at the root; returns scores of the deepest completed depth
function analyze(state, tiles, budgetMs) {
  const ctx = { nodes: 0, deadline: Date.now() + budgetMs, tt: new Map() };
  const actions = getActions(state, tiles).map((action, index) => ({ action, index, score: 0 }));
  let completed = 0;
  for (let depth = 1; depth <= 12; depth++) {
    try {
      const scored = actions.map((entry) => ({
        ...entry,
        score: search(applyAction(state, tiles, entry.action), tiles, depth - 1, -Infinity, Infinity, ctx),
      }));
      scored.sort((a, b) => b.score - a.score);
      actions.splice(0, actions.length, ...scored); // best-first ordering for the next depth
      completed = depth;
      if (Math.abs(scored[0].score) >= WIN - 100) break; // forced result found
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  return { ranked: actions, depth: completed, nodes: ctx.nodes };
}

// Dominion: King moves for next round and whether the enemy (all fresh) could capture there
function kingEscapes(team, units, tiles) {
  const king = units.find((u) => u.team === team && u.rank === 4 && !u.isDefeated);
  if (!king) return null;
  const fresh = (us) => us.map((u) => ({ ...u, hasMovedThisRound: false }));
  const moves = calculateLegalMovesForUnit({ ...king, hasMovedThisRound: false }, tiles, units);
  let safe = 0;
  for (const mv of moves) {
    const after = fresh(
      units
        .filter((u) => !(mv.isAttack && u.id === mv.targetUnitId))
        .map((u) => (u.id === king.id ? { ...u, coord: mv.target } : u))
    );
    const threatened = after.some(
      (u) =>
        u.team !== team &&
        !u.isDefeated &&
        calculateLegalMovesForUnit(u, tiles, after).some((x) => x.isAttack && x.targetUnitId === king.id)
    );
    if (!threatened) safe++;
  }
  return { total: moves.length, safe };
}

const fmtScore = (s) => (s >= WIN - 100 ? 'WIN' : s <= -WIN + 100 ? 'LOSS' : s > 0 ? `+${s}` : `${s}`);

function handle(position) {
  const { state, actionKeys, clock, token } = position;
  const tiles = tilesByMode[state.mode];
  const ours = getActions(state, tiles);
  const mismatch = ours.length !== actionKeys.length || ours.some((a, i) => actionKey(a) !== actionKeys[i]);
  // Leave time for reading and answering: about 1/30 of the bank, 0.8 to 4 seconds
  const budget = clock ? Math.min(4000, Math.max(800, (clock.ai - 20_000) / 30)) : 6000;
  const t0 = Date.now();
  let ranked, depth, nodes;
  if (state.mode === 'dominion') {
    // Vector engine (scripts/lib/vector-engine.mjs): same rules, much faster search
    const keyOf = (a) => (a.kind === 'pass' ? 'pass' : `${state.units.find((u) => u.id === a.unitId).coord.q},${state.units.find((u) => u.id === a.unitId).coord.r}>${a.move.target.q},${a.move.target.r}`);
    const byKey = new Map(ours.map((action, index) => [keyOf(action), { action, index }]));
    const vecKey = (m) => (m === V.PASS ? 'pass' : `${V.moveFrom(m).q},${V.moveFrom(m).r}>${V.moveTo(m).q},${V.moveTo(m).r}`);
    const result = V.analyze(V.fromGameState(state), budget);
    ranked = result.ranked.map((e) => ({ ...byKey.get(vecKey(e.move)), score: e.score }));
    ({ depth, nodes } = result);
  } else {
    ({ ranked, depth, nodes } = analyze(state, tiles, budget));
  }
  const describe = (entry) => `${entry.index}: ${describeAction(state.mode, entry.action, state.units)} [${fmtScore(entry.score)}]`;

  let kings = '';
  if (state.mode === 'dominion') {
    const mine = kingEscapes(ME, state.units, tiles);
    const theirs = kingEscapes(opponentOf(ME), state.units, tiles);
    kings = ` | next-round King escapes: mine ${mine?.safe}/${mine?.total} safe, theirs ${theirs?.safe}/${theirs?.total}`;
  }
  const clocks = clock ? ` | clock Red ${formatClock(clock.ai)} Blue ${formatClock(clock.player)}` : '';
  const head = `TURN ${token}${clocks} | ${ours.length} moves, depth ${depth} in ${Date.now() - t0}ms${kings}`;
  const top = ranked.slice(0, 3).map(describe).join(' ; ');
  console.log(`${head} | ${top}${mismatch ? ' | WARNING: move list differs from the page' : ''}`);

  fs.writeFileSync(
    analysisFile,
    [head, `nodes ${nodes}`, '', ...ranked.slice(0, 15).map(describe), ''].join('\n')
  );
}

console.log('remote-assist: watching .remote/ for new positions');
let lastToken = null;
setInterval(() => {
  const signal = readJson(signalFile);
  if (!signal || signal.token === lastToken) return;
  const position = readJson(positionFile);
  if (!position || position.token !== signal.token) return; // written just before the signal
  lastToken = signal.token;
  try {
    handle(position);
  } catch (e) {
    console.log(`TURN ${signal.token} | analysis failed: ${e.message}`);
  }
}, 200);
