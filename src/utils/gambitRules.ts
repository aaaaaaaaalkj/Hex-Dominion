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
 * - Scout: faces an edge; 3 points per move, a step forward costs 1, a 60° turn costs 2;
 *   captures by stepping forward onto an enemy (ends the move)
 * Nothing jumps. A move may not leave the mover's own King in check.
 */

export const SCOUT_MOVE_POINTS = 3;
export const SCOUT_STEP_COST = 1;
export const SCOUT_TURN_COST = 2;

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

/**
 * Scout moves: explores (position, facing) states spending up to SCOUT_MOVE_POINTS.
 * Every reachable state other than the start is a move (turning in place included).
 */
function scoutMoves(unit: Unit, tiles: Map<string, HexTile>, occupancy: Occupancy): LegalMove[] {
  const startFacing = unit.facing ?? 0;
  type ScoutState = { coord: HexCoord; facing: number; path: HexCoord[]; cost: number };
  const stateKey = (c: HexCoord, f: number) => `${c.q},${c.r},${f}`;

  // Cheapest way to reach each (position, facing); explored in order of points spent
  const best = new Map<string, ScoutState>();
  const buckets: ScoutState[][] = Array.from({ length: SCOUT_MOVE_POINTS + 1 }, () => []);
  const start: ScoutState = { coord: unit.coord, facing: startFacing, path: [], cost: 0 };
  best.set(stateKey(unit.coord, startFacing), start);
  buckets[0].push(start);

  const reach = (state: ScoutState) => {
    if (state.cost > SCOUT_MOVE_POINTS) return;
    const key = stateKey(state.coord, state.facing);
    const known = best.get(key);
    if (known && known.cost <= state.cost) return;
    best.set(key, state);
    buckets[state.cost].push(state);
  };

  const captures = new Map<string, LegalMove>();
  for (let points = 0; points <= SCOUT_MOVE_POINTS; points++) {
    for (const s of buckets[points]) {
      if (best.get(stateKey(s.coord, s.facing)) !== s) continue; // superseded by a cheaper route

      // Turn 60° left or right
      for (const turn of [1, 5]) {
        reach({ coord: s.coord, facing: (s.facing + turn) % 6, path: s.path, cost: points + SCOUT_TURN_COST });
      }

      // Step forward (captures an enemy in the way, which ends the move)
      if (points + SCOUT_STEP_COST > SCOUT_MOVE_POINTS) continue;
      const ahead = add(s.coord, HEX_DIRECTIONS[s.facing]);
      const aheadKey = coordKey(ahead);
      if (!tiles.has(aheadKey)) continue;
      const occupant = occupancy.get(aheadKey);
      if (occupant) {
        const captureKey = stateKey(ahead, s.facing);
        if (occupant.team !== unit.team && !captures.has(captureKey)) {
          captures.set(captureKey, {
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
      reach({ coord: ahead, facing: s.facing, path: [...s.path, ahead], cost: points + SCOUT_STEP_COST });
    }
  }

  // Every reached state except the start is a move (turning in place included)
  const moves: LegalMove[] = [];
  for (const state of best.values()) {
    if (state === start) continue;
    moves.push({ target: state.coord, path: state.path, isAttack: false, facing: state.facing });
  }
  return [...moves, ...captures.values()];
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
