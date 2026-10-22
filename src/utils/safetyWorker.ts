import { HexCoord, Team } from '../types/game';
import { coordKey } from './hexMath';
import { GameState } from './gameState';
import { analyzeTile } from './tileSafety';
import { applyMove, fromGameState, legalMoves, moveFrom, moveTo, PASS, VectorState } from './vectorEngine';

// Analyses the destinations of the selected unit (tileSafety.ts) for the move
// preview, one per message so the board fills in while the rest are computed.

export interface SafetyStep {
  from: HexCoord;
  to: HexCoord;
  team: Team;
  capture: boolean;
}

export interface TileVerdict {
  status: 'lost' | 'threatened' | 'safe';
  attackerMove?: number;
  ownerMove?: number;
  horizon: number;
  line: SafetyStep[];
  defences: SafetyStep[];
  immediate: SafetyStep[];
}

export interface SafetyRequest {
  requestId: number;
  state: GameState;
  from: HexCoord;
  targets: HexCoord[];
}

export interface SafetyResponse {
  requestId: number;
  target: string; // coordKey of the destination
  verdict: TileVerdict | null;
}

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<SafetyRequest>) => void) | null;
  postMessage: (message: SafetyResponse) => void;
};

const step = (s: VectorState, m: number): SafetyStep => ({
  from: moveFrom(m),
  to: moveTo(m),
  team: s.side === 1 ? 'player' : 'ai',
  capture: s.u[m & 127] !== 0,
});

function verdictFor(s: VectorState, from: HexCoord, to: HexCoord): TileVerdict | null {
  const move = legalMoves(s).find((m) => {
    const a = moveFrom(m), b = moveTo(m);
    return m !== PASS && a.q === from.q && a.r === from.r && b.q === to.q && b.r === to.r;
  });
  if (move === undefined) return null;
  const next = applyMove(s, move);
  if (next.winner) return null;
  const r = analyzeTile(next, move & 127);
  if (!r) return null;
  // The line as steps; the defences are played where the owner makes its critical move
  const owner = Math.sign(next.u[move & 127]);
  const line: SafetyStep[] = [];
  let at = next, own = 0, defenceAt = next;
  for (const m of r.line) {
    if (at.side === owner && ++own === r.ownerMove) defenceAt = at;
    if (m !== PASS) line.push(step(at, m));
    at = applyMove(at, m);
  }
  return {
    status: r.status,
    attackerMove: r.attackerMove,
    ownerMove: r.ownerMove,
    horizon: r.horizon,
    line,
    defences: r.defences.map((m) => step(defenceAt, m)),
    immediate: r.immediate.map((m) => step(next, m)),
  };
}

let latest = 0;
scope.onmessage = (e) => {
  const { requestId, state, from, targets } = e.data;
  latest = requestId;
  const s = fromGameState(state);
  // One destination per task, so a newer request (another unit selected) takes over
  const queue = [...targets];
  const next = () => {
    if (requestId !== latest) return;
    const to = queue.shift();
    if (!to) return;
    scope.postMessage({ requestId, target: coordKey(to), verdict: verdictFor(s, from, to) });
    setTimeout(next, 0);
  };
  next();
};
