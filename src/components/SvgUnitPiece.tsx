import React from 'react';
import { GameMode, Unit, UnitRank } from '../types/game';
import { directionAngle } from '../utils/hexMath';

interface SvgUnitPieceProps {
  unit: Unit;
  mode?: GameMode;
  cx: number;
  cy: number;
  isAttackTarget?: boolean;
}

// Symbol scale grows with rank, mirroring the unit's influence
const SYMBOL_SCALE: Record<UnitRank, number> = {
  1: 1.0,
  2: 1.2,
  3: 1.4,
  4: 1.6,
};

const TEAM_FILL = {
  player: '#60a5fa',
  ai: '#fb7185',
};

const OUTLINE = '#050914';
const MOVED_FILL = '#0b1120';

// Five-pointed star, outer radius 10.5
const STAR_PATH = (() => {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? 10.5 : 4.4;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${(radius * Math.cos(angle)).toFixed(2)},${(radius * Math.sin(angle) + 0.8).toFixed(2)}`);
  }
  return `M ${points.join(' L ')} Z`;
})();

/**
 * Rank symbols, drawn in a ~20px box around the origin.
 */
const SYMBOL_PATH: Record<UnitRank, string> = {
  // King: crown with band
  4: 'M -9,4.5 L -10,-6 L -4.5,-1.5 L 0,-9 L 4.5,-1.5 L 10,-6 L 9,4.5 Z M -9,6.5 L 9,6.5 L 9,10 L -9,10 Z',
  // General: star
  3: STAR_PATH,
  // Captain: heater shield
  2: 'M 0,-10 L 8.5,-6.8 L 8.5,0 C 8.5,5.8 4.6,9 0,11 C -4.6,9 -8.5,5.8 -8.5,0 L -8.5,-6.8 Z',
  // Scout: arrowhead (points up; rotated to face the enemy)
  1: 'M 0,-9 L 8,7.5 L 0,3.5 L -8,7.5 Z',
};

// Gambit symbols: King crown, Rook tower, Bishop mitre (with slit), Scout arrowhead
const GAMBIT_SYMBOL_PATH: Record<UnitRank, string> = {
  4: SYMBOL_PATH[4],
  3: 'M -8,-10 L -4.6,-10 L -4.6,-7 L -1.6,-7 L -1.6,-10 L 1.6,-10 L 1.6,-7 L 4.6,-7 L 4.6,-10 L 8,-10 L 8,-3.5 L 5.5,-1.5 L 5.5,6 L 8,8 L 8,10.5 L -8,10.5 L -8,8 L -5.5,6 L -5.5,-1.5 L -8,-3.5 Z',
  2: 'M 0,-11 C 5,-7 7.5,-2.5 7.5,2 C 7.5,5 5.5,7 3.5,8 L 7,8 L 7,11 L -7,11 L -7,8 L -3.5,8 C -5.5,7 -7.5,5 -7.5,2 C -7.5,-2.5 -5,-7 0,-11 Z M 1.4,-6.2 L 3.6,-4.6 L -0.6,1.2 L -2.8,-0.4 Z',
  1: SYMBOL_PATH[1],
};

// Gambit has no ranks: pieces are drawn at similar sizes
const GAMBIT_SYMBOL_SCALE: Record<UnitRank, number> = {
  1: 1.15,
  2: 1.35,
  3: 1.35,
  4: 1.5,
};

export const SvgUnitPiece: React.FC<SvgUnitPieceProps> = ({
  unit,
  mode = 'dominion',
  cx,
  cy,
  isAttackTarget = false,
}) => {
  const isGambit = mode === 'gambit';
  const isMoved = unit.hasMovedThisRound;
  const scale = (isGambit ? GAMBIT_SYMBOL_SCALE : SYMBOL_SCALE)[unit.rank];

  // Scouts point toward the enemy (Dominion) or toward their facing edge (Gambit)
  let rotation = 0;
  if (unit.rank === 1) {
    rotation =
      isGambit && unit.facing !== undefined
        ? 90 + directionAngle(unit.facing)
        : unit.team === 'player'
        ? 0
        : 180;
  }

  const symbol = (isGambit ? GAMBIT_SYMBOL_PATH : SYMBOL_PATH)[unit.rank];
  const transform = `scale(${scale})${rotation ? ` rotate(${rotation})` : ''}`;
  const teamColor = TEAM_FILL[unit.team];

  return (
    <g transform={`translate(${cx}, ${cy})`} className="cursor-pointer">
      {/* Capture target: thin neutral ring */}
      {isAttackTarget && (
        <circle r={11 * scale + 7} fill="none" stroke="rgba(255, 255, 255, 0.45)" strokeWidth="1.5" />
      )}

      {/* Rank symbol: solid team color when ready, hollow team outline once moved.
          Always fully opaque so the team color never mixes with the tile shade. */}
      <g filter="url(#unit-shadow)" transform={transform}>
        {isMoved ? (
          <>
            <path
              d={symbol}
              fill={MOVED_FILL}
              stroke={OUTLINE}
              strokeWidth={4.4 / scale}
              strokeLinejoin="round"
              fillRule="evenodd"
            />
            <path
              d={symbol}
              fill="none"
              stroke={teamColor}
              strokeWidth={1.8 / scale}
              strokeLinejoin="round"
              fillRule="evenodd"
            />
          </>
        ) : (
          <path
            d={symbol}
            fill={teamColor}
            stroke={OUTLINE}
            strokeWidth={2.4 / scale}
            strokeLinejoin="round"
            fillRule="evenodd"
            paintOrder="stroke"
          />
        )}
      </g>
    </g>
  );
};
