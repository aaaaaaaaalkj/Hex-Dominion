import { GameMode, GAME_MODE_NAMES, getPieceName, HexTile, LegalMove, MoveRecord, Team, Unit } from '../types/game';
import { applyMove, calculateDefensiveRank } from './gameRules';
import { applyGambitMove, isKingInCheck } from './gambitRules';
import { applyAction, GameAction, GameState, getUnitMoves, opponentOf } from './gameState';
import { coordKey, DIRECTION_NAMES } from './hexMath';

/**
 * Remote opponent: an outside agent (e.g. a Claude Code session) plays the red
 * side through the dev server relay (see vite.config.ts). The page posts a text
 * snapshot of the position with numbered legal moves, then polls until the
 * agent answers with the index of its chosen move.
 */

export const REMOTE_ENDPOINT = '/__remote';

const LETTERS: Record<GameMode, Record<number, string>> = {
  dominion: { 4: 'K', 3: 'G', 2: 'C', 1: 'S' },
  gambit: { 4: 'K', 3: 'R', 2: 'B', 1: 'S' },
};

const fmt = (c: { q: number; r: number }) => `(${c.q},${c.r})`;

// Pointy-top hex board as text: Blue (you) in UPPERCASE, Red (opponent) in lowercase
function renderBoard(mode: GameMode, tiles: Map<string, HexTile>, units: Unit[]): string[] {
  const byCoord = new Map<string, Unit>();
  for (const u of units) if (!u.isDefeated) byCoord.set(coordKey(u.coord), u);

  const all = [...tiles.values()];
  const minR = Math.min(...all.map((t) => t.r));
  const maxR = Math.max(...all.map((t) => t.r));
  const minX = Math.min(...all.map((t) => 2 * t.q + t.r));

  const lines: string[] = [];
  for (let r = minR; r <= maxR; r++) {
    const row = all.filter((t) => t.r === r).sort((a, b) => a.q - b.q);
    let line = '';
    for (const t of row) {
      const col = (2 * t.q + t.r - minX) * 2;
      const u = byCoord.get(t.id);
      let cell = '.';
      if (u) {
        const letter = LETTERS[mode][u.rank];
        cell = u.team === 'player' ? letter : letter.toLowerCase();
      }
      line = line.padEnd(col) + cell;
    }
    lines.push(`r=${String(r).padStart(2)}  ${line}`);
  }
  return lines;
}

interface Capture {
  attacker: Unit;
  victim: Unit;
  move: LegalMove;
}

// Captures `team` could make right now (Dominion: only its units that have not moved this round)
function capturesBy(team: Team, mode: GameMode, tiles: Map<string, HexTile>, units: Unit[]): Capture[] {
  const result: Capture[] = [];
  for (const attacker of units) {
    if (attacker.team !== team || attacker.isDefeated) continue;
    for (const move of getUnitMoves(mode, attacker, tiles, units)) {
      const victim = move.isAttack ? units.find((u) => u.id === move.targetUnitId) : undefined;
      if (victim) result.push({ attacker, victim, move });
    }
  }
  return result;
}

// Whether the victim's side could capture back on the same tile after `capture`
function canRecapture(capture: Capture, mode: GameMode, tiles: Map<string, HexTile>, units: Unit[]): boolean {
  const after =
    mode === 'gambit'
      ? applyGambitMove(capture.attacker.id, capture.move, units).newUnits
      : applyMove(capture.attacker.id, capture.move, units).newUnits;
  return capturesBy(capture.victim.team, mode, tiles, after).some(
    (c) => c.victim.id === capture.attacker.id
  );
}

// One line per threatened piece of `victimTeam`: attackers, and whether it is defended
function describeThreats(captures: Capture[], mode: GameMode, tiles: Map<string, HexTile>, units: Unit[]): string[] {
  const byVictim = new Map<string, Capture[]>();
  for (const c of captures) byVictim.set(c.victim.id, [...(byVictim.get(c.victim.id) ?? []), c]);
  return [...byVictim.values()].map((list) => {
    const v = list[0].victim;
    const attackers = list.map((c) => `${getPieceName(mode, c.attacker.rank)}${fmt(c.attacker.coord)}`).join(', ');
    const defended = list.every((c) => canRecapture(c, mode, tiles, units));
    return `${getPieceName(mode, v.rank)}${fmt(v.coord)} by ${attackers}${defended ? ' [defended]' : ' [UNDEFENDED]'}`;
  });
}

// Consequences of one of our moves: result, check, and what the opponent can then capture
// (threats already listed in `standing` are only mentioned when the move resolves them)
function describeOutcome(
  state: GameState,
  tiles: Map<string, HexTile>,
  action: GameAction,
  standing: string[]
): string {
  const me = state.currentTurn;
  const next = applyAction(state, tiles, action);
  if (next.winner === me) return state.mode === 'gambit' ? ' => #CHECKMATE, WINS' : ' => WINS (King captured)';
  if (next.isDraw) return ` => DRAW (${next.endReason})`;

  const notes: string[] = [];
  if (state.mode === 'gambit' && isKingInCheck(opponentOf(me), tiles, next.units)) notes.push('+check');
  // Dominion: if we move again (opponent stuck) there is no immediate reply
  if (next.currentTurn !== me) {
    const replies = capturesBy(opponentOf(me), state.mode, tiles, next.units);
    if (replies.some((c) => c.victim.rank === 4 && state.mode === 'dominion')) notes.push('!! KING CAPTURABLE');
    const hanging = describeThreats(replies, state.mode, tiles, next.units);
    const fresh = hanging.filter((t) => !standing.includes(t));
    const resolved = standing.filter((t) => !hanging.includes(t));
    if (fresh.length) notes.push(`exposes: ${fresh.join('; ')}`);
    if (resolved.length) notes.push(`resolves: ${resolved.join('; ')}`);
  }
  return notes.length ? ` => ${notes.join(' | ')}` : '';
}

export function describeAction(mode: GameMode, action: GameAction, units: Unit[]): string {
  if (action.kind === 'pass') return 'PASS (no legal move)';
  const unit = units.find((u) => u.id === action.unitId)!;
  const { move } = action;
  const name = getPieceName(mode, unit.rank);
  const turnOnly = move.target.q === unit.coord.q && move.target.r === unit.coord.r;

  let text = turnOnly
    ? `${name} ${fmt(unit.coord)} turns to face ${DIRECTION_NAMES[move.facing ?? 0]}`
    : `${name} ${fmt(unit.coord)} -> ${fmt(move.target)}`;
  if (move.isAttack) {
    const target = units.find((u) => u.id === move.targetUnitId);
    text += ` CAPTURE ${target ? getPieceName(mode, target.rank) : '?'}`;
    if (move.attackRank !== undefined) text += ` [ATK ${move.attackRank} vs DEF ${move.defenseRank}]`;
  }
  if (!turnOnly && move.facing !== undefined && unit.rank === 1 && mode === 'gambit') {
    text += ` (facing ${DIRECTION_NAMES[move.facing]})`;
  }
  if (mode === 'dominion' && move.path.length > 2) {
    text += ` via ${move.path.slice(1, -1).map(fmt).join(' ')}`;
  }
  return text;
}

export function buildRemoteSnapshot(params: {
  state: GameState;
  tiles: Map<string, HexTile>;
  actions: GameAction[];
  history: MoveRecord[];
  clockLine?: string;
}): string {
  const { state, tiles, actions, history, clockLine } = params;
  const { mode, roundNumber, units } = state;
  const inCheck = mode === 'gambit' && isKingInCheck(state.currentTurn, tiles, units);
  const isGambit = mode === 'gambit';
  const lines: string[] = [];

  lines.push(`HexDominion · ${GAME_MODE_NAMES[mode]} · ${isGambit ? 'Move' : 'Round'} ${roundNumber}`);
  lines.push('You play RED (lowercase, starts north, r = -4). Blue is UPPERCASE.');
  lines.push(`Letters: ${Object.entries(LETTERS[mode]).reverse().map(([rank, l]) => `${l}=${getPieceName(mode, Number(rank) as 1)}`).join(' ')}`);
  lines.push('Directions: E=(+1,0) NE=(+1,-1) NW=(0,-1) W=(-1,0) SW=(-1,+1) SE=(0,+1)');
  if (!isGambit) lines.push('Rank order: only your highest-ranked units that can still move this round may move.');
  if (clockLine) lines.push(clockLine);
  if (inCheck) lines.push('*** Your King is in CHECK ***');
  lines.push('');
  lines.push(...renderBoard(mode, tiles, units));
  lines.push('');

  for (const team of ['ai', 'player'] as const) {
    lines.push(team === 'ai' ? 'RED (you):' : 'BLUE (opponent):');
    for (const u of units.filter((x) => x.team === team && !x.isDefeated)) {
      let line = `  ${getPieceName(mode, u.rank).padEnd(8)} ${fmt(u.coord)}`;
      if (isGambit && u.rank === 1 && u.facing !== undefined) line += ` facing ${DIRECTION_NAMES[u.facing]}`;
      if (!isGambit) {
        line += ` DEF ${calculateDefensiveRank(u, units)}`;
        if (u.hasMovedThisRound) line += ' (moved this round)';
      }
      lines.push(line);
    }
    const lost = units.filter((x) => x.team === team && x.isDefeated);
    if (lost.length) lines.push(`  lost: ${lost.map((x) => getPieceName(mode, x.rank)).join(', ')}`);
  }

  const recent = history.slice(-6);
  if (recent.length) {
    lines.push('');
    lines.push('Recent moves:');
    for (const m of recent) {
      const who = m.team === 'player' ? 'Blue' : 'Red ';
      const what = m.isAttack ? ` captures ${m.capturedName}` : '';
      const facing = m.facing !== undefined ? ` facing ${DIRECTION_NAMES[m.facing]}` : '';
      lines.push(`  ${who} ${m.unitName} ${fmt(m.from)} -> ${fmt(m.to)}${what}${facing}${m.isCheck ? ' +check' : ''}`);
    }
  }

  const myThreats = describeThreats(capturesBy('player', mode, tiles, units), mode, tiles, units);
  const theirThreats = describeThreats(capturesBy('ai', mode, tiles, units), mode, tiles, units);
  lines.push('');
  lines.push(`Your pieces under attack now${isGambit ? '' : ' (by Blue units that have not moved this round)'}:`);
  lines.push(...(myThreats.length ? myThreats.map((t) => `  ${t}`) : ['  none']));
  lines.push('Blue pieces you can capture now:');
  lines.push(...(theirThreats.length ? theirThreats.map((t) => `  ${t}`) : ['  none']));

  lines.push('');
  lines.push('Legal moves (=> changes to what the opponent can capture right after):');
  actions.forEach((a, i) =>
    lines.push(`  ${String(i).padStart(3)}: ${describeAction(mode, a, units)}${describeOutcome(state, tiles, a, myThreats)}`)
  );
  return lines.join('\n');
}

// Stable identity of an action, so tools can map their own move list onto the page's indices
export function actionKey(action: GameAction): string {
  if (action.kind === 'pass') return 'pass';
  const { target, facing } = action.move;
  return `${action.unitId}>${target.q},${target.r}${facing !== undefined ? `/${facing}` : ''}`;
}

// Machine-readable position for local tools (scripts/remote-assist.mjs)
export interface RemotePosition {
  state: GameState;
  actionKeys: string[];
  clock: { ai: number; player: number; incrementMs: number } | null; // ms left when posted
}

export async function postRemoteState(
  token: string,
  text: string,
  moveCount: number,
  position: RemotePosition
): Promise<void> {
  await fetch(`${REMOTE_ENDPOINT}/state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, text, moveCount, position }),
  });
}

// Resolves with the chosen move index once the agent answers (null when aborted)
export async function pollRemoteMove(token: string, signal: AbortSignal): Promise<number | null> {
  while (!signal.aborted) {
    try {
      const res = await fetch(`${REMOTE_ENDPOINT}/move?token=${encodeURIComponent(token)}`, { signal });
      if (res.status === 200) {
        const { index } = (await res.json()) as { index: number };
        return index;
      }
    } catch {
      if (signal.aborted) return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return null;
}
