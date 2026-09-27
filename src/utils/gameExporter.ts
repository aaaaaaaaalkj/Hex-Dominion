import { MoveRecord, HexTile, Unit, Team, UNIT_DEFINITIONS } from '../types/game';
import { calculateDefensiveRank } from './gameRules';

export interface GameExportData {
  winner: Team | null;
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
    winner,
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

  let resultStr = 'IN PROGRESS';
  if (winner === 'player') {
    resultStr = 'PLAYER VICTORY (AI King Eliminated)';
  } else if (winner === 'ai') {
    resultStr = 'AI DEFEAT (Player King Eliminated)';
  }

  const lines: string[] = [];

  lines.push('======================================================================');
  lines.push('                   HEXDOMINION - MATCH TRANSCRIPT                     ');
  lines.push('======================================================================');
  lines.push(`Date:               ${timestamp}`);
  lines.push(`Result:             ${resultStr}`);
  lines.push(`Rounds Fought:      ${roundNumber}`);
  lines.push(`Total Moves:        ${totalMoves}`);
  lines.push(`Final Influence:    Player: ${playerInfluencePct}%  |  AI: ${aiInfluencePct}%  |  Neutral: ${Math.max(0, 100 - playerInfluencePct - aiInfluencePct)}%`);
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
    lines.push(`Move #${lastMove.turnNumber} [Round ${lastMove.roundNumber}] by ${mover}`);
    lines.push(`Unit:       ${lastMove.unitName} (Level ${lastMove.unitRank})`);
    lines.push(`Position:   ${fromStr} -> ${toStr}`);
    if (lastMove.isAttack) {
      lines.push(`Combat:     Struck down ${lastMove.capturedName} (Level ${lastMove.capturedRank})`);
      if (lastMove.attackRank !== undefined && lastMove.defenseRank !== undefined) {
        lines.push(`Odds:       ATK ${lastMove.attackRank} vs DEF ${lastMove.defenseRank}`);
      }
      if (lastMove.isWinningMove) {
        lines.push(`Outcome:    *** FATAL STRIKE: Opponent King eliminated! GAME OVER ***`);
      }
    } else {
      lines.push('Action:     Maneuver');
    }
    lines.push('----------------------------------------------------------------------\n');
  }

  // Final Unit Roster
  lines.push('----------------------------------------------------------------------');
  lines.push('FINAL BATTLEFIELD STATUS');
  lines.push('----------------------------------------------------------------------');
  lines.push('PLAYER UNITS (Blue):');
  const playerUnits = units.filter((u) => u.team === 'player');
  for (const u of playerUnits) {
    const def = UNIT_DEFINITIONS[u.rank];
    const defRank = calculateDefensiveRank(u, units);
    const status = u.isDefeated ? 'DEFEATED' : `ALIVE at (q: ${u.coord.q}, r: ${u.coord.r}) [DEF ${defRank}]`;
    lines.push(`  - Level ${u.rank} ${def.name.padEnd(10)} : ${status}`);
  }

  lines.push('\nAI UNITS (Red):');
  const aiUnits = units.filter((u) => u.team === 'ai');
  for (const u of aiUnits) {
    const def = UNIT_DEFINITIONS[u.rank];
    const defRank = calculateDefensiveRank(u, units);
    const status = u.isDefeated ? 'DEFEATED' : `ALIVE at (q: ${u.coord.q}, r: ${u.coord.r}) [DEF ${defRank}]`;
    lines.push(`  - Level ${u.rank} ${def.name.padEnd(10)} : ${status}`);
  }
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
        detail = `ATTACK ${m.capturedName} (L${m.capturedRank}) [ATK ${m.attackRank ?? '?'} vs DEF ${m.defenseRank ?? '?'}]`;
        if (m.isWinningMove) {
          detail += ' *** DECISIVE BLOW ***';
        }
      } else if (m.from.q === m.to.q && m.from.r === m.to.r) {
        detail = 'Skipped turn (held position - no legal moves)';
      } else {
        detail = 'Moved';
      }

      const pathStr = m.path && m.path.length > 1
        ? ` (via ${m.path.map((c) => `(${c.q},${c.r})`).join('->')})`
        : '';

      lines.push(
        `#${m.turnNumber.toString().padStart(3, ' ')} [R${m.roundNumber}] ${teamTag} ${m.unitName.padEnd(9, ' ')} ${fromStr.padEnd(8, ' ')} -> ${toStr.padEnd(8, ' ')} | ${detail}${pathStr}`
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
