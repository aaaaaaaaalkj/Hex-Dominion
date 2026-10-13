/**
 * Experimental Dominion opponent: a greedy one-ply bot that maximizes the
 * concentration of its influence. No look-ahead and no material count; every
 * legal move is scored by the position it leaves behind:
 *
 *   C = sum over playable tiles t of  R[t]^2
 *
 * where R is the influence of the mover's own units alone (the opponent's units
 * are ignored, so moving next to them gains nothing). Squaring rewards stacking
 * influence on few tiles over spreading it thin. A game-ending move always wins;
 * otherwise captures count only through the tiles the capturing unit lands on.
 */
import { HexTile } from '../types/game';
import { GameAction, GameState } from './gameState';
import { applyMove, closed, fromGameState, legalMoves, N, playableTiles, toGameAction, VectorState } from './vectorEngine';

/** Sum of squares of the influence of `side`'s own units. */
export function concentration(s: VectorState, side: 1 | -1): number {
  if (s.winner) return s.winner === side ? Infinity : -Infinity;
  const own = new Int16Array(N);
  for (const t of playableTiles) {
    const v = s.u[t] * side;
    if (v > 0) for (const j of closed[t]) own[j] += v;
  }
  let c = 0;
  for (const t of playableTiles) c += own[t] * own[t];
  return c;
}

export function chooseConcentrationAction(
  state: GameState,
  tiles: Map<string, HexTile>
): { action: GameAction; score: number; depth: number; nodes: number; timeMs: number } | null {
  const started = Date.now();
  const s = fromGameState(state);
  const moves = legalMoves(s);
  if (moves.length === 0) return null;

  let best = -Infinity;
  let candidates: number[] = [];
  for (const m of moves) {
    const c = concentration(applyMove(s, m), s.side);
    if (c > best) { best = c; candidates = [m]; }
    else if (c === best) candidates.push(m);
  }
  const move = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    action: toGameAction(state, tiles, move),
    score: best,
    depth: 1,
    nodes: moves.length,
    timeMs: Date.now() - started,
  };
}
