import { HexCoord, HexTile, LegalMove, Team, Unit } from '../types/game';
import { HEX_DIRECTIONS, coordKey, hexDistance } from './hexMath';

/**
 * Gambit: chess-like rules on the hex board.
 * - King: 1 hex in any of the 6 edge directions
 * - Rook: slides any distance horizontally through edges (E/W) and vertically
 *   through corners (N/S), like a chess rook. No squeezing: a corner step is
 *   blocked when both hexes beside that corner are occupied
 * - Bishop: slides any distance through the 4 non-horizontal edges (NE, NW, SW, SE)
 * Pieces capture along every line they move on.
 * - Scout (pawn-like): faces an edge. A move is one of: advance 1 or 2 hexes straight
 *   ahead (no capture), turn 60° left or right in place, or turn 60° and capture an
 *   enemy on the adjacent hex in the new facing
 * Nothing jumps. A move may not leave the mover's own King in check.
 */

export const SCOUT_MAX_ADVANCE = 2;

type Occupancy = Map<string, Unit>;

// A line a sliding piece moves and captures along. Corner (vertical) steps pass
// between two hexes (`between`, relative to the tile the step starts from).
export interface Line {
  step: HexCoord;
  between?: readonly [HexCoord, HexCoord];
}

// Pointy-top hexes; HEX_DIRECTIONS: 0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE. Each set is
// closed under reversal, so the same sets also tell which pieces attack a tile.
export const KING_LINES: readonly Line[] = HEX_DIRECTIONS.map((step) => ({ step }));
export const ROOK_LINES: readonly Line[] = [
  { step: HEX_DIRECTIONS[0] }, // E
  { step: HEX_DIRECTIONS[3] }, // W
  { step: { q: 1, r: -2 }, between: [HEX_DIRECTIONS[1], HEX_DIRECTIONS[2]] }, // N, top corner
  { step: { q: -1, r: 2 }, between: [HEX_DIRECTIONS[4], HEX_DIRECTIONS[5]] }, // S, bottom corner
];
export const BISHOP_LINES: readonly Line[] = [1, 2, 4, 5].map((i) => ({ step: HEX_DIRECTIONS[i] }));

/**
 * Tiles along a line from `from` (exclusive): stops at the board edge, before a
 * squeezed corner (both hexes beside it occupied) and at the first occupied tile
 * (included, so the caller can decide about a capture).
 */
export function traceLine(
  from: HexCoord,
  line: Line,
  maxSteps: number,
  tiles: Map<string, HexTile>,
  isOccupied: (key: string) => boolean
): HexCoord[] {
  const result: HexCoord[] = [];
  let coord = from;
  for (let step = 0; step < maxSteps; step++) {
    if (
      line.between &&
      isOccupied(coordKey(add(coord, line.between[0]))) &&
      isOccupied(coordKey(add(coord, line.between[1])))
    ) {
      break;
    }
    coord = add(coord, line.step);
    const key = coordKey(coord);
    if (!tiles.has(key)) break;
    result.push(coord);
    if (isOccupied(key)) break;
  }
  return result;
}

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
  lines: readonly Line[],
  maxSteps: number,
  tiles: Map<string, HexTile>,
  occupancy: Occupancy
): LegalMove[] {
  const moves: LegalMove[] = [];
  const isOccupied = (key: string) => occupancy.has(key);
  for (const line of lines) {
    const path = traceLine(unit.coord, line, maxSteps, tiles, isOccupied);
    path.forEach((coord, i) => {
      const occupant = occupancy.get(coordKey(coord));
      const stepPath = path.slice(0, i + 1);
      if (!occupant) {
        moves.push({ target: coord, path: stepPath, isAttack: false });
      } else if (occupant.team !== unit.team) {
        moves.push({
          target: coord,
          path: stepPath,
          isAttack: true,
          targetUnitId: occupant.id,
          targetUnitRank: occupant.rank,
        });
      }
    });
  }
  return moves;
}

// Facings a Scout can turn to (60° left or right); it captures on the adjacent hex in those directions
function scoutTurns(facing: number): number[] {
  return [(facing + 1) % 6, (facing + 5) % 6];
}

/**
 * Scout moves: advance 1-2 hexes (no capture), turn in place, or turn and capture.
 */
function scoutMoves(unit: Unit, tiles: Map<string, HexTile>, occupancy: Occupancy): LegalMove[] {
  const facing = unit.facing ?? 0;
  const moves: LegalMove[] = [];

  // Advance straight ahead onto empty hexes only
  let coord = unit.coord;
  const path: HexCoord[] = [];
  for (let step = 0; step < SCOUT_MAX_ADVANCE; step++) {
    coord = add(coord, HEX_DIRECTIONS[facing]);
    const key = coordKey(coord);
    if (!tiles.has(key) || occupancy.has(key)) break;
    path.push(coord);
    moves.push({ target: coord, path: [...path], isAttack: false, facing });
  }

  for (const turned of scoutTurns(facing)) {
    // Turn in place
    moves.push({ target: unit.coord, path: [], isAttack: false, facing: turned });

    // Turn and capture the adjacent enemy in the new facing
    const target = add(unit.coord, HEX_DIRECTIONS[turned]);
    const occupant = occupancy.get(coordKey(target));
    if (occupant && occupant.team !== unit.team) {
      moves.push({
        target,
        path: [target],
        isAttack: true,
        targetUnitId: occupant.id,
        targetUnitRank: occupant.rank,
        facing: turned,
      });
    }
  }
  return moves;
}

function pseudoLegalMoves(unit: Unit, tiles: Map<string, HexTile>, occupancy: Occupancy): LegalMove[] {
  switch (unit.rank) {
    case 4:
      return slidingMoves(unit, KING_LINES, 1, tiles, occupancy);
    case 3:
      return slidingMoves(unit, ROOK_LINES, Infinity, tiles, occupancy);
    case 2:
      return slidingMoves(unit, BISHOP_LINES, Infinity, tiles, occupancy);
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

  // Rays from the King: the first piece hit along a line attacks the King if that
  // piece moves along the line (King: adjacent only). Squeezed corners block both ways.
  const rays: [readonly Line[], number, number][] = [
    [ROOK_LINES, 3, Infinity],
    [BISHOP_LINES, 2, Infinity],
    [KING_LINES, 4, 1],
  ];
  const isOccupied = (key: string) => occupancy.has(key);
  for (const [lines, attacker, maxSteps] of rays) {
    for (const line of lines) {
      const path = traceLine(king.coord, line, maxSteps, tiles, isOccupied);
      const last = path[path.length - 1];
      const occupant = last && occupancy.get(coordKey(last));
      if (occupant && occupant.team !== team && occupant.rank === attacker) return true;
    }
  }

  // Scouts attack the adjacent hexes 60° left and right of their facing
  for (const u of units) {
    if (u.isDefeated || u.team === team || u.rank !== 1 || hexDistance(u.coord, king.coord) !== 1) continue;
    for (const turned of scoutTurns(u.facing ?? 0)) {
      const attacked = add(u.coord, HEX_DIRECTIONS[turned]);
      if (attacked.q === king.coord.q && attacked.r === king.coord.r) return true;
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
