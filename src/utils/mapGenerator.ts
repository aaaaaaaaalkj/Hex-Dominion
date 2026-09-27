import { GameMode, HexCoord, HexTile, Unit, UnitRank } from '../types/game';
import { coordKey, getHexNeighbors } from './hexMath';

export interface GeneratedMap {
  tiles: Map<string, HexTile>;
  units: Unit[];
}

export function generateGameMap(mode: GameMode = 'dominion'): GeneratedMap {
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
    });
  }

  // Double check connectivity
  ensureConnectivity(tileMap);

  /**
   * Deployment Layout Specifications:
   * - 1st Row (Back rank):
   *   - Center: Level 2 Captain (anchoring the backline)
   *   - Flanked by: Level 3 Generals
   *   - Each corner: Level 2 Captain
   * - 2nd Row (Middle rank, in front):
   *   - 4x Level 1 Scouts
   * - 3rd Row (Front rank):
   *   - Middle: Level 4 King (leading from the vanguard)
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

    // 3rd row (r = 2): Level 4 King at the front vanguard
    { rank: 4, coord: { q: -1, r: 2 }, id: 'player-l4-king' },
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

    // 3rd row (r = -2): Level 4 King at the front vanguard
    { rank: 4, coord: { q: 1, r: -2 }, id: 'ai-l4-king' },
  ];

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
    units: mode === 'gambit' ? gambitSetup() : units,
  };
}

/**
 * Gambit setup, modeled on chess:
 * - back row: Rook, Bishop, King, Bishop, Rook
 * - second row: 6 Scouts, the left three facing NE and the right three NW
 * The AI army is the point reflection of the player's (facing rotated by 180°).
 */
function gambitSetup(): Unit[] {
  const backRow: [number, UnitRank, string][] = [
    [-4, 3, 'rook-left'],
    [-3, 2, 'bishop-left'],
    [-2, 4, 'king'],
    [-1, 2, 'bishop-right'],
    [0, 3, 'rook-right'],
  ];
  const pieces: { q: number; r: number; rank: UnitRank; name: string; facing?: number }[] = [
    ...backRow.map(([q, rank, name]) => ({ q, r: 4, rank, name })),
    // Scouts on row 3 (q = -4..1); facing indices into HEX_DIRECTIONS: 1 = NE, 2 = NW
    ...[-4, -3, -2, -1, 0, 1].map((q, i) => ({
      q,
      r: 3,
      rank: 1 as UnitRank,
      name: `scout-${i + 1}`,
      facing: i < 3 ? 1 : 2,
    })),
  ];

  const units: Unit[] = [];
  for (const p of pieces) {
    units.push({
      id: `player-${p.name}`,
      team: 'player',
      rank: p.rank,
      coord: { q: p.q, r: p.r },
      hasMovedThisRound: false,
      facing: p.facing,
    });
    units.push({
      id: `ai-${p.name}`,
      team: 'ai',
      rank: p.rank,
      coord: { q: -p.q, r: -p.r },
      hasMovedThisRound: false,
      facing: p.facing === undefined ? undefined : (p.facing + 3) % 6,
    });
  }
  return units;
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
