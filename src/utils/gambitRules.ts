import { HexCoord, HexTile, LegalMove, Team, Unit } from '../types/game';
import { HEX_DIAGONALS, HEX_DIRECTIONS, coordKey, hexDistance } from './hexMath';

/**
 * Gambit: chess-like rules on the hex board.
 * - King: 1 hex in any of the 6 edge directions
 * - Rook: slides any distance along the 6 edge directions
 * - Bishop: slides any distance along the 6 corner (diagonal) directions
 * - Scout: faces an edge; 4 points per move, a step forward or a 60° turn costs 1;
 *   captures by stepping forward onto an enemy (ends the move)
 * Nothing jumps. A move may not leave the mover's own King in check.
 */

export const SCOUT_MOVE_POINTS = 4;

type Occupancy = Map<string, Unit>;

function buildOccupancy(units: Unit[]): Occupancy {
  const occupancy: Occupancy = new Map();
  for (const u of units) {
    if (!u.isDefeated) occupancy.set(coordKey(u.coord), u);
  }
  return occupancy;
}

const add = (a: HexCoord, b: HexCoord): HexCoord => ({ q: a.q + b.q, r: a.r + b.r });

function slidingMoves(
  unit: Unit,
  directions: readonly HexCoord[],
  maxSteps: number,
  tiles: Map<string, HexTile>,
  occupancy: Occupancy
): LegalMove[] {
  const moves: LegalMove[] = [];
  for (const dir of directions) {
    let coord = unit.coord;
    const path: HexCoord[] = [];
    for (let step = 0; step < maxSteps; step++) {
      coord = add(coord, dir);
      if (!tiles.has(coordKey(coord))) break;
      path.push(coord);
      const occupant = occupancy.get(coordKey(coord));
      if (occupant) {
        if (occupant.team !== unit.team) {
          moves.push({
            target: coord,
            path: [...path],
            isAttack: true,
            targetUnitId: occupant.id,
            targetUnitRank: occupant.rank,
          });
        }
        break;
      }
      moves.push({ target: coord, path: [...path], isAttack: false });
    }
  }
  return moves;
}

/**
 * Scout moves: explores (position, facing) states spending up to SCOUT_MOVE_POINTS.
 * Every reachable state other than the start is a move (turning in place included).
 */
function scoutMoves(unit: Unit, tiles: Map<string, HexTile>, occupancy: Occupancy): LegalMove[] {
  const startFacing = unit.facing ?? 0;
  const stateKey = (c: HexCoord, f: number) => `${c.q},${c.r},${f}`;
  const seen = new Set<string>([stateKey(unit.coord, startFacing)]);
  const moves: LegalMove[] = [];
  const captureKeys = new Set<string>();

  let frontier: { coord: HexCoord; facing: number; path: HexCoord[] }[] = [
    { coord: unit.coord, facing: startFacing, path: [] },
  ];

  for (let points = 0; points < SCOUT_MOVE_POINTS; points++) {
    const next: typeof frontier = [];
    for (const s of frontier) {
      // Turn 60° left or right
      for (const turn of [1, 5]) {
        const facing = (s.facing + turn) % 6;
        const key = stateKey(s.coord, facing);
        if (seen.has(key)) continue;
        seen.add(key);
        next.push({ coord: s.coord, facing, path: s.path });
        moves.push({ target: s.coord, path: s.path, isAttack: false, facing });
      }

      // Step forward
      const ahead = add(s.coord, HEX_DIRECTIONS[s.facing]);
      const aheadKey = coordKey(ahead);
      if (!tiles.has(aheadKey)) continue;
      const occupant = occupancy.get(aheadKey);
      if (occupant) {
        const captureKey = stateKey(ahead, s.facing);
        if (occupant.team !== unit.team && !captureKeys.has(captureKey)) {
          captureKeys.add(captureKey);
          moves.push({
            target: ahead,
            path: [...s.path, ahead],
            isAttack: true,
            targetUnitId: occupant.id,
            targetUnitRank: occupant.rank,
            facing: s.facing,
          });
        }
        continue;
      }
      const key = stateKey(ahead, s.facing);
      if (seen.has(key)) continue;
      seen.add(key);
      const path = [...s.path, ahead];
      next.push({ coord: ahead, facing: s.facing, path });
      moves.push({ target: ahead, path, isAttack: false, facing: s.facing });
    }
    frontier = next;
  }

  // Ending on the start tile with the start facing is not a move
  return moves.filter(
    (m) => !(m.target.q === unit.coord.q && m.target.r === unit.coord.r && m.facing === startFacing)
  );
}

function pseudoLegalMoves(unit: Unit, tiles: Map<string, HexTile>, occupancy: Occupancy): LegalMove[] {
  switch (unit.rank) {
    case 4:
      return slidingMoves(unit, HEX_DIRECTIONS, 1, tiles, occupancy);
    case 3:
      return slidingMoves(unit, HEX_DIRECTIONS, Infinity, tiles, occupancy);
    case 2:
      return slidingMoves(unit, HEX_DIAGONALS, Infinity, tiles, occupancy);
    case 1:
      return scoutMoves(unit, tiles, occupancy);
  }
}

/**
 * True if `team`'s King is attacked by any enemy piece.
 */
export function isKingInCheck(team: Team, tiles: Map<string, HexTile>, units: Unit[]): boolean {
  const king = units.find((u) => u.team === team && u.rank === 4 && !u.isDefeated);
  if (!king) return false;
  const occupancy = buildOccupancy(units);

  // Rays from the King: first piece hit along edges (Rook/adjacent King) or corners (Bishop)
  for (const [directions, slider] of [
    [HEX_DIRECTIONS, 3],
    [HEX_DIAGONALS, 2],
  ] as const) {
    for (const dir of directions) {
      let coord = king.coord;
      for (let step = 1; ; step++) {
        coord = add(coord, dir);
        if (!tiles.has(coordKey(coord))) break;
        const occupant = occupancy.get(coordKey(coord));
        if (!occupant) continue;
        if (occupant.team !== team) {
          if (occupant.rank === slider) return true;
          if (slider === 3 && occupant.rank === 4 && step === 1) return true;
        }
        break;
      }
    }
  }

  // Scouts within reach
  for (const u of units) {
    if (u.isDefeated || u.team === team || u.rank !== 1) continue;
    if (hexDistance(u.coord, king.coord) > SCOUT_MOVE_POINTS) continue;
    if (scoutMoves(u, tiles, occupancy).some((m) => m.isAttack && m.targetUnitId === king.id)) {
      return true;
    }
  }
  return false;
}

/**
 * Applies a Gambit move: relocates the piece (and turns a Scout), removes a captured piece.
 */
export function applyGambitMove(
  unitId: string,
  move: LegalMove,
  units: Unit[]
): { newUnits: Unit[]; capturedUnit: Unit | null } {
  let capturedUnit: Unit | null = null;
  const newUnits = units.map((u) => {
    if (u.id === unitId) {
      return {
        ...u,
        coord: { ...move.target },
        facing: move.facing ?? u.facing,
      };
    }
    if (move.isAttack && u.id === move.targetUnitId) {
      capturedUnit = { ...u, isDefeated: true };
      return capturedUnit;
    }
    return u;
  });
  return { newUnits, capturedUnit };
}

/**
 * Legal moves of a piece: pseudo-legal moves that do not leave its own King in check.
 */
export function calculateGambitMoves(
  unit: Unit,
  tiles: Map<string, HexTile>,
  units: Unit[]
): LegalMove[] {
  if (unit.isDefeated) return [];
  return pseudoLegalMoves(unit, tiles, buildOccupancy(units)).filter(
    (move) => !isKingInCheck(unit.team, tiles, applyGambitMove(unit.id, move, units).newUnits)
  );
}

export function hasAnyGambitMove(team: Team, tiles: Map<string, HexTile>, units: Unit[]): boolean {
  const occupancy = buildOccupancy(units);
  for (const unit of units) {
    if (unit.isDefeated || unit.team !== team) continue;
    for (const move of pseudoLegalMoves(unit, tiles, occupancy)) {
      if (!isKingInCheck(team, tiles, applyGambitMove(unit.id, move, units).newUnits)) return true;
    }
  }
  return false;
}
