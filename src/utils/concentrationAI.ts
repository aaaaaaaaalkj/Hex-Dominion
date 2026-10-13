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
 *                  the opponent attacks (Kings count KING_THREAT_VALUE). With
 *                  `timing`, a threat the target can answer first (its side gets
 *                  to move it before the attacker acts, see `moveSlots`) counts
 *                  only (1 - timing) as much
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
  timing: number; // 0..1: discount for threats the target can answer first
  plies: number; // search depth in single-unit moves
}

// Tuned with scripts/ai-match.mjs: material and threats with a 2-ply look-ahead beat
// the alpha-beta engine at 200 ms/move 7-1-0; mobility lost games in every pairing,
// and dropping concentration fell to 38%.
export const DEFAULT_WEIGHTS: Weights = { concentration: 1, mobility: 0, material: 2, threats: 1, timing: 0, plies: 2 };

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
 * The move order from now to the end of the next round, assuming no unit is
 * captured or blocked meanwhile. Returns, for each tile, the earliest slot
 * (0 = the move being made now) at which its unit may act: units of one rank
 * share the slots of that rank, since their owner picks which goes first.
 * Mirrors the rank order and turn hand-over of vectorEngine.ts: sides
 * alternate, a side with nothing left is skipped, and the side that made the
 * last move of a round moves second in the next.
 */
export function moveSlots(s: VectorState): Float64Array {
  const fresh = { ...s, moved: new Uint8Array(N) };
  // Ranks still to move, highest first: this round (unmoved, can move) and the next
  const queues = (st: VectorState, side: Side) => {
    const ranks: number[] = [];
    for (const t of playableTiles) {
      const v = s.u[t] * side;
      if (v > 0 && !st.moved[t] && unitMoves(st, t, [], true).length) ranks.push(v);
    }
    return ranks.sort((a, b) => b - a);
  };
  const first = new Map<number, number>(); // side * 10 + rank -> slot this round
  const next = new Map<number, number>(); // the same for the next round
  let slot = 0;
  const run = (q: Record<number, number[]>, start: Side, into: Map<number, number>): Side => {
    let side = start, last = start;
    while (q[side].length || q[-side].length) {
      if (!q[side].length) side = -side as Side;
      const key = side * 10 + q[side].shift()!;
      if (!into.has(key)) into.set(key, slot);
      slot++;
      last = side;
      side = -side as Side;
    }
    return last;
  };
  const last = run({ 1: queues(s, 1), [-1]: queues(s, -1) }, s.side, first);
  run({ 1: queues(fresh, 1), [-1]: queues(fresh, -1) }, -last as Side, next);

  const slots = new Float64Array(N).fill(Infinity);
  for (const t of playableTiles) {
    const v = s.u[t];
    if (!v) continue;
    const key = Math.sign(v) * 10 + Math.abs(v);
    // A unit that has moved, or is blocked, acts next round at the earliest
    const now = !s.moved[t] && unitMoves(s, t, [], true).length > 0;
    slots[t] = (now ? first.get(key) : undefined) ?? next.get(key) ?? Infinity;
  }
  return slots;
}

/**
 * Freedom of movement and attacks of `side`, with every unit unmoved:
 * the number of (unit, destination) moves, and the value of the distinct
 * enemy units it can capture. With `slots` (moveSlots), a target whose unit
 * acts before every one of its attackers counts only `answerable` as much.
 */
export function activity(
  s: VectorState,
  side: Side,
  slots?: Float64Array,
  answerable = 1
): { moves: number; attacked: number } {
  const fresh = { ...s, moved: new Uint8Array(N) };
  const out: number[] = [];
  const hit = new Map<number, number>(); // target tile -> earliest attacker slot
  let moves = 0;
  for (const t of playableTiles) {
    if (s.u[t] * side <= 0) continue;
    out.length = 0;
    unitMoves(fresh, t, out);
    moves += out.length;
    const at = slots ? slots[t] : 0;
    for (const m of out) {
      const target = m & 127;
      if (s.u[target]) hit.set(target, Math.min(hit.get(target) ?? Infinity, at));
    }
  }
  let attacked = 0;
  for (const [t, at] of hit) {
    const r = Math.abs(s.u[t]);
    const value = r === 4 ? KING_THREAT_VALUE : UNIT_VALUE[r];
    attacked += slots && slots[t] < at ? answerable * value : value;
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
    const slots = w.timing ? moveSlots(s) : undefined;
    const own = activity(s, side, slots, 1 - w.timing), opp = activity(s, -side as Side, slots, 1 - w.timing);
    total += w.mobility * (own.moves - opp.moves) + w.threats * (own.attacked - opp.attacked);
  }
  if (w.material) total += w.material * material(s, side);
  return total;
}

/**
 * The concentration score from Red's point of view, as the evaluation of the
 * alpha-beta engine (vectorEngine.chooseMove). `plies` is ignored.
 */
export const asEvaluator = (w: Weights = DEFAULT_WEIGHTS) => (s: VectorState) => score(s, -1, w);

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
