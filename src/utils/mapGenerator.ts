import { HexCoord, HexTile, Unit, UnitRank, Team } from '../types/game';
import { coordKey, getHexNeighbors } from './hexMath';

export interface GeneratedMap {
  tiles: Map<string, HexTile>;
  units: Unit[];
}

export function generateGameMap(): GeneratedMap {
  // Complete regular hexagon of radius 4 containing all 61 tiles.
  // Full connectivity with zero missing corner tiles.
  const radius = 4;
  const initialCoords: HexCoord[] = [];

  for (let q = -radius; q <= radius; q++) {
    const r1 = Math.max(-radius, -q - radius);
    const r2 = Math.min(radius, -q + radius);
    for (let r = r1; r <= r2; r++) {
      initialCoords.push({ q, r });
    }
  }

  // Create tile set
  const tileMap = new Map<string, HexTile>();
  for (const c of initialCoords) {
    tileMap.set(coordKey(c), {
      q: c.q,
      r: c.r,
      id: coordKey(c),
      controlledBy: null,
    });
  }

  // Double check connectivity
  ensureConnectivity(tileMap);

  /**
   * Deployment Layout Specifications:
   * - 1st Row (Back rank):
   *   - Center: Level 2 Warden (anchoring the backline)
   *   - Flanked by: Level 3 Sentinels
   *   - Each corner: Level 2 Warden
   * - 2nd Row (Middle rank, in front):
   *   - 4x Level 1 Scouts
   * - 3rd Row (Front rank):
   *   - Middle: Level 4 Sovereign (leading from the vanguard)
   */

  // Player Deployment (Southern base: r = 4, 3, 2)
  const playerUnitPlacements: { rank: UnitRank; coord: HexCoord; id: string }[] = [
    // 1st row (r = 4): 5 tiles from left corner (-4, 4) to right corner (0, 4)
    { rank: 2, coord: { q: -4, r: 4 }, id: 'player-l2-corner-left' },
    { rank: 3, coord: { q: -3, r: 4 }, id: 'player-l3-flank-left' },
    { rank: 2, coord: { q: -2, r: 4 }, id: 'player-l2-bastion-center' }, // Center of 1st row
    { rank: 3, coord: { q: -1, r: 4 }, id: 'player-l3-flank-right' },
    { rank: 2, coord: { q: 0, r: 4 }, id: 'player-l2-corner-right' },

    // 2nd row (r = 3): 4 Level 1 Scouts in front
    { rank: 1, coord: { q: -3, r: 3 }, id: 'player-l1-scout-1' },
    { rank: 1, coord: { q: -2, r: 3 }, id: 'player-l1-scout-2' },
    { rank: 1, coord: { q: -1, r: 3 }, id: 'player-l1-scout-3' },
    { rank: 1, coord: { q: 0, r: 3 }, id: 'player-l1-scout-4' },

    // 3rd row (r = 2): Level 4 Sovereign at the front vanguard
    { rank: 4, coord: { q: -1, r: 2 }, id: 'player-l4-sovereign' },
  ];

  // AI Deployment (Northern base: r = -4, -3, -2, symmetric mirror across center)
  const aiUnitPlacements: { rank: UnitRank; coord: HexCoord; id: string }[] = [
    // 1st row (r = -4): 5 tiles from left corner (0, -4) to right corner (4, -4)
    { rank: 2, coord: { q: 0, r: -4 }, id: 'ai-l2-corner-left' },
    { rank: 3, coord: { q: 1, r: -4 }, id: 'ai-l3-flank-left' },
    { rank: 2, coord: { q: 2, r: -4 }, id: 'ai-l2-bastion-center' }, // Center of 1st row
    { rank: 3, coord: { q: 3, r: -4 }, id: 'ai-l3-flank-right' },
    { rank: 2, coord: { q: 4, r: -4 }, id: 'ai-l2-corner-right' },

    // 2nd row (r = -3): 4 Level 1 Scouts in front
    { rank: 1, coord: { q: 0, r: -3 }, id: 'ai-l1-scout-1' },
    { rank: 1, coord: { q: 1, r: -3 }, id: 'ai-l1-scout-2' },
    { rank: 1, coord: { q: 2, r: -3 }, id: 'ai-l1-scout-3' },
    { rank: 1, coord: { q: 3, r: -3 }, id: 'ai-l1-scout-4' },

    // 3rd row (r = -2): Level 4 Sovereign at the front vanguard
    { rank: 4, coord: { q: 1, r: -2 }, id: 'ai-l4-sovereign' },
  ];

  // Starting territory control
  // Player base rows (all row 4, row 3, and the vanguard tile)
  for (let q = -4; q <= 0; q++) {
    const tile = tileMap.get(coordKey({ q, r: 4 }));
    if (tile) tile.controlledBy = 'player';
  }
  for (let q = -4; q <= 1; q++) {
    const tile = tileMap.get(coordKey({ q, r: 3 }));
    if (tile) tile.controlledBy = 'player';
  }
  const playerVanguardTile = tileMap.get(coordKey({ q: -1, r: 2 }));
  if (playerVanguardTile) playerVanguardTile.controlledBy = 'player';

  // AI base rows (all row -4, row -3, and the vanguard tile)
  for (let q = 0; q <= 4; q++) {
    const tile = tileMap.get(coordKey({ q, r: -4 }));
    if (tile) tile.controlledBy = 'ai';
  }
  for (let q = -1; q <= 4; q++) {
    const tile = tileMap.get(coordKey({ q, r: -3 }));
    if (tile) tile.controlledBy = 'ai';
  }
  const aiVanguardTile = tileMap.get(coordKey({ q: 1, r: -2 }));
  if (aiVanguardTile) aiVanguardTile.controlledBy = 'ai';

  const units: Unit[] = [];

  // Create Player units
  for (const p of playerUnitPlacements) {
    units.push({
      id: p.id,
      team: 'player',
      rank: p.rank,
      coord: { ...p.coord },
      hasMovedThisRound: false,
    });
  }

  // Create AI units
  for (const a of aiUnitPlacements) {
    units.push({
      id: a.id,
      team: 'ai',
      rank: a.rank,
      coord: { ...a.coord },
      hasMovedThisRound: false,
    });
  }

  return {
    tiles: tileMap,
    units,
  };
}

function ensureConnectivity(tileMap: Map<string, HexTile>) {
  if (tileMap.size === 0) return;

  const firstCoord = tileMap.values().next().value!;
  const visited = new Set<string>();
  const queue: HexCoord[] = [{ q: firstCoord.q, r: firstCoord.r }];
  visited.add(coordKey(firstCoord));

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = getHexNeighbors(current);
    for (const n of neighbors) {
      const key = coordKey(n);
      if (tileMap.has(key) && !visited.has(key)) {
        visited.add(key);
        queue.push(n);
      }
    }
  }

  for (const [key] of tileMap) {
    if (!visited.has(key)) {
      tileMap.delete(key);
    }
  }
}
