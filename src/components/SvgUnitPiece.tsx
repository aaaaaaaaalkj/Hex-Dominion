import React from 'react';
import { Unit, UnitRank } from '../types/game';

interface SvgUnitPieceProps {
  unit: Unit;
  cx: number;
  cy: number;
  isSelected?: boolean;
  isAttackTarget?: boolean;
  defensiveRank?: number;
}

export const SvgUnitPiece: React.FC<SvgUnitPieceProps> = ({
  unit,
  cx,
  cy,
  isSelected = false,
  isAttackTarget = false,
  defensiveRank,
}) => {
  const isPlayer = unit.team === 'player';
  const isMoved = unit.hasMovedThisRound;
  const hasDefensiveBackup = defensiveRank !== undefined && defensiveRank > unit.rank;

  // Base colors
  const primaryStroke = isMoved
    ? '#64748b'
    : isPlayer
    ? '#38bdf8' // Electric cyan for player
    : '#f87171'; // Crimson for AI

  const accentColor = isMoved
    ? '#94a3b8'
    : isPlayer
    ? '#67e8f9'
    : '#fca5a5';

  const goldAccent = '#f59e0b';
  const emeraldAccent = '#10b981';
  const skyAccent = '#38bdf8';
  const slateAccent = '#e2e8f0';

  // Render rank-specific visual design
  const renderRankGraphics = () => {
    switch (unit.rank) {
      case 4: // SOVEREIGN (Imperial 8-Pointed Crest & Crown)
        return (
          <g>
            {/* 8-pointed star radiance */}
            {!isMoved && (
              <polygon
                points="0,-24 5,-17 17,-17 12,-7 19,0 12,7 17,17 5,17 0,24 -5,17 -17,17 -12,7 -19,0 -12,-7 -17,-17 -5,-17"
                fill="none"
                stroke={goldAccent}
                strokeWidth="1.2"
                opacity="0.6"
              />
            )}

            {/* Octagonal shield body */}
            <polygon
              points="0,-21 15,-15 21,0 15,15 0,21 -15,15 -21,0 -15,-15"
              fill={isPlayer ? 'url(#grad-unit-player)' : 'url(#grad-unit-ai)'}
              stroke={goldAccent}
              strokeWidth={isSelected ? '2.5' : '1.8'}
              filter={isMoved ? 'url(#desaturate)' : undefined}
            />

            {/* Inner gold fillet */}
            <circle
              cx="0"
              cy="0"
              r="17"
              fill="none"
              stroke={goldAccent}
              strokeWidth="0.8"
              strokeDasharray="2 1.5"
              opacity="0.8"
            />

            {/* Crown Icon */}
            <path
              d="M -7,-1 L -9,-8 L -4,-5 L 0,-10 L 4,-5 L 9,-8 L 7,-1 Z"
              fill={goldAccent}
              stroke="#b45309"
              strokeWidth="0.5"
            />
            <rect x="-7" y="0" width="14" height="2" rx="1" fill={goldAccent} />

            {/* Roman numeral IV */}
            <text
              x="0"
              y="11"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="9"
              fontWeight="900"
              fontFamily="sans-serif"
              letterSpacing="0.5"
            >
              IV
            </text>

            {/* 4 small star pips */}
            <g transform="translate(0, 15)">
              <circle cx="-6" cy="0" r="1.2" fill={goldAccent} />
              <circle cx="-2" cy="0" r="1.2" fill={goldAccent} />
              <circle cx="2" cy="0" r="1.2" fill={goldAccent} />
              <circle cx="6" cy="0" r="1.2" fill={goldAccent} />
            </g>
          </g>
        );

      case 3: // SENTINEL (Bulwark Bastion Shield)
        return (
          <g>
            {/* Fortress Heater Shield Shape */}
            <path
              d="M 0,-20 L 16,-10 L 16,6 C 16,14 0,21 0,21 C 0,21 -16,14 -16,6 L -16,-10 Z"
              fill={isPlayer ? 'url(#grad-unit-player)' : 'url(#grad-unit-ai)'}
              stroke={emeraldAccent}
              strokeWidth={isSelected ? '2.5' : '1.8'}
              filter={isMoved ? 'url(#desaturate)' : undefined}
            />

            {/* Inner shield contour */}
            <path
              d="M 0,-16 L 12,-8 L 12,5 C 12,11 0,16 0,16 C 0,16 -12,11 -12,5 L -12,-8 Z"
              fill="none"
              stroke={emeraldAccent}
              strokeWidth="0.8"
              opacity="0.6"
            />

            {/* Tower / Bastion Icon */}
            <path
              d="M -6,-5 L -6,-10 L -4,-10 L -4,-8 L -1,-8 L -1,-10 L 1,-10 L 1,-8 L 4,-8 L 4,-10 L 6,-10 L 6,-5 L 5,1 L -5,1 Z"
              fill={emeraldAccent}
            />

            {/* Roman numeral III */}
            <text
              x="0"
              y="10"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="9"
              fontWeight="900"
              fontFamily="sans-serif"
              letterSpacing="0.5"
            >
              III
            </text>

            {/* 3 star pips */}
            <g transform="translate(0, 14)">
              <circle cx="-4" cy="0" r="1.2" fill={emeraldAccent} />
              <circle cx="0" cy="0" r="1.2" fill={emeraldAccent} />
              <circle cx="4" cy="0" r="1.2" fill={emeraldAccent} />
            </g>
          </g>
        );

      case 2: // WARDEN (Angled Diamond Striker with Crossed Blades)
        return (
          <g>
            {/* Diamond shape */}
            <polygon
              points="0,-19 18,0 0,19 -18,0"
              fill={isPlayer ? 'url(#grad-unit-player)' : 'url(#grad-unit-ai)'}
              stroke={skyAccent}
              strokeWidth={isSelected ? '2.5' : '1.8'}
              filter={isMoved ? 'url(#desaturate)' : undefined}
            />

            {/* Inner diamond line */}
            <polygon
              points="0,-14 13,0 0,14 -13,0"
              fill="none"
              stroke={skyAccent}
              strokeWidth="0.8"
              opacity="0.5"
            />

            {/* Crossed Blades icon */}
            <g stroke={skyAccent} strokeWidth="1.5" strokeLinecap="round">
              <line x1="-6" y1="-7" x2="6" y2="1" />
              <line x1="6" y1="-7" x2="-6" y2="1" />
              {/* Guards */}
              <line x1="-3" y1="-2" x2="-5" y2="0" strokeWidth="1" />
              <line x1="3" y1="-2" x2="5" y2="0" strokeWidth="1" />
            </g>

            {/* Roman numeral II */}
            <text
              x="0"
              y="10"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="9"
              fontWeight="900"
              fontFamily="sans-serif"
              letterSpacing="0.5"
            >
              II
            </text>

            {/* 2 star pips */}
            <g transform="translate(0, 13)">
              <circle cx="-2.5" cy="0" r="1.2" fill={skyAccent} />
              <circle cx="2.5" cy="0" r="1.2" fill={skyAccent} />
            </g>
          </g>
        );

      case 1: // SCOUT (Winged Compass Vanguard)
        return (
          <g>
            {/* Round compass disc */}
            <circle
              cx="0"
              cy="0"
              r="16"
              fill={isPlayer ? 'url(#grad-unit-player)' : 'url(#grad-unit-ai)'}
              stroke={slateAccent}
              strokeWidth={isSelected ? '2.2' : '1.6'}
              filter={isMoved ? 'url(#desaturate)' : undefined}
            />

            {/* Compass crosshairs */}
            <line x1="0" y1="-16" x2="0" y2="-12" stroke={slateAccent} strokeWidth="1" />
            <line x1="0" y1="12" x2="0" y2="16" stroke={slateAccent} strokeWidth="1" />
            <line x1="-16" y1="0" x2="-12" y2="0" stroke={slateAccent} strokeWidth="1" />
            <line x1="12" y1="0" x2="16" y2="0" stroke={slateAccent} strokeWidth="1" />

            {/* Vanguard Arrow / Chevron */}
            <path
              d="M 0,-8 L 5,0 L 0,-2 L -5,0 Z"
              fill={slateAccent}
            />

            {/* Roman numeral I */}
            <text
              x="0"
              y="8"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="9"
              fontWeight="900"
              fontFamily="sans-serif"
            >
              I
            </text>

            {/* 1 star pip */}
            <circle cx="0" cy="11.5" r="1.2" fill={slateAccent} />
          </g>
        );
    }
  };

  return (
    <g
      transform={`translate(${cx}, ${cy})`}
      className="cursor-pointer transition-transform duration-150"
      style={{
        opacity: isMoved ? 0.5 : 1.0,
      }}
    >
      {/* Selected Unit Ambient Pulse Ring */}
      {isSelected && (
        <circle
          cx="0"
          cy="0"
          r="26"
          fill="none"
          stroke="#f59e0b"
          strokeWidth="2.5"
          strokeDasharray="4 2"
          className="animate-spin"
          style={{ animationDuration: '6s' }}
        />
      )}

      {/* Attack Target Crosshair Pulse */}
      {isAttackTarget && (
        <g className="animate-pulse">
          <circle
            cx="0"
            cy="0"
            r="26"
            fill="rgba(239, 68, 68, 0.2)"
            stroke="#ef4444"
            strokeWidth="2"
          />
          <line x1="-30" y1="0" x2="30" y2="0" stroke="#ef4444" strokeWidth="1.5" />
          <line x1="0" y1="-30" x2="0" y2="30" stroke="#ef4444" strokeWidth="1.5" />
        </g>
      )}

      {/* Main Unit Shape & Insignia */}
      {renderRankGraphics()}

      {/* Defensive Support Shield Badge (when friendly neighbors boost defensive rank) */}
      {hasDefensiveBackup && (
        <g transform="translate(-13, -13)">
          <circle cx="0" cy="0" r="6.5" fill="#090d16" stroke="#10b981" strokeWidth="1.2" />
          <text
            x="0"
            y="2.5"
            textAnchor="middle"
            fill="#34d399"
            fontSize="7.5"
            fontWeight="900"
            fontFamily="monospace"
          >
            {defensiveRank}
          </text>
        </g>
      )}

      {/* Moved Checkmark Badge */}
      {isMoved && (
        <g transform="translate(13, -13)">
          <circle cx="0" cy="0" r="5" fill="#0f172a" stroke="#64748b" strokeWidth="1" />
          <path
            d="M -2.5,0 L -1,2 L 2.5,-2"
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
