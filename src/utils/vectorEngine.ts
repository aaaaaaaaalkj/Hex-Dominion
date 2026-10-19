/**
 * Dominion on the vector model: the fast engine behind the Dominion AI and the
 * remote analyzer (scripts/remote-assist.mjs).
 *
 * The board is embedded in a radius-5 hexagon (one "ghost ring" around the
 * playable radius-4 board) so every tile has a full neighbourhood:
 *   u[t]  signed rank of the unit on tile t (+ Blue/player, - Red/ai, 0 empty)
 *   I     influence vector, I = (Id + Adj) u, kept up to date incrementally
 * Combat is a sign test on I: an attacker of sign g and rank r captures the unit
 * on tile t iff g*I[t] + (attacker adjacent to t ? 0 : r) > 0.
 * A move is a swap of two coordinates of u (a capture also zeroes the victim),
 * so a game is a product of such matrices applied to u.
 *
 * The rules mirror gameRules.ts and gameState.ts (rank order, turn hand-over,
 * rounds); scripts/check-vector-engine.mjs verifies that they agree.
 */
import { HexCoord, HexTile } from '../types/game';
import { GameAction, GameState, getActions } from './gameState';

export const RADIUS = 5;
export const PLAY_RADIUS = 4;
const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

// ---- Board ------------------------------------------------------------------
export const coords: HexCoord[] = [];
for (let q = -RADIUS; q <= RADIUS; q++) {
  for (let r = Math.max(-RADIUS, -q - RADIUS); r <= Math.min(RADIUS, -q + RADIUS); r++) coords.push({ q, r });
}
export const N = coords.length; // 91
const indexOf = new Map(coords.map((c, i) => [`${c.q},${c.r}`, i]));
export const tileIndex = (q: number, r: number): number | undefined => indexOf.get(`${q},${r}`);
const dist = (a: HexCoord, b: HexCoord) =>
  (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
export const playable = coords.map((c) => dist(c, { q: 0, r: 0 }) <= PLAY_RADIUS);
// Closed neighbourhoods on the extended board (influence) and playable neighbours (movement)
export const closed: number[][] = coords.map((c, i) => [
  i,
  ...DIRS.map(([dq, dr]) => tileIndex(c.q + dq, c.r + dr)).filter((j): j is number => j !== undefined),
]);
const moveNbrs = coords.map((_, i) => (playable[i] ? closed[i].slice(1).filter((j) => playable[j]) : []));
const adjacent = coords.map((_, i) => new Set(closed[i].slice(1)));
export const playableTiles = coords.map((_, i) => i).filter((i) => playable[i]);

// ---- Zobrist hashing (two 26-bit halves combined into one safe integer) -------
let seed = 0x2545f491;
const rand26 = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 6);
const Z = coords.map(() => Array.from({ length: 18 }, () => [rand26(), rand26()]));
const Z_SIDE = [rand26(), rand26()];
const zIndex = (v: number, moved: number) => (v + 4) * 2 + moved;

// ---- State -----------------------------------------------------------------
export type Side = 1 | -1;

export interface VectorState {
  u: Int8Array;
  moved: Uint8Array;
  I: Int16Array;
  side: Side;
  winner: 0 | Side;
  round: number;
  h1: number;
  h2: number;
}

function rehash(s: VectorState) {
  let h1 = 0, h2 = 0;
  for (const t of playableTiles) {
    if (!s.u[t]) continue;
    const z = Z[t][zIndex(s.u[t], s.moved[t])];
    h1 ^= z[0]; h2 ^= z[1];
  }
  if (s.side === -1) { h1 ^= Z_SIDE[0]; h2 ^= Z_SIDE[1]; }
  s.h1 = h1; s.h2 = h2;
}
export const hashKey = (s: VectorState) => s.h1 * 67108864 + s.h2;

export function influenceOf(u: Int8Array): Int16Array {
  const I = new Int16Array(N);
  for (let t = 0; t < N; t++) if (u[t]) for (const j of closed[t]) I[j] += u[t];
  return I;
}

/** A state from signed ranks and moved flags over all N tiles. */
export function makeState(u: Int8Array, moved: Uint8Array, side: Side, round = 1, winner: 0 | Side = 0): VectorState {
  const s: VectorState = { u, moved, I: influenceOf(u), side, winner, round, h1: 0, h2: 0 };
  rehash(s);
  return s;
}

/** Builds a vector state from the app's GameState (Dominion). */
export function fromGameState(state: GameState): VectorState {
  const u = new Int8Array(N), moved = new Uint8Array(N);
  for (const x of state.units) {
    if (x.isDefeated) continue;
    const t = tileIndex(x.coord.q, x.coord.r)!;
    u[t] = (x.team === 'player' ? 1 : -1) * x.rank;
    moved[t] = x.hasMovedThisRound ? 1 : 0;
  }
  const winner = state.winner === 'player' ? 1 : state.winner === 'ai' ? -1 : 0;
  return makeState(u, moved, state.currentTurn === 'player' ? 1 : -1, state.roundNumber, winner);
}

// ---- Move generation ------------------------------------------------------------
// A move is encoded as from * 128 + to; PASS when the side to move has no legal move.
export const PASS = -1;

/** Legal destinations of the unit on tile `from` (BFS like calculateLegalMovesForUnit). */
export function unitMoves(s: VectorState, from: number, out: number[] = [], firstOnly = false): number[] {
  const v = s.u[from];
  if (!v || s.moved[from]) return out;
  const g = v > 0 ? 1 : -1, r = v * g, speed = 5 - r;
  const visited = new Set([from]);
  let frontier = [from];
  for (let step = 1; step <= speed && frontier.length; step++) {
    const next: number[] = [];
    for (const t of frontier) {
      for (const j of moveNbrs[t]) {
        if (visited.has(j)) continue;
        const occ = s.u[j];
        if (occ && (occ > 0 ? 1 : -1) !== g) {
          // Combat as a sign test on the influence vector
          if (g * s.I[j] + (adjacent[from].has(j) ? 0 : r) > 0) {
            visited.add(j);
            out.push(from * 128 + j);
            if (firstOnly) return out;
          }
          continue;
        }
        visited.add(j);
        if (!occ) {
          out.push(from * 128 + j);
          if (firstOnly) return out;
        }
        if (step < speed) next.push(j);
      }
    }
    frontier = next;
  }
  return out;
}

const canMove = (s: VectorState, t: number) => unitMoves(s, t, [], true).length > 0;

/** Highest rank among the side's unmoved units that can move (the rank-order rule), or 0. */
export function moveRank(s: VectorState, side: Side): number {
  let best = 0;
  for (const t of playableTiles) {
    const v = s.u[t] * side;
    if (v > best && !s.moved[t] && canMove(s, t)) best = v;
  }
  return best;
}

const hasAnyMove = (s: VectorState, side: Side) => moveRank(s, side) > 0;

export function legalMoves(s: VectorState): number[] {
  if (s.winner) return [];
  const rank = moveRank(s, s.side);
  if (!rank) return [PASS];
  const out: number[] = [];
  for (const t of playableTiles) if (s.u[t] === rank * s.side && !s.moved[t]) unitMoves(s, t, out);
  return out;
}

// ---- Applying moves ---------------------------------------------------------------
function clone(s: VectorState): VectorState {
  return { u: s.u.slice(), moved: s.moved.slice(), I: s.I.slice(), side: s.side, winner: s.winner, round: s.round, h1: s.h1, h2: s.h2 };
}

function toggle(s: VectorState, t: number) {
  if (!s.u[t]) return;
  const z = Z[t][zIndex(s.u[t], s.moved[t])];
  s.h1 ^= z[0]; s.h2 ^= z[1];
}

// Hands the turn on after `mover` acted (advanceTurn in gameState.ts)
function advance(s: VectorState, mover: Side) {
  const other = -mover as Side;
  const prevSide = s.side;
  if (hasAnyMove(s, other)) s.side = other;
  else if (hasAnyMove(s, mover)) s.side = mover;
  else {
    s.moved.fill(0);
    s.side = hasAnyMove(s, other) || !hasAnyMove(s, mover) ? other : mover;
    s.round++;
    rehash(s);
    return;
  }
  if (s.side !== prevSide) { s.h1 ^= Z_SIDE[0]; s.h2 ^= Z_SIDE[1]; }
}

/** Returns the state after the side to move plays `move` (the input is not modified). */
export function applyMove(s0: VectorState, move: number): VectorState {
  const s = clone(s0);
  const mover = s.side;
  if (move === PASS) { advance(s, mover); return s; }
  const from = move >> 7, to = move & 127;
  const v = s.u[from], victim = s.u[to];
  toggle(s, from); toggle(s, to);
  // Influence update: remove victim and mover, add mover at its new tile (O(7) each)
  if (victim) for (const j of closed[to]) s.I[j] -= victim;
  for (const j of closed[from]) s.I[j] -= v;
  for (const j of closed[to]) s.I[j] += v;
  // The move itself: swap the two coordinates (victim, if any, is dropped)
  s.u[to] = v; s.u[from] = 0;
  s.moved[to] = 1; s.moved[from] = 0;
  toggle(s, to);
  if (victim && Math.abs(victim) === 4) { s.winner = mover; return s; }
  if (victim && !playableTiles.some((t) => s.u[t] * mover < 0)) { s.winner = mover; return s; }
  advance(s, mover);
  return s;
}

// ---- Evaluation and search ----------------------------------------------------------
export const WIN = 1_000_000;
// Fitted to game outcomes in self-play: a Captain is worth about four Scouts and
// at least as much as a General (its range matters more than the General's aura)
const VALUE = [0, 100, 400, 250, 0];
// Captures resolved past the horizon before a position is scored
const MAX_QUIESCENCE_DEPTH = 6;

/** Score from Red's (ai, -1) point of view: material plus influenced-tile balance. */
export function evaluate(s: VectorState): number {
  if (s.winner) return s.winner === -1 ? WIN : -WIN;
  let score = 0, tiles = 0;
  for (const t of playableTiles) {
    const v = s.u[t];
    if (v) score += v < 0 ? VALUE[-v] : -VALUE[v];
    if (s.I[t] < 0) tiles++;
    else if (s.I[t] > 0) tiles--;
  }
  return score + tiles * 3;
}

class Timeout extends Error {}

interface SearchContext {
  nodes: number;
  deadline: number;
  tt: Map<number, { lo: number; hi: number }>[];
  evaluate: Evaluator;
  probe?: Prober;
  forcedRank?: number;
}

/** Static score of a non-terminal position from Red's point of view (|score| well below WIN). */
export type Evaluator = (s: VectorState) => number;

/** Exact score of a position from an endgame tablebase (Red's point of view), or null when not covered. */
export type Prober = (s: VectorState) => number | null;

const isCapture = (s: VectorState, m: number) => m !== PASS && s.u[m & 127] !== 0;
// Most valuable victim first, then least valuable attacker
const captureKey = (s: VectorState, m: number) =>
  isCapture(s, m) ? 8 * Math.abs(s.u[m & 127]) - Math.abs(s.u[m >> 7]) : -100;

// The clock is read every 32 nodes: often enough for a slow evaluator (valueNet.ts)
function tick(ctx: SearchContext) {
  if ((++ctx.nodes & 31) === 0 && Date.now() > ctx.deadline) throw new Timeout();
}

/**
 * Capture-only search at the horizon, so a position is never scored in the
 * middle of an exchange. The side to move may "stand pat" on the static score
 * instead of capturing, except when the unit due to move has at least
 * ctx.forcedRank: a King or General must move (zugzwang), so all its moves are tried.
 */
function quiesce(s: VectorState, alpha: number, beta: number, ctx: SearchContext, qDepth: number): number {
  tick(ctx);
  const exact = s.winner ? null : ctx.probe?.(s);
  if (exact != null) return exact;
  const standPat = s.winner ? evaluate(s) : ctx.evaluate(s);
  if (s.winner || qDepth >= MAX_QUIESCENCE_DEPTH) return standPat;
  const maximizing = s.side === -1;
  const legal = legalMoves(s);
  const forced = ctx.forcedRank !== undefined && legal[0] !== PASS && Math.abs(s.u[legal[0] >> 7]) >= ctx.forcedRank;
  if (!forced) {
    if (maximizing) {
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
    } else {
      if (standPat <= alpha) return standPat;
      if (standPat < beta) beta = standPat;
    }
  }
  const captures = forced ? legal : legal.filter((m) => isCapture(s, m));
  captures.sort((a, b) => captureKey(s, b) - captureKey(s, a));
  let best = forced ? (maximizing ? -Infinity : Infinity) : standPat;
  for (const m of captures) {
    const v = quiesce(applyMove(s, m), alpha, beta, ctx, qDepth + 1);
    if (maximizing) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  return best;
}

function search(s: VectorState, depth: number, alpha: number, beta: number, ctx: SearchContext): number {
  if (s.winner) {
    const v = evaluate(s);
    return v === WIN ? v + depth : v - depth; // prefer quicker wins, slower losses
  }
  const exact = ctx.probe?.(s);
  if (exact != null) return exact;
  if (depth === 0) return quiesce(s, alpha, beta, ctx, 0);
  tick(ctx);
  const key = hashKey(s);
  const table = (ctx.tt[depth] ??= new Map()); // one table per depth keeps keys within 53 bits
  const hit = table.get(key);
  if (hit) {
    if (hit.lo >= beta) return hit.lo;
    if (hit.hi <= alpha) return hit.hi;
  }
  const moves = legalMoves(s);
  moves.sort((a, b) => captureKey(s, b) - captureKey(s, a));
  const maximizing = s.side === -1;
  const a0 = alpha, b0 = beta;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    const v = search(applyMove(s, m), depth - 1, alpha, beta, ctx);
    if (maximizing) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  table.set(key, { lo: best > a0 ? best : -Infinity, hi: best < b0 ? best : Infinity });
  return best;
}

/**
 * Iterative deepening for the side to move (scores from Red's point of view).
 * Returns every root move with an exact score, ranked best-first for that side
 * at the deepest finished depth. Used by the analyzer, which shows candidates,
 * and by the position labeller, whose `probe` scores tablebase positions exactly.
 */
export function analyze(s: VectorState, budgetMs: number, maxDepth = 30, probe?: Prober) {
  const ctx: SearchContext = { nodes: 0, deadline: Date.now() + budgetMs, tt: [], evaluate, probe };
  let ranked = legalMoves(s).map((move) => ({ move, score: 0 }));
  let depth = 0;
  const sign = s.side === -1 ? 1 : -1;
  for (let d = 1; d <= maxDepth; d++) {
    try {
      const scored = ranked.map((e) => ({ move: e.move, score: search(applyMove(s, e.move), d - 1, -Infinity, Infinity, ctx) }));
      scored.sort((a, b) => sign * (b.score - a.score));
      ranked = scored;
      depth = d;
      if (Math.abs(scored[0].score) >= WIN - 100) break;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  return { ranked, depth, nodes: ctx.nodes };
}

export interface VectorChoice {
  move: number;
  score: number; // from the mover's point of view
  depth: number;
  nodes: number;
}

export interface SearchOptions {
  maxDepth?: number;
  /** Moves within this margin of the best are chosen from at random. */
  randomMargin?: number;
  evaluator?: Evaluator;
  probe?: Prober;
  /** Units of at least this rank may not stand pat in the quiescence search (see quiesce). */
  forcedRank?: number;
}

/**
 * Picks a move for the side to move (the in-game AI). Alpha-beta at the root too,
 * so only moves within `randomMargin` of the best get exact scores; one of those
 * is chosen at random, unless the result is forced.
 */
export function chooseMove(s: VectorState, budgetMs: number, options: SearchOptions = {}): VectorChoice | null {
  const { maxDepth = 30, randomMargin = 0, evaluator = evaluate, probe, forcedRank } = options;
  const ctx: SearchContext = { nodes: 0, deadline: Date.now() + budgetMs, tt: [], evaluate: evaluator, probe, forcedRank };
  const moves = legalMoves(s);
  if (moves.length === 0) return null;
  if (moves.length === 1) return { move: moves[0], score: 0, depth: 0, nodes: 0 };

  const sign = s.side === -1 ? 1 : -1; // converts Red's point of view to the mover's
  let root = moves
    .sort((a, b) => captureKey(s, b) - captureKey(s, a))
    .map((move) => ({ move, score: -Infinity }));
  let scored = [{ move: root[0].move, score: 0 }];
  let bestScore = -Infinity;
  let reachedDepth = 0;

  for (let d = 1; d <= maxDepth; d++) {
    let alpha = -Infinity; // mover's point of view
    const iteration: { move: number; score: number }[] = [];
    let timedOut = false;
    try {
      for (const entry of root) {
        const floor = alpha - randomMargin;
        const v = search(
          applyMove(s, entry.move),
          d - 1,
          sign === 1 ? floor : -Infinity,
          sign === 1 ? Infinity : -floor,
          ctx
        );
        entry.score = sign * v;
        iteration.push({ move: entry.move, score: entry.score });
        if (entry.score > alpha) alpha = entry.score;
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      timedOut = true;
    }

    // A partial iteration is still usable. Moves it did not reach keep their
    // score from the previous depth: if the previous best collapses at the new
    // depth, an alternative that has not been re-searched yet must still win over it.
    if (iteration.length > 0) {
      scored = timedOut
        ? root.filter((e) => e.score > -Infinity).map((e) => ({ move: e.move, score: e.score }))
        : iteration;
      bestScore = Math.max(...scored.map((m) => m.score));
      reachedDepth = d;
    }
    if (timedOut) break;
    root = [...root].sort((a, b) => b.score - a.score);
    if (Math.abs(bestScore) >= WIN - 100) break; // forced result found
  }

  const margin = Math.abs(bestScore) >= WIN - 100 ? 0 : randomMargin;
  const candidates = scored.filter((m) => m.score >= bestScore - margin);
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return { move: pick.move, score: bestScore, depth: reachedDepth, nodes: ctx.nodes };
}

export const moveFrom = (m: number) => coords[m >> 7];
export const moveTo = (m: number) => coords[m & 127];

/** True when no unit of either side (moved or not) can capture anything. */
export function isQuiet(s: VectorState): boolean {
  const fresh = { ...s, moved: new Uint8Array(N) };
  const out: number[] = [];
  for (const t of playableTiles) {
    out.length = 0;
    if (unitMoves(fresh, t, out).some((m) => isCapture(s, m))) return false;
  }
  return true;
}

/**
 * The Dominion AI: searches on the vector model and returns the matching app
 * action. Takes the same options as chooseAIAction (aiEngine.ts).
 */
export function chooseDominionAction(
  state: GameState,
  tiles: Map<string, HexTile>,
  options: { timeLimitMs?: number; quietTimeLimitMs?: number; maxDepth?: number; randomMargin?: number } = {}
): { action: GameAction; score: number; depth: number; nodes: number; timeMs: number } | null {
  const started = Date.now();
  const s = fromGameState(state);
  const budget =
    options.quietTimeLimitMs !== undefined && isQuiet(s) ? options.quietTimeLimitMs : options.timeLimitMs ?? 1200;
  const choice = chooseMove(s, budget, { maxDepth: options.maxDepth, randomMargin: options.randomMargin });
  if (!choice) return null;
  const action = toGameAction(state, tiles, choice.move);
  return { action, score: choice.score, depth: choice.depth, nodes: choice.nodes, timeMs: Date.now() - started };
}

/** The app action matching a vector-model move in `state`. */
export function toGameAction(state: GameState, tiles: Map<string, HexTile>, move: number): GameAction {
  const actions = getActions(state, tiles);
  const from = moveFrom(move), to = moveTo(move);
  const action =
    move === PASS
      ? actions.find((a) => a.kind === 'pass')
      : actions.find((a) => {
          if (a.kind !== 'move') return false;
          const unit = state.units.find((u) => u.id === a.unitId)!;
          return unit.coord.q === from.q && unit.coord.r === from.r && a.move.target.q === to.q && a.move.target.r === to.r;
        });
  if (!action) throw new Error('Vector engine chose a move the game does not allow');
  return action;
}
