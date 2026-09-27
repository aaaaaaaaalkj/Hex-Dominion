import { HexCoord } from '../types/game';

// Pointy-topped hex directions
export const HEX_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
] as const;

// Compass names of the edge directions (screen orientation, pointy-top hexes)
export const DIRECTION_NAMES = ['E', 'NE', 'NW', 'W', 'SW', 'SE'] as const;

// Screen angle (degrees, clockwise from east) of edge direction i for pointy-top hexes
export function directionAngle(i: number): number {
  return -60 * i;
}

// 3-coloring of the hex grid (Gambit board): neighbours always differ
export function tileColorIndex(coord: HexCoord): number {
  return (((coord.q - coord.r) % 3) + 3) % 3;
}

export function coordKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

export function parseCoordKey(key: string): HexCoord {
  const [q, r] = key.split(',').map(Number);
  return { q, r };
}

export function areCoordsEqual(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const aq = a.q;
  const ar = a.r;
  const as_ = -a.q - a.r;
  const bq = b.q;
  const br = b.r;
  const bs_ = -b.q - b.r;
  return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(as_ - bs_)) / 2;
}

export function getHexNeighbors(coord: HexCoord): HexCoord[] {
  return HEX_DIRECTIONS.map((dir) => ({
    q: coord.q + dir.q,
    r: coord.r + dir.r,
  }));
}

// Convert axial coordinates to Cartesian (x, y) pixels for pointy-top hexagon
export function hexToPixel(coord: HexCoord, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (coord.q + coord.r / 2);
  const y = size * (3 / 2) * coord.r;
  return { x, y };
}

// Generate SVG path for a pointy-topped hexagon with smoothly rounded corners
export function roundedHexPath(
  centerX: number,
  centerY: number,
  size: number,
  cornerRadius: number = 6
): string {
  // 6 vertices of pointy-topped hexagon
  const vertices: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angleRad = (Math.PI / 180) * (60 * i - 30);
    vertices.push({
      x: centerX + size * Math.cos(angleRad),
      y: centerY + size * Math.sin(angleRad),
    });
  }

  // Edge length in regular hexagon equals size
  const edgeLen = size;
  const r = Math.min(cornerRadius, edgeLen * 0.45);
  const factor = r / edgeLen;

  const pointsIn: { x: number; y: number }[] = [];
  const pointsOut: { x: number; y: number }[] = [];

  for (let i = 0; i < 6; i++) {
    const prev = vertices[(i + 5) % 6];
    const curr = vertices[i];
    const next = vertices[(i + 1) % 6];

    // Point before corner i along the incoming edge
    pointsIn.push({
      x: curr.x + factor * (prev.x - curr.x),
      y: curr.y + factor * (prev.y - curr.y),
    });

    // Point after corner i along the outgoing edge
    pointsOut.push({
      x: curr.x + factor * (next.x - curr.x),
      y: curr.y + factor * (next.y - curr.y),
    });
  }

  // Build smooth path with quadratic beziers at corners
  let d = `M ${pointsOut[0].x.toFixed(2)},${pointsOut[0].y.toFixed(2)}`;

  for (let i = 1; i < 6; i++) {
    d += ` L ${pointsIn[i].x.toFixed(2)},${pointsIn[i].y.toFixed(2)}`;
    d += ` Q ${vertices[i].x.toFixed(2)},${vertices[i].y.toFixed(2)} ${pointsOut[i].x.toFixed(2)},${pointsOut[i].y.toFixed(2)}`;
  }

  // Close back to corner 0
  d += ` L ${pointsIn[0].x.toFixed(2)},${pointsIn[0].y.toFixed(2)}`;
  d += ` Q ${vertices[0].x.toFixed(2)},${vertices[0].y.toFixed(2)} ${pointsOut[0].x.toFixed(2)},${pointsOut[0].y.toFixed(2)} Z`;

  return d;
}
