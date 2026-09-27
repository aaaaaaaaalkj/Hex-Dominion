import React, { useState } from 'react';
import { Team, MoveRecord } from '../types/game';
import {
  Trophy,
  Skull,
  RotateCcw,
  Eye,
  Download,
  Copy,
  Check,
  FileText,
} from 'lucide-react';

interface GameOverModalProps {
  winner: Team;
  roundNumber: number;
  totalMoves: number;
  playerInfluencePct: number;
  aiInfluencePct: number;
  playerDefeats: number;
  aiDefeats: number;
  lastMove: MoveRecord | null;
  onRestart: () => void;
  onInspectBoard: () => void;
  onExportText: () => void;
  onCopyText: () => Promise<boolean>;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({
  winner,
  roundNumber,
  totalMoves,
  playerInfluencePct,
  aiInfluencePct,
  playerDefeats,
  aiDefeats,
  lastMove,
  onRestart,
  onInspectBoard,
  onExportText,
  onCopyText,
}) => {
  const isPlayerWinner = winner === 'player';
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = async () => {
    const success = await onCopyText();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
      <div className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 text-slate-100 overflow-hidden">
        {/* Glow backdrop */}
        <div
          className={`absolute -top-24 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-3xl opacity-20 pointer-events-none ${
            isPlayerWinner ? 'bg-cyan-400' : 'bg-rose-500'
          }`}
        />

        {/* Victory/Defeat Icon */}
        <div className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3 shadow-xl">
          {isPlayerWinner ? (
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-300 flex items-center justify-center text-slate-950 shadow-amber-500/50 shadow-lg">
              <Trophy className="w-7 h-7" />
            </div>
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-rose-600 to-red-800 flex items-center justify-center text-white shadow-rose-600/50 shadow-lg">
              <Skull className="w-7 h-7" />
            </div>
          )}
        </div>

        {/* Title */}
        <div className="text-center mb-4">
          <h2 className="text-2xl font-bold font-display tracking-wide mb-1 text-white">
            {isPlayerWinner ? 'Glorious Victory' : 'Defeat in Battle'}
          </h2>
          <p className="text-xs text-slate-400">
            {isPlayerWinner
              ? 'You struck down the AI King and seized control of the battlefield!'
              : 'Your King was struck down by the enemy.'}
          </p>
        </div>

        {/* Last Decisive Move Callout */}
        {lastMove && (
          <div className="mb-4 p-3 rounded-xl bg-slate-950/90 border border-amber-500/30 text-left">
            <div className="flex items-center justify-between text-[11px] font-semibold text-amber-400 mb-1">
              <span>DECISIVE FINAL MOVE</span>
              <span className="font-mono text-slate-400">
                Move #{lastMove.turnNumber} · Round {lastMove.roundNumber}
              </span>
            </div>
            <p className="text-xs text-slate-200">
              <strong className={lastMove.team === 'player' ? 'text-cyan-400' : 'text-rose-400'}>
                {lastMove.team === 'player' ? 'Player' : 'AI'} {lastMove.unitName}
              </strong>{' '}
              {lastMove.isAttack ? (
                <>
                  struck down{' '}
                  <strong className={lastMove.team === 'player' ? 'text-rose-400' : 'text-cyan-400'}>
                    {lastMove.capturedName} (L{lastMove.capturedRank})
                  </strong>{' '}
                  at{' '}
                  <span className="font-mono text-slate-400">
                    ({lastMove.to.q}, {lastMove.to.r})
                  </span>
                  {lastMove.attackRank !== undefined && lastMove.defenseRank !== undefined && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-mono text-amber-300">
                      ATK {lastMove.attackRank} vs DEF {lastMove.defenseRank}
                    </span>
                  )}
                </>
              ) : (
                <>
                  moved to ({lastMove.to.q}, {lastMove.to.r})
                </>
              )}
            </p>
          </div>
        )}

        {/* Statistics Grid */}
        <div className="grid grid-cols-4 gap-2 mb-4 text-center">
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">Rounds</span>
            <span className="text-base font-bold font-mono text-white tabular-nums">
              {roundNumber}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">Moves</span>
            <span className="text-base font-bold font-mono text-white tabular-nums">
              {totalMoves}
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">Your Influence</span>
            <span className="text-base font-bold font-mono text-cyan-400 tabular-nums">
              {playerInfluencePct}%
            </span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
            <span className="text-[10px] text-slate-400 block">Casualties</span>
            <span className="text-base font-bold font-mono text-emerald-400 tabular-nums">
              {aiDefeats}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          {/* Primary Action: Inspect Board */}
          <button
            onClick={onInspectBoard}
            className="w-full py-2.5 px-4 rounded-xl font-semibold text-xs transition-all duration-200 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 shadow-md"
          >
            <Eye className="w-4 h-4 text-cyan-400" />
            <span>Inspect Board & Final Move</span>
          </button>

          {/* Export Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onExportText}
              className="py-2.5 px-3 rounded-xl font-semibold text-xs transition-all duration-200 flex items-center justify-center gap-2 bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>Export as Text</span>
            </button>
            <button
              onClick={handleCopy}
              className="py-2.5 px-3 rounded-xl font-semibold text-xs transition-all duration-200 flex items-center justify-center gap-2 bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy Log</span>
                </>
              )}
            </button>
          </div>

          {/* Restart Button */}
          <button
            onClick={onRestart}
            className={`w-full py-3 px-4 rounded-xl font-semibold text-xs transition-all duration-200 flex items-center justify-center gap-2 shadow-lg mt-1 ${
              isPlayerWinner
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/25'
                : 'bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 shadow-slate-900/50'
            }`}
          >
            <RotateCcw className="w-4 h-4" />
            <span>Play Again (New Map)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
