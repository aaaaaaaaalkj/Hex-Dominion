import React, { useMemo, useState, useRef, useCallback } from 'react';
import {
  HexTile,
  Unit,
  LegalMove,
  Team,
  MoveRecord,
  HexCoord,
} from '../types/game';
import {
  hexToPixel,
  roundedHexPath,
  coordKey,
  areCoordsEqual,
} from '../utils/hexMath';
import {
  computeInfluenceMap,
  applyMove,
} from '../utils/gameRules';
import { SvgUnitPiece } from './SvgUnitPiece';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

// Net influence at which a tile reaches its deepest shade
const FULL_INFLUENCE = 16;

const TEAM_RGB: Record<Team, string> = {
  player: '37, 99, 235',
  ai: '225, 29, 72',
};

interface HexBoardProps {
  tiles: Map<string, HexTile>;
  units: Unit[];
  selectedUnit: Unit | null;
  legalMoves: LegalMove[];
  currentTurn: Team;
  isAiThinking: boolean;
  lastMove?: MoveRecord | null;
  showLastMove?: boolean;
  isGameOver?: boolean;
  isFinalMove?: boolean; // whether lastMove is the game's final move
  onSelectUnit: (unit: Unit) => void;
  onExecuteMove: (move: LegalMove) => void;
}

export const HexBoard: React.FC<HexBoardProps> = ({
  tiles,
  units,
  selectedUnit,
  legalMoves,
  currentTurn,
  isAiThinking,
  lastMove,
  showLastMove = true,
  isGameOver = false,
  isFinalMove = true,
  onSelectUnit,
  onExecuteMove,
}) => {
  const hexRadius = 45; // Hex radius in pixels
  const [hoveredMove, setHoveredMove] = useState<LegalMove | null>(null);

  // Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasMovedDragRef = useRef<boolean>(false);

  // Zoom controls: Zoom evenly from the center
  const handleZoomIn = () => setZoom((z) => Math.min(2.5, +(z + 0.2).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)));
  const handleResetZoom = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.12 : -0.12;
    setZoom((z) => {
      const next = +(z + zoomDelta).toFixed(2);
      return Math.min(2.5, Math.max(0.6, next));
    });
  };

  // Pan dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    hasMovedDragRef.current = false;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasMovedDragRef.current = true;
      }
      setPan({
        x: panStartRef.current.x + dx,
        y: panStartRef.current.y + dy,
      });
    },
    [isDragging]
  );

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Unit lookup maps
  const unitByCoord = useMemo(() => {
    const map = new Map<string, Unit>();
    for (const u of units) {
      if (!u.isDefeated) {
        map.set(coordKey(u.coord), u);
      }
    }
    return map;
  }, [units]);

  // Net influence per tile (positive = player/blue, negative = AI/red).
  // While a unit is selected its influence is lifted off the board; hovering a
  // target previews the board as if the move (including any capture) was made.
  const influenceMap = useMemo(() => {
    if (!selectedUnit) return computeInfluenceMap(tiles, units);
    if (hoveredMove) {
      return computeInfluenceMap(tiles, applyMove(selectedUnit.id, hoveredMove, units).newUnits);
    }
    return computeInfluenceMap(
      tiles,
      units.filter((u) => u.id !== selectedUnit.id)
    );
  }, [tiles, units, selectedUnit, hoveredMove]);

  // Legal moves lookup map
  const moveByTarget = useMemo(() => {
    const map = new Map<string, LegalMove>();
    for (const m of legalMoves) {
      map.set(coordKey(m.target), m);
    }
    return map;
  }, [legalMoves]);

  // Compute SVG viewBox and exact center for symmetrical zooming
  const { viewBox, centerX, centerY } = useMemo(() => {
    const tileArray = Array.from(tiles.values());
    if (tileArray.length === 0) {
      return { viewBox: '0 0 800 600', centerX: 400, centerY: 300 };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const t of tileArray) {
      const { x, y } = hexToPixel(t, hexRadius);
      if (x - hexRadius < minX) minX = x - hexRadius;
      if (x + hexRadius > maxX) maxX = x + hexRadius;
      if (y - hexRadius < minY) minY = y - hexRadius;
      if (y + hexRadius > maxY) maxY = y + hexRadius;
    }

    const pad = 65;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const vx = minX - pad;
    const vy = minY - pad;

    return {
      viewBox: `${vx} ${vy} ${w} ${h}`,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }, [tiles, hexRadius]);

  // Tile / Unit click handler
  const handleTileClick = (tile: HexTile) => {
    if (hasMovedDragRef.current || isAiThinking || currentTurn !== 'player') return;

    const key = coordKey(tile);
    const occupant = unitByCoord.get(key);
    const legalMove = moveByTarget.get(key);

    // If clicking a valid destination
    if (legalMove) {
      onExecuteMove(legalMove);
      setHoveredMove(null);
      return;
    }

    // If clicking own active unit
    if (occupant && occupant.team === 'player') {
      onSelectUnit(occupant);
      setHoveredMove(null);
    }
  };

  return (
    <div
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      className={`relative w-full h-full select-none overflow-hidden bg-slate-950 flex items-center justify-center ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* Floating unobtrusive zoom controls (bottom-right) */}
      <div className="absolute bottom-5 right-5 z-20 flex items-center gap-1 p-1 rounded-xl bg-slate-900/80 border border-slate-800 backdrop-blur-md shadow-2xl text-slate-400">
        <button
          onClick={handleZoomIn}
          title="Zoom In"
          className="p-1.5 rounded-lg hover:bg-slate-800 hover:text-white transition-colors"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] font-mono font-semibold px-1 text-slate-300 tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={handleZoomOut}
          title="Zoom Out"
          className="p-1.5 rounded-lg hover:bg-slate-800 hover:text-white transition-colors"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-3.5 bg-slate-800 mx-0.5" />
        <button
          onClick={handleResetZoom}
          title="Reset View"
          className="p-1.5 rounded-lg hover:bg-slate-800 hover:text-white transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* SVG Board */}
      <svg
        viewBox={viewBox}
        className="w-full h-full max-h-screen"
        style={{
          filter: 'drop-shadow(0 20px 40px rgba(0,0,0,0.6))',
        }}
      >
        <defs>
          {/* Tile Gradients */}
          <linearGradient id="grad-hex-neutral" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e293b" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#0b0f19" stopOpacity="0.85" />
          </linearGradient>

          <filter id="unit-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000000" floodOpacity="0.7" />
          </filter>
        </defs>

        {/* Pan and Zoom Layer: Scaled symmetrically around exact board center */}
        <g
          transform={`translate(${centerX + pan.x}, ${centerY + pan.y}) scale(${zoom}) translate(${-centerX}, ${-centerY})`}
          style={{
            transition: isDragging ? 'none' : 'transform 0.08s ease-out',
          }}
        >
          {/* 1. HEX TILES LAYER (Smooth rounded-edge hexagons) */}
          <g id="tiles-layer">
            {Array.from(tiles.values()).map((tile) => {
              const { x, y } = hexToPixel(tile, hexRadius);
              const key = coordKey(tile);
              const isTarget = moveByTarget.has(key);
              const moveInfo = moveByTarget.get(key);
              const isAttack = moveInfo?.isAttack;
              const isSelectedTile = selectedUnit && coordKey(selectedUnit.coord) === key;
              const isHoveredTarget = hoveredMove !== null && coordKey(hoveredMove.target) === key;

              // Influence shading: deeper shade = stronger net influence
              const influence = influenceMap.get(key) ?? 0;
              const influenceTeam: Team | null =
                influence > 0 ? 'player' : influence < 0 ? 'ai' : null;
              const strength = Math.min(Math.abs(influence), FULL_INFLUENCE) / FULL_INFLUENCE;

              let fill = 'url(#grad-hex-neutral)';
              let stroke = '#1e293b';
              let strokeWidth = 1.4;
              let influenceFill: string | null = null;
              let seamStroke = 'rgba(255, 255, 255, 0.04)';

              if (influenceTeam) {
                const rgb = TEAM_RGB[influenceTeam];
                influenceFill = `rgba(${rgb}, ${(0.12 + 0.7 * strength).toFixed(3)})`;
                stroke = `rgba(${rgb}, ${(0.3 + 0.6 * strength).toFixed(3)})`;
                strokeWidth = 1.4 + 0.6 * strength;
                seamStroke = `rgba(${rgb}, ${(0.1 + 0.25 * strength).toFixed(3)})`;
              }

              if (isSelectedTile) {
                stroke = '#f59e0b';
                strokeWidth = 2.8;
              }

              if (isHoveredTarget) {
                stroke = 'rgba(255, 255, 255, 0.55)';
                strokeWidth = 1.8;
              }

              return (
                <g
                  key={key}
                  onClick={() => handleTileClick(tile)}
                  onMouseEnter={() => moveInfo && setHoveredMove(moveInfo)}
                  onMouseLeave={() => setHoveredMove(null)}
                  className="cursor-pointer"
                  data-target={isTarget ? (isAttack ? 'attack' : 'move') : undefined}
                >
                  {/* Outer rounded hex outline */}
                  <path
                    d={roundedHexPath(x, y, hexRadius - 1.5, 6)}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeWidth}
                    className="transition-colors duration-150"
                  />

                  {/* Influence shade overlay */}
                  {influenceFill && (
                    <path
                      d={roundedHexPath(x, y, hexRadius - 1.5, 6)}
                      fill={influenceFill}
                      pointerEvents="none"
                      style={{ transition: 'fill 120ms ease-out' }}
                    />
                  )}

                  {/* Inner beveled seam */}
                  <path
                    d={roundedHexPath(x, y, hexRadius - 5, 4)}
                    fill="none"
                    stroke={seamStroke}
                    strokeWidth="1"
                    pointerEvents="none"
                  />

                  {/* Move target: small neutral dot (captures are marked by a ring on the unit) */}
                  {isTarget && !isAttack && (
                    <circle
                      cx={x}
                      cy={y}
                      r={isHoveredTarget ? 5 : 4}
                      fill={`rgba(255, 255, 255, ${isHoveredTarget ? 0.5 : 0.22})`}
                      pointerEvents="none"
                    />
                  )}
                </g>
              );
            })}
          </g>

          {/* 2. MOVE PATH PREVIEW */}
          {hoveredMove && selectedUnit && (
            <g id="path-preview-layer" pointerEvents="none">
              <polyline
                points={[
                  hexToPixel(selectedUnit.coord, hexRadius),
                  ...hoveredMove.path.map((c) => hexToPixel(c, hexRadius)),
                ]
                  .map((p) => `${p.x},${p.y}`)
                  .join(' ')}
                fill="none"
                stroke="rgba(255, 255, 255, 0.45)"
                strokeWidth="1.5"
                strokeDasharray="3 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Combat Floating Capsule Badge */}
              {hoveredMove.isAttack && (

                  <g
                    transform={`translate(${hexToPixel(hoveredMove.target, hexRadius).x}, ${hexToPixel(hoveredMove.target, hexRadius).y - 34})`}
                  >
                    <rect
                      x="-55"
                      y="-11"
                      width="110"
                      height="22"
                      rx="11"
                      fill="#090d16"
                      stroke="#ef4444"
                      strokeWidth="1.6"
                      filter="drop-shadow(0 4px 6px rgba(0,0,0,0.8))"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fill="#ffffff"
                      fontSize="9"
                      fontWeight="900"
                      fontFamily="monospace"
                      letterSpacing="0.4"
                    >
                      ATK {hoveredMove.attackRank} vs DEF {hoveredMove.defenseRank}
                    </text>
                  </g>
                )}
            </g>
          )}

          {/* 3. LAST MOVE HIGHLIGHT LAYER (subtle path; badge only once the game is over) */}
          {lastMove && showLastMove && !hoveredMove && (
            <g id="last-move-layer" pointerEvents="none">
              {(() => {
                const fromPix = hexToPixel(lastMove.from, hexRadius);
                const toPix = hexToPixel(lastMove.to, hexRadius);
                const moveColor = lastMove.isAttack
                  ? '#ef4444'
                  : lastMove.team === 'player'
                  ? '#38bdf8'
                  : '#f43f5e';

                const fullPath = [
                  lastMove.from,
                  ...(lastMove.path || []),
                  lastMove.to,
                ];
                const uniqueCoords: HexCoord[] = [];
                for (const c of fullPath) {
                  if (
                    uniqueCoords.length === 0 ||
                    !areCoordsEqual(uniqueCoords[uniqueCoords.length - 1], c)
                  ) {
                    uniqueCoords.push(c);
                  }
                }

                return (
                  <g opacity={isGameOver ? 0.9 : 0.5}>
                    {/* Origin Marker */}
                    <circle cx={fromPix.x} cy={fromPix.y} r="4" fill={moveColor} />

                    {/* Path Polyline */}
                    {uniqueCoords.length > 1 && (
                      <polyline
                        points={uniqueCoords
                          .map((c) => {
                            const p = hexToPixel(c, hexRadius);
                            return `${p.x},${p.y}`;
                          })
                          .join(' ')}
                        fill="none"
                        stroke={moveColor}
                        strokeWidth="1.5"
                        strokeDasharray="4 4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    )}

                    {/* Destination Marker */}
                    <circle
                      cx={toPix.x}
                      cy={toPix.y}
                      r={hexRadius - 10}
                      fill="none"
                      stroke={moveColor}
                      strokeWidth="1.5"
                    />

                    {/* Final move badge once the game is decided */}
                    {isGameOver && isFinalMove && (
                      <g transform={`translate(${toPix.x}, ${toPix.y - 36})`}>
                        <rect
                          x="-62"
                          y="-12"
                          width="124"
                          height="24"
                          rx="12"
                          fill="#090d16"
                          stroke={moveColor}
                          strokeWidth="1.8"
                          filter="drop-shadow(0 6px 12px rgba(0,0,0,0.85))"
                        />
                        <text
                          x="0"
                          y="3.5"
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="9"
                          fontWeight="900"
                          fontFamily="monospace"
                          letterSpacing="0.4"
                        >
                          {lastMove.isAttack ? '⚔️ FINAL STRIKE' : '🏁 FINAL MOVE'}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })()}
            </g>
          )}

          {/* 4. UNITS LAYER (Pure Vector SVG) */}
          <g id="units-layer">
            {units
              .filter((u) => !u.isDefeated)
              .map((unit) => {
                const { x, y } = hexToPixel(unit.coord, hexRadius);
                const moveInfo = moveByTarget.get(coordKey(unit.coord));
                const isAttackTarget = Boolean(moveInfo?.isAttack);

                return (
                  <g
                    key={unit.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      const tile = tiles.get(coordKey(unit.coord));
                      if (tile) handleTileClick(tile);
                    }}
                    onMouseEnter={() => moveInfo && setHoveredMove(moveInfo)}
                    onMouseLeave={() => moveInfo && setHoveredMove(null)}
                  >
                    <SvgUnitPiece
                      unit={unit}
                      cx={x}
                      cy={y}
                      isAttackTarget={isAttackTarget}
                    />
                  </g>
                );
              })}
          </g>

        </g>
      </svg>
    </div>
  );
};
