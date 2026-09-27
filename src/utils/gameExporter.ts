import { GameMode, GAME_MODE_NAMES, MoveRecord, HexTile, Unit, Team, getPieceName } from '../types/game';
import { calculateDefensiveRank } from './gameRules';
import { EndReason } from './gameState';
import { DIRECTION_NAMES } from './hexMath';

export interface GameExportData {
  mode: GameMode;
  winner: Team | null;
  endReason: EndReason | null;
  roundNumber: number;
  totalMoves: number;
  playerInfluencePct: number;
  aiInfluencePct: number;
  playerDefeats: number;
  aiDefeats: number;
  tiles: Map<string, HexTile>;
  units: Unit[];
  moveHistory: MoveRecord[];
}

export function generateGameLogText(data: GameExportData): string {
  const {
    mode,
    winner,
    endReason,
    roundNumber,
    totalMoves,
    playerInfluencePct,
    aiInfluencePct,
    playerDefeats,
    aiDefeats,
    units,
    moveHistory,
  } = data;

  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';

  const isGambit = mode === 'gambit';
  const how =
    endReason === 'checkmate'
      ? 'Checkmate'
      : endReason === 'stalemate'
      ? 'Stalemate'
      : endReason === 'no-captures'
      ? 'no captures for 100 moves'
      : 'King Eliminated';
  let resultStr = 'IN PROGRESS';
  if (winner === 'player') {
    resultStr = `PLAYER VICTORY (${how})`;
  } else if (winner === 'ai') {
    resultStr = `AI VICTORY (${how})`;
  } else if (endReason) {
    resultStr = `DRAW (${how})`;
  }

  const lines: string[] = [];

  lines.push('======================================================================');
  lines.push('                   HEXDOMINION - MATCH TRANSCRIPT                     ');
  lines.push('======================================================================');
  lines.push(`Date:               ${timestamp}`);
  lines.push(`Mode:               ${GAME_MODE_NAMES[mode]}`);
  lines.push(`Result:             ${resultStr}`);
  if (!isGambit) lines.push(`Rounds Fought:      ${roundNumber}`);
  lines.push(`Total Moves:        ${totalMoves}`);
  if (!isGambit) {
    lines.push(`Final Influence:    Player: ${playerInfluencePct}%  |  AI: ${aiInfluencePct}%  |  Neutral: ${Math.max(0, 100 - playerInfluencePct - aiInfluencePct)}%`);
  }
  lines.push(`Casualties:         Player lost ${playerDefeats} unit(s)  |  AI lost ${aiDefeats} unit(s)`);
  lines.push('======================================================================\n');

  // Last move callout
  if (moveHistory.length > 0) {
    const lastMove = moveHistory[moveHistory.length - 1];
    lines.push('----------------------------------------------------------------------');
    lines.push('DECISIVE LAST MOVE');
    lines.push('----------------------------------------------------------------------');
    const mover = lastMove.team === 'player' ? 'Player (Blue)' : 'AI (Red)';
    const fromStr = `(q: ${lastMove.from.q}, r: ${lastMove.from.r})`;
    const toStr = `(q: ${lastMove.to.q}, r: ${lastMove.to.r})`;
    lines.push(`Move #${lastMove.turnNumber} [${isGambit ? 'Move' : 'Round'} ${lastMove.roundNumber}] by ${mover}`);
    lines.push(`Unit:       ${lastMove.unitName}${isGambit ? '' : ` (Level ${lastMove.unitRank})`}`);
    lines.push(`Position:   ${fromStr} -> ${toStr}`);
    if (lastMove.isAttack) {
      lines.push(`Combat:     Struck down ${lastMove.capturedName}${isGambit ? '' : ` (Level ${lastMove.capturedRank})`}`);
      if (lastMove.attackRank !== undefined && lastMove.defenseRank !== undefined) {
        lines.push(`Odds:       ATK ${lastMove.attackRank} vs DEF ${lastMove.defenseRank}`);
      }
      if (lastMove.isWinningMove && !isGambit) {
        lines.push(`Outcome:    *** FATAL STRIKE: Opponent King eliminated! GAME OVER ***`);
      }
    } else {
      lines.push('Action:     Maneuver');
    }
    if (isGambit && lastMove.isWinningMove) {
      lines.push(`Outcome:    *** CHECKMATE! GAME OVER ***`);
    }
    lines.push('----------------------------------------------------------------------\n');
  }

  // Final Unit Roster
  lines.push('----------------------------------------------------------------------');
  lines.push('FINAL BATTLEFIELD STATUS');
  lines.push('----------------------------------------------------------------------');
  const rosterLine = (u: Unit) => {
    const name = getPieceName(mode, u.rank).padEnd(10);
    if (u.isDefeated) return isGambit ? `  - ${name} : CAPTURED` : `  - Level ${u.rank} ${name} : DEFEATED`;
    const at = `at (q: ${u.coord.q}, r: ${u.coord.r})`;
    if (isGambit) {
      return `  - ${name} : ${at}${u.rank === 1 && u.facing !== undefined ? ` facing ${DIRECTION_NAMES[u.facing]}` : ''}`;
    }
    return `  - Level ${u.rank} ${name} : ALIVE ${at} [DEF ${calculateDefensiveRank(u, units)}]`;
  };
  lines.push('PLAYER UNITS (Blue):');
  for (const u of units.filter((u) => u.team === 'player')) lines.push(rosterLine(u));
  lines.push('\nAI UNITS (Red):');
  for (const u of units.filter((u) => u.team === 'ai')) lines.push(rosterLine(u));
  lines.push('----------------------------------------------------------------------\n');

  // Complete Move History
  lines.push('----------------------------------------------------------------------');
  lines.push('MOVE-BY-MOVE TRANSCRIPT');
  lines.push('----------------------------------------------------------------------');

  if (moveHistory.length === 0) {
    lines.push('No moves recorded.');
  } else {
    for (const m of moveHistory) {
      const teamTag = m.team === 'player' ? 'PLAYER' : 'AI    ';
      const fromStr = `(${m.from.q},${m.from.r})`;
      const toStr = `(${m.to.q},${m.to.r})`;

      let detail = '';
      if (m.isAttack) {
        detail = isGambit
          ? `CAPTURE ${m.capturedName}`
          : `ATTACK ${m.capturedName} (L${m.capturedRank}) [ATK ${m.attackRank ?? '?'} vs DEF ${m.defenseRank ?? '?'}]`;
      } else if (m.from.q === m.to.q && m.from.r === m.to.r && m.facing !== undefined) {
        detail = `Turned to face ${DIRECTION_NAMES[m.facing]}`;
      } else {
        detail = 'Moved';
      }
      if (isGambit && m.facing !== undefined && !(m.from.q === m.to.q && m.from.r === m.to.r)) {
        detail += ` (facing ${DIRECTION_NAMES[m.facing]})`;
      }
      if (m.isWinningMove) {
        detail += isGambit ? ' *** CHECKMATE ***' : ' *** DECISIVE BLOW ***';
      } else if (m.isCheck) {
        detail += ' + CHECK';
      }

      const pathStr = m.path && m.path.length > 1
        ? ` (via ${m.path.map((c) => `(${c.q},${c.r})`).join('->')})`
        : '';

      lines.push(
        `#${m.turnNumber.toString().padStart(3, ' ')} [${isGambit ? 'M' : 'R'}${m.roundNumber}] ${teamTag} ${m.unitName.padEnd(9, ' ')} ${fromStr.padEnd(8, ' ')} -> ${toStr.padEnd(8, ' ')} | ${detail}${pathStr}`
      );
    }
  }

  lines.push('======================================================================');
  lines.push('                        END OF TRANSCRIPT                             ');
  lines.push('======================================================================');

  return lines.join('\n');
}

export function downloadGameLog(data: GameExportData): void {
  const content = generateGameLogText(data);
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  link.download = `HexDominion_Match_Log_${dateStr}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
