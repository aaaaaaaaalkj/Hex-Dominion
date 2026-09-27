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
 * Precomputes the set of all hex keys reachable by team territory:
 * Units can only move on tiles controlled by their team
 * or on hexes in direct neighbourhood of those (frontier tiles).
 */
export function computeTeamReachSet(
  team: Team,
  tiles: Map<string, HexTile>
): Set<string> {
  const reachSet = new Set<string>();
  for (const tile of tiles.values()) {
    if (tile.controlledBy === team) {
      reachSet.add(tile.id);
      for (const n of getHexNeighbors(tile)) {
        reachSet.add(coordKey(n));
      }
    }
  }
  return reachSet;
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
 * Calculates the total defensive rank of an empty opponent tile:
 * "capturing (empty) opponents territory should follow the same rules as capturing units.
 * Territory itself has 0 rank if it is empty. If friendly neighboring units project their aura
 * ( 1 less than rank ) then the rank is increased."
 */
export function calculateTerritoryDefensiveRank(
  tile: HexTile,
  units: Unit[]
): number {
  if (tile.controlledBy === null) {
    return 0; // Neutral territory has 0 rank
  }
  const defendingTeam = tile.controlledBy;
  let totalDefRank = 0; // Territory itself has 0 rank if empty
  for (const u of units) {
    if (u.isDefeated || u.team !== defendingTeam) continue;
    if (hexDistance(u.coord, tile) <= 1) {
      totalDefRank += getUnitAuraRank(u.rank);
    }
  }
  return totalDefRank;
}

/**
 * Calculates the maximum opponent aura rank protecting a given tile.
 * Alias for territory defense rank.
 */
export function getTileAuraDefense(
  team: Team,
  tile: HexTile,
  units: Unit[]
): number {
  if (tile.controlledBy === team || tile.controlledBy === null) {
    return 0;
  }
  return calculateTerritoryDefensiveRank(tile, units);
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
 * 2. Territorial Aura Protection:
 *    - Enemy tiles protected by an opponent aura require unit.rank > auraRank to enter.
 *    - Level 1 scouts have aura = 0, so territory guarded only by scouts has aura = 0 and can be captured by opponent scouts!
 * 3. Combined Rank Combat:
 *    - Capture requires: Attack Rank > Defensive Rank.
 *    - Defender DEF = defender rank + sum of friendly neighbor auras.
 *    - Attacker ATK = attacker rank + sum of target friendly neighbor auras.
 * 4. Traversal:
 *    - Can only traverse through team-controlled tiles.
 *    - Can freely pass through tiles occupied by friendly units.
 */
export function calculateLegalMovesForUnit(
  unit: Unit,
  tiles: Map<string, HexTile>,
  units: Unit[],
  precomputedReach?: Set<string>
): LegalMove[] {
  if (unit.isDefeated || unit.hasMovedThisRound) {
    return [];
  }

  const reachSet = precomputedReach ?? computeTeamReachSet(unit.team, tiles);
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
      const nextTile = tiles.get(nextKey);
      if (!nextTile) continue;

      // Must be controlled by team or in direct neighbourhood of friendly tiles
      if (!reachSet.has(nextKey)) continue;

      const occupant = unitMap.get(nextKey);
      const newPath = [...current.path, nextCoord];
      const newSteps = current.steps + 1;

      // 1. Friendly unit occupant:
      // Can pass through tiles occupied by friendly units
      if (occupant && occupant.team === unit.team) {
        if (!visited.has(nextKey)) {
          visited.add(nextKey);
          if (nextTile.controlledBy === unit.team && newSteps < maxSteps) {
            queue.push({
              coord: nextCoord,
              path: newPath,
              steps: newSteps,
            });
          }
        }
        continue;
      }

      // 2. Enemy unit occupant (Combat):
      if (occupant && occupant.team !== unit.team) {
        // Combined Rank Evaluation:
        const defenseRank = calculateDefensiveRank(occupant, units);
        const attackRank = calculateAttackRank(unit, nextCoord, units);

        // Can capture if combined attack rank exceeds combined defensive rank
        const canCapture = attackRank > defenseRank;

        if (canCapture && !visited.has(nextKey)) {
          visited.add(nextKey);
          legalMoves.push({
            target: nextCoord,
            path: newPath,
            isAttack: true,
            targetUnitId: occupant.id,
            targetUnitRank: occupant.rank,
            attackRank,
            defenseRank,
            flipsControl: nextTile.controlledBy !== unit.team,
          });
        }
        // Enemy blocks traversing beyond its tile
        continue;
      }

      // 3. Empty hex (Territory Movement & Flipping):
      if (!visited.has(nextKey)) {
        const isEnemyTerritory =
          nextTile.controlledBy !== null && nextTile.controlledBy !== unit.team;

        let canEnter = true;
        let attackRank: number | undefined = undefined;
        let defenseRank: number | undefined = undefined;

        if (isEnemyTerritory) {
          // "capturing (empty) opponents territory should follow the same rules as capturing units.
          // Territory itself has 0 rank if it is empty. If friendly neighboring units project their aura
          // ( 1 less than rank ) then the rank is increased. Opposing neighbouring units project their aura
          // ( 1 less than their rank ) and make easier to capture opponents territory."
          defenseRank = calculateTerritoryDefensiveRank(nextTile, units);
          attackRank = calculateAttackRank(unit, nextCoord, units);
          canEnter = attackRank > defenseRank;
        }

        if (canEnter) {
          visited.add(nextKey);

          legalMoves.push({
            target: nextCoord,
            path: newPath,
            isAttack: false,
            attackRank,
            defenseRank,
            flipsControl: nextTile.controlledBy !== unit.team,
          });

          // Can only continue traversing through if this tile is ALREADY controlled by friendly team
          if (nextTile.controlledBy === unit.team && newSteps < maxSteps) {
            queue.push({
              coord: nextCoord,
              path: newPath,
              steps: newSteps,
            });
          }
        }
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
  const reachSet = computeTeamReachSet(team, tiles);

  for (const unit of units) {
    if (unit.team === team && !unit.isDefeated && !unit.hasMovedThisRound) {
      const moves = calculateLegalMovesForUnit(unit, tiles, units, reachSet);
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
  tiles: Map<string, HexTile>,
  units: Unit[]
): {
  newTiles: Map<string, HexTile>;
  newUnits: Unit[];
  capturedUnit: Unit | null;
  territoryClaimed: boolean;
  isGameOver: boolean;
  winner: Team | null;
} {
  const newTiles = new Map(tiles);
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

  const targetKey = coordKey(move.target);
  const targetTile = newTiles.get(targetKey);
  let territoryClaimed = false;

  if (targetTile) {
    if (targetTile.controlledBy !== unit.team) {
      territoryClaimed = true;
      newTiles.set(targetKey, {
        ...targetTile,
        controlledBy: unit.team,
      });
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
    newTiles,
    newUnits,
    capturedUnit,
    territoryClaimed,
    isGameOver,
    winner,
  };
}
