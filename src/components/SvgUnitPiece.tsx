import React from 'react';
import { Unit, UnitRank } from '../types/game';

interface SvgUnitPieceProps {
  unit: Unit;
  cx: number;
  cy: number;
  isSelected?: boolean;
  isAttackTarget?: boolean;
}

// Token radius grows with rank, mirroring the unit's influence
const TOKEN_RADIUS: Record<UnitRank, number> = {
  1: 11,
  2: 13.5,
  3: 16,
  4: 18.5,
};

const TEAM_STYLE = {
  player: { rim: '#60a5fa', glyph: '#dbeafe', body: 'url(#grad-unit-player)' },
  ai: { rim: '#fb7185', glyph: '#ffe4e6', body: 'url(#grad-unit-ai)' },
};

const GOLD = '#fbbf24';

/**
 * Rank glyphs drawn in a ~20px box around the origin, scaled to the token.
 */
function RankGlyph({ rank, color, facingUp }: { rank: UnitRank; color: string; facingUp: boolean }) {
  switch (rank) {
    case 4: // Sovereign: crown
      return (
        <g fill={color}>
          <path d="M -8,3 L -9,-6 L -4,-2 L 0,-8 L 4,-2 L 9,-6 L 8,3 Z" strokeLinejoin="round" />
          <rect x="-8" y="4.5" width="16" height="3" rx="1" />
        </g>
      );
    case 3: // Sentinel: shield
      return (
        <path
          d="M 0,-8.5 L 7.5,-5.5 L 7.5,0 C 7.5,5 4,7.8 0,9.5 C -4,7.8 -7.5,5 -7.5,0 L -7.5,-5.5 Z"
          fill={color}
        />
      );
    case 2: // Warden: crossed swords
      return (
        <g stroke={color} strokeWidth="2" strokeLinecap="round">
          <line x1="-6.5" y1="-6.5" x2="5" y2="5" />
          <line x1="6.5" y1="-6.5" x2="-5" y2="5" />
          <line x1="1.5" y1="6.5" x2="6.5" y2="1.5" strokeWidth="1.6" />
          <line x1="-1.5" y1="6.5" x2="-6.5" y2="1.5" strokeWidth="1.6" />
        </g>
      );
    case 1: // Scout: arrowhead pointing toward the enemy
      return (
        <path
          d="M 0,-8 L 7,6 L 0,2.5 L -7,6 Z"
          fill={color}
          strokeLinejoin="round"
          transform={facingUp ? undefined : 'rotate(180)'}
        />
      );
  }
}

export const SvgUnitPiece: React.FC<SvgUnitPieceProps> = ({
  unit,
  cx,
  cy,
  isSelected = false,
  isAttackTarget = false,
}) => {
  const isPlayer = unit.team === 'player';
  const isMoved = unit.hasMovedThisRound;
  const style = TEAM_STYLE[unit.team];
  const r = TOKEN_RADIUS[unit.rank];
  const glyphScale = r / 15;
  const isSovereign = unit.rank === 4;

  return (
    <g
      transform={`translate(${cx}, ${cy})`}
      className="cursor-pointer"
      style={{ opacity: isMoved ? 0.45 : 1 }}
    >
      {/* Selected: rotating amber ring */}
      {isSelected && (
        <circle
          r={r + 6}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2"
          strokeDasharray="5 3"
          className="animate-spin"
          style={{ animationDuration: '6s' }}
        />
      )}

      {/* Attack target: pulsing red ring with crosshair ticks */}
      {isAttackTarget && (
        <g className="animate-pulse" stroke="#ef4444" strokeWidth="2" strokeLinecap="round">
          <circle r={r + 6} fill="rgba(239, 68, 68, 0.18)" />
          <line x1={-(r + 11)} y1="0" x2={-(r + 3)} y2="0" />
          <line x1={r + 3} y1="0" x2={r + 11} y2="0" />
          <line x1="0" y1={-(r + 11)} x2="0" y2={-(r + 3)} />
          <line x1="0" y1={r + 3} x2="0" y2={r + 11} />
        </g>
      )}

      {/* Token body */}
      <g filter={isMoved ? 'url(#desaturate)' : 'url(#unit-shadow)'}>
        <circle r={r} fill={style.body} stroke={style.rim} strokeWidth="2" />
        {isSovereign && <circle r={r - 3.5} fill="none" stroke={GOLD} strokeWidth="1.4" />}
        <g transform={`scale(${glyphScale})`}>
          <RankGlyph rank={unit.rank} color={isSovereign ? GOLD : style.glyph} facingUp={isPlayer} />
        </g>
      </g>

      {/* Moved this round: small check badge */}
      {isMoved && (
        <g transform={`translate(${r * 0.75}, ${-r * 0.75})`}>
          <circle r="4.5" fill="#0f172a" stroke="#64748b" strokeWidth="1" />
          <path
            d="M -2.2,0 L -0.8,1.8 L 2.2,-1.8"
            fill="none"
            stroke="#94a3b8"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      )}
    </g>
  );
};
