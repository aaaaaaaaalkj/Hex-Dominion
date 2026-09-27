import {
  HexCoord,
  HexTile,
  Unit,
  Team,
  LegalMove,
  UnitRank,
} from '../types/game';
import {
  coordKey,
  getHexNeighbors,
  hexDistance,
} from './hexMath';

/**
 * Returns the aura rank of a unit:
 * Aura is reduced by 1 for all units:
 * - Level 4 Sovereign: Level 3 Aura
 * - Level 3 Sentinel: Level 2 Aura
 * - Level 2 Warden: Level 1 Aura
 * - Level 1 Scout: Level 0 Aura (no aura)
 */
export function getUnitAuraRank(rank: UnitRank): number {
  return Math.max(0, rank - 1);
}

/**
 * Returns the movement speed (maximum tile distance) of a unit:
 * Speed is the inverse of rank:
 * - Level 4 Sovereign: 1 tile
 * - Level 3 Sentinel: 2 tiles
 * - Level 2 Warden: 3 tiles
 * - Level 1 Scout: 4 tiles
 */
export function getUnitSpeed(rank: UnitRank): number {
  return 5 - rank;
}

/**
 * Computes the net influence on every tile.
 * Each unit projects its rank onto the tile it stands on and onto every adjacent tile.
 * Player (blue) influence is positive, AI (red) influence is negative, so opposing
 * influences cancel out: 7 red + 5 blue = -2 (2 red).
 */
export function computeInfluenceMap(
  tiles: Map<string, HexTile>,
  units: Unit[]
): Map<string, number> {
  const influence = new Map<string, number>();
  for (const key of tiles.keys()) {
    influence.set(key, 0);
  }
  for (const u of units) {
    if (u.isDefeated) continue;
    const value = u.team === 'player' ? u.rank : -u.rank;
    for (const c of [u.coord, ...getHexNeighbors(u.coord)]) {
      const key = coordKey(c);
      const current = influence.get(key);
      if (current !== undefined) {
        influence.set(key, current + value);
      }
    }
  }
  return influence;
}

/**
 * Counts the tiles where each team holds net influence.
 */
export function countInfluencedTiles(influence: Map<string, number>): {
  player: number;
  ai: number;
} {
  let player = 0;
  let ai = 0;
  for (const value of influence.values()) {
    if (value > 0) player++;
    else if (value < 0) ai++;
  }
  return { player, ai };
}

/**
 * Calculates the total defensive rank of a defending unit:
 * Total defensive rank = defender's own rank + sum of aura ranks of direct friendly neighbors.
 * Note: Level 1 Scouts have aura 0, so they provide +0 combat support.
 */
export function calculateDefensiveRank(
  defender: Unit,
  units: Unit[]
): number {
  let totalRank = defender.rank;
  for (const u of units) {
    if (u.isDefeated || u.id === defender.id || u.team !== defender.team) continue;
    if (hexDistance(u.coord, defender.coord) <= 1) {
      totalRank += getUnitAuraRank(u.rank);
    }
  }
  return totalRank;
}

/**
 * Calculates the total attack rank of an attacking unit against a target coordinate:
 * Total attack rank = attacker's own rank + sum of aura ranks of direct friendly neighbors of the target.
 * Note: Level 1 Scouts have aura 0, so they provide +0 combat support.
 */
export function calculateAttackRank(
  attacker: Unit,
  targetCoord: HexCoord,
  units: Unit[]
): number {
  let totalRank = attacker.rank;
  for (const u of units) {
    if (u.isDefeated || u.id === attacker.id || u.team !== attacker.team) continue;
    if (hexDistance(u.coord, targetCoord) <= 1) {
      totalRank += getUnitAuraRank(u.rank);
    }
  }
  return totalRank;
}

/**
 * Returns all active friendly units with aura > 0 projecting support onto a unit.
 */
export function getDirectSupporters(
  unit: Unit,
  units: Unit[]
): Unit[] {
  const supporters: Unit[] = [];
  for (const u of units) {
    if (u.isDefeated || u.id === unit.id || u.team !== unit.team) continue;
    if (hexDistance(u.coord, unit.coord) <= 1 && getUnitAuraRank(u.rank) > 0) {
      supporters.push(u);
    }
  }
  return supporters;
}

/**
 * Returns opponent units with active aura (> 0) in proximity to a tile.
 */
export function getOpponentAurasAtCoord(
  team: Team,
  tile: HexTile,
  units: Unit[]
): Unit[] {
  const enemyTeam: Team = team === 'player' ? 'ai' : 'player';
  const supporters: Unit[] = [];
  for (const u of units) {
    if (u.isDefeated || u.team !== enemyTeam) continue;
    if (hexDistance(u.coord, tile) <= 1 && getUnitAuraRank(u.rank) > 0) {
      supporters.push(u);
    }
  }
  return supporters;
}

/**
 * Returns friendly units with active aura (> 0) in proximity to a tile.
 */
export function getFriendlyAurasAtCoord(
  team: Team,
  tile: HexTile,
  units: Unit[]
): Unit[] {
  const supporters: Unit[] = [];
  for (const u of units) {
    if (u.isDefeated || u.team !== team) continue;
    if (hexDistance(u.coord, tile) <= 1 && getUnitAuraRank(u.rank) > 0) {
      supporters.push(u);
    }
  }
  return supporters;
}

/**
 * Calculates all legal moves for a given unit.
 *
 * Enforces:
 * 1. Unit Speed (Inverse of Rank):
 *    - Level 4: 1 tile
 *    - Level 3: 2 tiles
 *    - Level 2: 3 tiles
 *    - Level 1: 4 tiles
 * 2. Combined Rank Combat:
 *    - Capture requires: Attack Rank > Defensive Rank.
 *    - Defender DEF = defender rank + sum of friendly neighbor auras.
 *    - Attacker ATK = attacker rank + sum of target friendly neighbor auras.
 * 3. Traversal:
 *    - Can freely pass through empty tiles and tiles occupied by friendly units.
 *    - Enemy units block traversal beyond their tile.
 */
export function calculateLegalMovesForUnit(
  unit: Unit,
  tiles: Map<string, HexTile>,
  units: Unit[]
): LegalMove[] {
  if (unit.isDefeated || unit.hasMovedThisRound) {
    return [];
  }

  const maxSteps = getUnitSpeed(unit.rank);

  // Fast unit position lookup
  const unitMap = new Map<string, Unit>();
  for (const u of units) {
    if (!u.isDefeated) {
      unitMap.set(coordKey(u.coord), u);
    }
  }

  const legalMoves: LegalMove[] = [];
  const visited = new Set<string>();

  const startKey = coordKey(unit.coord);
  visited.add(startKey);

  // BFS Queue: { coord, path, steps }
  const queue: { coord: HexCoord; path: HexCoord[]; steps: number }[] = [
    { coord: unit.coord, path: [], steps: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.steps >= maxSteps) continue;

    const neighbors = getHexNeighbors(current.coord);

    for (const nextCoord of neighbors) {
      const nextKey = coordKey(nextCoord);

      // Must be a valid tile on the board
      if (!tiles.has(nextKey) || visited.has(nextKey)) continue;

      const occupant = unitMap.get(nextKey);
      const newPath = [...current.path, nextCoord];
      const newSteps = current.steps + 1;

      // 1. Enemy unit occupant (Combat):
      if (occupant && occupant.team !== unit.team) {
        // Combined Rank Evaluation:
        const defenseRank = calculateDefensiveRank(occupant, units);
        const attackRank = calculateAttackRank(unit, nextCoord, units);

        // Can capture if combined attack rank exceeds combined defensive rank
        if (attackRank > defenseRank) {
          visited.add(nextKey);
          legalMoves.push({
            target: nextCoord,
            path: newPath,
            isAttack: true,
            targetUnitId: occupant.id,
            targetUnitRank: occupant.rank,
            attackRank,
            defenseRank,
          });
        }
        // Enemy blocks traversing beyond its tile
        continue;
      }

      visited.add(nextKey);

      // 2. Empty hex is a valid destination (friendly-occupied hexes are pass-through only)
      if (!occupant) {
        legalMoves.push({
          target: nextCoord,
          path: newPath,
          isAttack: false,
        });
      }

      if (newSteps < maxSteps) {
        queue.push({
          coord: nextCoord,
          path: newPath,
          steps: newSteps,
        });
      }
    }
  }

  return legalMoves;
}

/**
 * Checks whether any alive unit of a team has at least one legal move.
 */
export function hasAnyLegalMoves(
  team: Team,
  tiles: Map<string, HexTile>,
  units: Unit[]
): boolean {
  for (const unit of units) {
    if (unit.team === team && !unit.isDefeated && !unit.hasMovedThisRound) {
      const moves = calculateLegalMovesForUnit(unit, tiles, units);
      if (moves.length > 0) return true;
    }
  }
  return false;
}

/**
 * Executes a move on the board state.
 */
export function applyMove(
  unitId: string,
  move: LegalMove,
  units: Unit[]
): {
  newUnits: Unit[];
  capturedUnit: Unit | null;
  isGameOver: boolean;
  winner: Team | null;
} {
  const newUnits = units.map((u) => ({ ...u, coord: { ...u.coord } }));

  const unit = newUnits.find((u) => u.id === unitId);
  if (!unit) {
    throw new Error(`Unit ${unitId} not found`);
  }

  unit.coord = { ...move.target };
  unit.hasMovedThisRound = true;

  let capturedUnit: Unit | null = null;
  let isGameOver = false;
  let winner: Team | null = null;

  if (move.isAttack && move.targetUnitId) {
    const victim = newUnits.find((u) => u.id === move.targetUnitId);
    if (victim) {
      victim.isDefeated = true;
      capturedUnit = { ...victim };

      if (victim.rank === 4) {
        isGameOver = true;
        winner = unit.team;
      }
    }
  }

  const enemyTeam: Team = unit.team === 'player' ? 'ai' : 'player';
  const remainingEnemies = newUnits.filter(
    (u) => u.team === enemyTeam && !u.isDefeated
  );
  if (remainingEnemies.length === 0) {
    isGameOver = true;
    winner = unit.team;
  }

  return {
    newUnits,
    capturedUnit,
    isGameOver,
    winner,
  };
}
