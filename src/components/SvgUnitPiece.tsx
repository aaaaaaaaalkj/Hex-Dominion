import React from 'react';
import { Unit, UnitRank } from '../types/game';

interface SvgUnitPieceProps {
  unit: Unit;
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

export const SvgUnitPiece: React.FC<SvgUnitPieceProps> = ({
  unit,
  cx,
  cy,
  isAttackTarget = false,
}) => {
  const isMoved = unit.hasMovedThisRound;
  const scale = SYMBOL_SCALE[unit.rank];
  const facingUp = unit.team === 'player';

  return (
    <g
      transform={`translate(${cx}, ${cy})`}
      className="cursor-pointer"
      style={{ opacity: isMoved ? 0.4 : 1 }}
    >
      {/* Capture target: thin neutral ring */}
      {isAttackTarget && (
        <circle r={11 * scale + 7} fill="none" stroke="rgba(255, 255, 255, 0.45)" strokeWidth="1.5" />
      )}

      {/* Rank symbol in team color with a dark outline */}
      <g filter={isMoved ? 'url(#desaturate)' : 'url(#unit-shadow)'}>
        <path
          d={SYMBOL_PATH[unit.rank]}
          transform={`scale(${scale})${unit.rank === 1 && !facingUp ? ' rotate(180)' : ''}`}
          fill={TEAM_FILL[unit.team]}
          stroke={OUTLINE}
          strokeWidth={2.4 / scale}
          strokeLinejoin="round"
          paintOrder="stroke"
        />
      </g>
    </g>
  );
};
