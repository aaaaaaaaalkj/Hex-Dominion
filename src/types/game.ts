export type Team = 'player' | 'ai';

export type UnitRank = 1 | 2 | 3 | 4;

export interface UnitDefinition {
  rank: UnitRank;
  auraRank: number;
  speed: number;
  name: string;
  title: string;
  description: string;
  count: number;
}

export const UNIT_DEFINITIONS: Record<UnitRank, UnitDefinition> = {
  4: {
    rank: 4,
    auraRank: 4,
    speed: 1,
    name: 'King',
    title: 'Head of the Army',
    description: 'Leader of the army. Eliminating the enemy King wins the game. Moves 1 tile. Projects a Level 4 aura providing +4 combat support to adjacent allies.',
    count: 1,
  },
  3: {
    rank: 3,
    auraRank: 3,
    speed: 2,
    name: 'General',
    title: 'Field Commander',
    description: 'Senior commander. Moves 2 tiles. Projects a Level 3 aura providing +3 combat support to adjacent allies.',
    count: 2,
  },
  2: {
    rank: 2,
    auraRank: 2,
    speed: 3,
    name: 'Captain',
    title: 'Line Officer',
    description: 'Frontline officer. Moves 3 tiles. Projects a Level 2 aura providing +2 combat support to adjacent allies.',
    count: 3,
  },
  1: {
    rank: 1,
    auraRank: 1,
    speed: 4,
    name: 'Scout',
    title: 'Swift Vanguard',
    description: 'Rapid vanguard. Moves 4 tiles. Projects a Level 1 aura providing +1 combat support to adjacent allies.',
    count: 4,
  },
};

export interface HexCoord {
  q: number;
  r: number;
}

export interface HexTile extends HexCoord {
  id: string; // e.g., "q,r"
}

export interface Unit {
  id: string;
  team: Team;
  rank: UnitRank;
  coord: HexCoord;
  hasMovedThisRound: boolean;
  isDefeated?: boolean;
}

export interface LegalMove {
  target: HexCoord;
  path: HexCoord[]; // Sequence of hexes from start to target (length 1 to 4)
  isAttack: boolean;
  targetUnitId?: string;
  targetUnitRank?: UnitRank;
  attackRank?: number;
  defenseRank?: number;
}

export interface MoveRecord {
  id: string;
  turnNumber: number;
  roundNumber: number;
  team: Team;
  unitRank: UnitRank;
  unitName: string;
  from: HexCoord;
  to: HexCoord;
  path: HexCoord[];
  isAttack: boolean;
  capturedRank?: UnitRank;
  capturedName?: string;
  attackRank?: number;
  defenseRank?: number;
  isWinningMove?: boolean;
  timestamp: number;
}
