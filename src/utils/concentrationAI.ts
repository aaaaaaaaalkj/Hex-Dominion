/**
 * Experimental Dominion opponent: a greedy one-ply bot that maximizes the
 * concentration of its influence. No look-ahead and no material count; every
 * legal move is scored by the position it leaves behind:
 *
 *   C = sum over playable tiles t of  -I[t] * |I[t]|
 *
 * i.e. the signed square of the influence vector, from Red's (ai, -1) point of
 * view. Squaring rewards stacking influence on few tiles over spreading it thin,
 * and counts the opponent's concentration against us. Captures and wins come
 * out of it indirectly (a removed enemy unit removes its influence), except a
 * game-ending move, which always wins.
 */
import { HexTile } from '../types/game';
import { GameAction, GameState } from './gameState';
import { applyMove, fromGameState, legalMoves, playableTiles, toGameAction, VectorState } from './vectorEngine';

/** Signed squared influence from the point of view of `side`. */
export function concentration(s: VectorState, side: 1 | -1): number {
  if (s.winner) return s.winner === side ? Infinity : -Infinity;
  let c = 0;
  for (const t of playableTiles) {
    const i = s.I[t] * side;
    c += i * Math.abs(i);
  }
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
