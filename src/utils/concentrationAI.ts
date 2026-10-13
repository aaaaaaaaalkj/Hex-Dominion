/**
 * Experimental Dominion opponent built around concentration: a shallow
 * minimax over a weighted sum of positional terms, all from the mover's point
 * of view (see `Weights`). With `plies = 1` it is a greedy bot that scores each
 * legal move by the position it leaves behind.
 *
 *   concentration  sum over playable tiles of R[t]^2, where R is the influence of
 *                  the mover's own units alone (moving next to the opponent's
 *                  units gains nothing); squaring rewards stacking influence on
 *                  few tiles over spreading it thin
 *   mobility       own (unit, destination) moves minus the opponent's, counted
 *                  as if no unit had moved yet this round
 *   material       own unit values minus the opponent's
 *   threats        value of opponent units we attack minus value of our units
 *                  the opponent attacks (Kings count KING_THREAT_VALUE)
 *
 * scripts/ai-match.mjs plays variants against each other.
 */
import { HexTile } from '../types/game';
import { GameAction, GameState } from './gameState';
import {
  applyMove,
  closed,
  fromGameState,
  legalMoves,
  N,
  playableTiles,
  toGameAction,
  unitMoves,
  VectorState,
} from './vectorEngine';

type Side = 1 | -1;

export interface Weights {
  concentration: number;
  mobility: number;
  material: number;
  threats: number;
  plies: number; // search depth in single-unit moves
}

// Tuned with scripts/ai-match.mjs: material and threats with a 2-ply look-ahead beat
// the alpha-beta engine at 200 ms/move 7-1-0; mobility lost games in every pairing,
// and dropping concentration fell to 38%.
export const DEFAULT_WEIGHTS: Weights = { concentration: 1, mobility: 0, material: 2, threats: 1, plies: 2 };

// Same scale as the search engine's material values (Scout, General, Captain)
const UNIT_VALUE = [0, 100, 400, 250, 0];
const KING_THREAT_VALUE = 2000;
const WIN = 1e9;

/** Sum of squares of the influence of `side`'s own units. */
export function concentration(s: VectorState, side: Side): number {
  const own = new Int16Array(N);
  for (const t of playableTiles) {
    const v = s.u[t] * side;
    if (v > 0) for (const j of closed[t]) own[j] += v;
  }
  let c = 0;
  for (const t of playableTiles) c += own[t] * own[t];
  return c;
}

/**
 * Freedom of movement and attacks of `side`, with every unit unmoved:
 * the number of (unit, destination) moves, and the value of the distinct
 * enemy units it can capture.
 */
export function activity(s: VectorState, side: Side): { moves: number; attacked: number } {
  const fresh = { ...s, moved: new Uint8Array(N) };
  const out: number[] = [];
  const hit = new Set<number>();
  let moves = 0;
  for (const t of playableTiles) {
    if (s.u[t] * side <= 0) continue;
    out.length = 0;
    unitMoves(fresh, t, out);
    moves += out.length;
    for (const m of out) if (s.u[m & 127]) hit.add(m & 127);
  }
  let attacked = 0;
  for (const t of hit) {
    const r = Math.abs(s.u[t]);
    attacked += r === 4 ? KING_THREAT_VALUE : UNIT_VALUE[r];
  }
  return { moves, attacked };
}

function material(s: VectorState, side: Side): number {
  let m = 0;
  for (const t of playableTiles) {
    const v = s.u[t] * side;
    if (v) m += v > 0 ? UNIT_VALUE[v] : -UNIT_VALUE[-v];
  }
  return m;
}

/** Static score of `s` from `side`'s point of view. */
export function score(s: VectorState, side: Side, w: Weights = DEFAULT_WEIGHTS): number {
  if (s.winner) return s.winner === side ? WIN : -WIN;
  let total = 0;
  if (w.concentration) total += w.concentration * concentration(s, side);
  if (w.mobility || w.threats) {
    const own = activity(s, side), opp = activity(s, -side as Side);
    total += w.mobility * (own.moves - opp.moves) + w.threats * (own.attacked - opp.attacked);
  }
  if (w.material) total += w.material * material(s, side);
  return total;
}

function minimax(s: VectorState, depth: number, alpha: number, beta: number, root: Side, w: Weights): number {
  if (depth === 0 || s.winner) {
    const v = score(s, root, w);
    return s.winner ? v + Math.sign(v) * depth : v; // prefer quicker wins, slower losses
  }
  const maximizing = s.side === root;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of legalMoves(s)) {
    const v = minimax(applyMove(s, m), depth - 1, alpha, beta, root, w);
    if (maximizing) { if (v > best) best = v; if (v > alpha) alpha = v; }
    else { if (v < best) best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  return best;
}

/** Picks a move for the side to move; ties are broken at random. */
export function chooseMove(s: VectorState, w: Weights = DEFAULT_WEIGHTS): { move: number; score: number } | null {
  const moves = legalMoves(s);
  if (moves.length === 0) return null;
  let best = -Infinity;
  let candidates: number[] = [];
  for (const m of moves) {
    // Alpha just below `best` keeps exact scores for moves that tie with it
    const v = minimax(applyMove(s, m), w.plies - 1, best - 1e-6, Infinity, s.side, w);
    if (v > best) { best = v; candidates = [m]; }
    else if (v === best) candidates.push(m);
  }
  return { move: candidates[Math.floor(Math.random() * candidates.length)], score: best };
}

export function chooseConcentrationAction(
  state: GameState,
  tiles: Map<string, HexTile>,
  w: Weights = DEFAULT_WEIGHTS
): { action: GameAction; score: number; depth: number; nodes: number; timeMs: number } | null {
  const started = Date.now();
  const choice = chooseMove(fromGameState(state), w);
  if (!choice) return null;
  return {
    action: toGameAction(state, tiles, choice.move),
    score: choice.score,
    depth: w.plies,
    nodes: 0,
    timeMs: Date.now() - started,
  };
}
