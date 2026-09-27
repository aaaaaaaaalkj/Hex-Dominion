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
    auraRank: 3,
    speed: 1,
    name: 'Sovereign',
    title: 'Supreme Commander',
    description: 'Supreme leader. Eliminating the enemy Sovereign wins the game. Moves 1 tile. Projects a Level 3 aura providing +3 support to adjacent allies.',
    count: 1,
  },
  3: {
    rank: 3,
    auraRank: 2,
    speed: 2,
    name: 'Sentinel',
    title: 'Elite Guardian',
    description: 'Heavy armor bastion. Moves 2 tiles. Projects a Level 2 aura, shielding adjacent territory and providing +2 combat support.',
    count: 2,
  },
  2: {
    rank: 2,
    auraRank: 1,
    speed: 3,
    name: 'Warden',
    title: 'Frontline Striker',
    description: 'Tactical skirmisher. Moves 3 tiles. Projects a Level 1 aura, denying territory to enemy scouts and providing +1 combat support.',
    count: 3,
  },
  1: {
    rank: 1,
    auraRank: 0,
    speed: 4,
    name: 'Scout',
    title: 'Territory Pioneer',
    description: 'Rapid vanguard. Moves 4 tiles. Has no aura (aura = 0); cannot protect territory from enemy scouts and provides no aura support in combat.',
    count: 4,
  },
};

export interface HexCoord {
  q: number;
  r: number;
}

export interface HexTile extends HexCoord {
  id: string; // e.g., "q,r"
  controlledBy: Team | null; // null = neutral
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
  flipsControl: boolean;
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
  territoryClaimed?: boolean;
  isWinningMove?: boolean;
  timestamp: number;
}

export type AIDifficulty = 'apprentice' | 'tactician' | 'grandmaster';

export interface GameSettings {
  difficulty: AIDifficulty;
  soundEnabled: boolean;
  showAuras: boolean;
  showCoordinates: boolean;
}
