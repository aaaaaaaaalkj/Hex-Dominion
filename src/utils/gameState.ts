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
  // A unit without legal moves holds position (uses up its move this round)
  | { kind: 'skip'; unitId: string }
  // No unit of the side to move can move: all its remaining units hold position
  | { kind: 'pass' };

export function opponentOf(team: Team): Team {
  return team === 'player' ? 'ai' : 'player';
}

function markUnmovedAsMoved(units: Unit[], team: Team): Unit[] {
  return units.map((u) =>
    u.team === team && !u.isDefeated && !u.hasMovedThisRound
      ? { ...u, hasMovedThisRound: true }
      : u
  );
}

function hasUnmoved(units: Unit[], team: Team): boolean {
  return units.some((u) => u.team === team && !u.isDefeated && !u.hasMovedThisRound);
}

/**
 * Decides who acts next after `mover` finished an action:
 * - A side whose remaining units have no legal moves automatically holds position.
 * - The opponent moves next if it can; otherwise the mover continues.
 * - When neither side can move, a new round starts and the side that did
 *   NOT make the last move gets the initiative.
 */
export function advanceTurn(
  units: Unit[],
  mover: Team,
  tiles: Map<string, HexTile>
): { units: Unit[]; currentTurn: Team; newRound: boolean } {
  const other = opponentOf(mover);
  let effective = units;

  for (const team of [other, mover]) {
    if (hasUnmoved(effective, team) && !hasAnyLegalMoves(team, tiles, effective)) {
      effective = markUnmovedAsMoved(effective, team);
    }
  }

  if (hasAnyLegalMoves(other, tiles, effective)) {
    return { units: effective, currentTurn: other, newRound: false };
  }
  if (hasAnyLegalMoves(mover, tiles, effective)) {
    return { units: effective, currentTurn: mover, newRound: false };
  }
  return {
    units: effective.map((u) => ({ ...u, hasMovedThisRound: false })),
    currentTurn: other,
    newRound: true,
  };
}

/**
 * All actions available to the side to move.
 */
export function getActions(state: GameState, tiles: Map<string, HexTile>): GameAction[] {
  if (state.winner) return [];

  const actions: GameAction[] = [];
  const stuck: Unit[] = [];
  for (const unit of state.units) {
    if (unit.team !== state.currentTurn || unit.isDefeated || unit.hasMovedThisRound) continue;
    const moves = calculateLegalMovesForUnit(unit, tiles, state.units);
    if (moves.length === 0) {
      stuck.push(unit);
    }
    for (const move of moves) {
      actions.push({ kind: 'move', unitId: unit.id, move });
    }
  }

  if (actions.length === 0) {
    return [{ kind: 'pass' }];
  }
  for (const unit of stuck) {
    actions.push({ kind: 'skip', unitId: unit.id });
  }
  return actions;
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
  } else if (action.kind === 'skip') {
    units = state.units.map((u) =>
      u.id === action.unitId ? { ...u, hasMovedThisRound: true } : u
    );
  } else {
    units = markUnmovedAsMoved(state.units, mover);
  }

  const next = advanceTurn(units, mover, tiles);
  return {
    units: next.units,
    currentTurn: next.currentTurn,
    roundNumber: state.roundNumber + (next.newRound ? 1 : 0),
    winner: null,
  };
}
