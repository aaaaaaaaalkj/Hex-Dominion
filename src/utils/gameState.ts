import { HexTile, LegalMove, Team, Unit } from '../types/game';
import { applyMove, calculateLegalMovesForUnit, hasAnyLegalMoves } from './gameRules';

/**
 * Pure, immutable game-state model shared by the UI and the AI search.
 */
export interface GameState {
  units: Unit[];
  currentTurn: Team;
  roundNumber: number;
  winner: Team | null;
}

export type GameAction =
  | { kind: 'move'; unitId: string; move: LegalMove }
  // Fallback only: the side to move has no legal move at all (advanceTurn never
  // hands the turn to such a side unless neither side can move)
  | { kind: 'pass' };

export function opponentOf(team: Team): Team {
  return team === 'player' ? 'ai' : 'player';
}

function hasUnmoved(units: Unit[], team: Team): boolean {
  return units.some((u) => u.team === team && !u.isDefeated && !u.hasMovedThisRound);
}

/**
 * Decides who acts next after `mover` finished an action. A side must move if it
 * can; a side without any legal move simply waits (its stuck units stay unmoved
 * and may move later in the round if they get freed).
 * - The opponent moves next if it can; otherwise the mover continues.
 * - When neither side can move, a new round starts. The side that did NOT make
 *   the last move gets the initiative, unless it cannot move.
 * `waiting` names a side that still has unmoved units but no legal move.
 */
export function advanceTurn(
  units: Unit[],
  mover: Team,
  tiles: Map<string, HexTile>
): { units: Unit[]; currentTurn: Team; newRound: boolean; waiting: Team | null } {
  const other = opponentOf(mover);

  if (hasAnyLegalMoves(other, tiles, units)) {
    return { units, currentTurn: other, newRound: false, waiting: null };
  }
  if (hasAnyLegalMoves(mover, tiles, units)) {
    return {
      units,
      currentTurn: mover,
      newRound: false,
      waiting: hasUnmoved(units, other) ? other : null,
    };
  }

  const reset = units.map((u) => ({ ...u, hasMovedThisRound: false }));
  const otherCanStart = hasAnyLegalMoves(other, tiles, reset);
  return {
    units: reset,
    currentTurn: otherCanStart || !hasAnyLegalMoves(mover, tiles, reset) ? other : mover,
    newRound: true,
    waiting: otherCanStart ? null : other,
  };
}

/**
 * All actions available to the side to move.
 */
export function getActions(state: GameState, tiles: Map<string, HexTile>): GameAction[] {
  if (state.winner) return [];

  const actions: GameAction[] = [];
  for (const unit of state.units) {
    if (unit.team !== state.currentTurn || unit.isDefeated || unit.hasMovedThisRound) continue;
    for (const move of calculateLegalMovesForUnit(unit, tiles, state.units)) {
      actions.push({ kind: 'move', unitId: unit.id, move });
    }
  }
  return actions.length > 0 ? actions : [{ kind: 'pass' }];
}

/**
 * Returns the state after the side to move performs `action`.
 */
export function applyAction(
  state: GameState,
  tiles: Map<string, HexTile>,
  action: GameAction
): GameState {
  const mover = state.currentTurn;
  let units: Unit[];

  if (action.kind === 'move') {
    const result = applyMove(action.unitId, action.move, state.units);
    if (result.isGameOver) {
      return { ...state, units: result.newUnits, winner: result.winner };
    }
    units = result.newUnits;
  } else {
    units = state.units;
  }

  const next = advanceTurn(units, mover, tiles);
  return {
    units: next.units,
    currentTurn: next.currentTurn,
    roundNumber: state.roundNumber + (next.newRound ? 1 : 0),
    winner: null,
  };
}
