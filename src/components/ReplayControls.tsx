import React, { useEffect, useState } from 'react';
import { GameMode, MoveRecord } from '../types/game';
import { DIRECTION_NAMES } from '../utils/hexMath';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Trophy,
} from 'lucide-react';

interface ReplayControlsProps {
  mode: GameMode;
  moveHistory: MoveRecord[];
  index: number; // 0 = starting position, n = board after move n
  onIndexChange: (index: number) => void;
  onShowSummary: () => void;
  onExportText: () => void;
  onNewMatch: () => void;
}

const PLAYBACK_INTERVAL_MS = 900;

function describeMove(move: MoveRecord, mode: GameMode): string {
  const side = move.team === 'player' ? 'You' : 'AI';
  const to = `(${move.to.q},${move.to.r})`;
  const turnedInPlace = move.from.q === move.to.q && move.from.r === move.to.r;
  let action: string;
  if (move.isAttack) {
    action =
      mode === 'gambit'
        ? `captured ${move.capturedName} at ${to}`
        : `struck ${move.capturedName} at ${to} · ATK ${move.attackRank} vs DEF ${move.defenseRank}`;
  } else if (turnedInPlace && move.facing !== undefined) {
    action = `turned to face ${DIRECTION_NAMES[move.facing]}`;
  } else {
    action = `moved (${move.from.q},${move.from.r}) → ${to}`;
    if (move.facing !== undefined) action += ` facing ${DIRECTION_NAMES[move.facing]}`;
  }
  const outcome = move.isWinningMove
    ? mode === 'gambit'
      ? ' · Checkmate'
      : ' · Decisive blow'
    : move.isCheck
    ? ' · Check'
    : '';
  return `${side} · ${move.unitName} ${action}${outcome}`;
}

const iconButton =
  'p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent transition-colors';
const actionButton =
  'px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors';

export const ReplayControls: React.FC<ReplayControlsProps> = ({
  mode,
  moveHistory,
  index,
  onIndexChange,
  onShowSummary,
  onExportText,
  onNewMatch,
}) => {
  const total = moveHistory.length;
  const [isPlaying, setIsPlaying] = useState(false);
  const current = index > 0 ? moveHistory[index - 1] : null;

  const goTo = (i: number) => onIndexChange(Math.max(0, Math.min(total, i)));

  // Autoplay: advance one move per tick, stop at the end
  useEffect(() => {
    if (!isPlaying) return;
    if (index >= total) {
      setIsPlaying(false);
      return;
    }
    const timer = setTimeout(() => onIndexChange(index + 1), PLAYBACK_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [isPlaying, index, total, onIndexChange]);

  // Keyboard: ←/→ step, Home/End jump, Space play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.key !== ' ') return;
      if (e.key === 'ArrowLeft') {
        setIsPlaying(false);
        goTo(index - 1);
      } else if (e.key === 'ArrowRight') {
        setIsPlaying(false);
        goTo(index + 1);
      } else if (e.key === 'Home') {
        setIsPlaying(false);
        goTo(0);
      } else if (e.key === 'End') {
        setIsPlaying(false);
        goTo(total);
      } else if (e.key === ' ') {
        setIsPlaying((p) => (index >= total ? false : !p));
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (index >= total) onIndexChange(0);
      setIsPlaying(true);
    }
  };

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 w-[min(44rem,calc(100vw-2rem))] flex flex-col gap-2 p-3 rounded-2xl bg-slate-900/90 border border-slate-700 backdrop-blur-md shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-200">
      {/* Current move description + post-game actions */}
      <div className="flex items-center gap-2 text-xs min-w-0">
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            current
              ? current.team === 'player'
                ? 'bg-cyan-400 shadow-[0_0_8px_#38bdf8]'
                : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'
              : 'bg-slate-500'
          }`}
        />
        <span className="font-bold text-white shrink-0">
          {current ? `${mode === 'gambit' ? 'Move' : 'Round'} ${current.roundNumber}` : 'Start'}
        </span>
        <span className="text-slate-300 truncate flex-1" title={current ? describeMove(current, mode) : undefined}>
          {current ? describeMove(current, mode) : 'Starting position'}
        </span>
        <button onClick={onShowSummary} className={actionButton} title="Summary">
          <Trophy className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Summary</span>
        </button>
        <button onClick={onExportText} className={actionButton} title="Export Text">
          <Download className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Export</span>
        </button>
        <button
          onClick={onNewMatch}
          title="New Match"
          className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-md"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">New Match</span>
        </button>
      </div>

      {/* Transport + scrubber */}
      <div className="flex items-center gap-1">
        <button className={iconButton} onClick={() => { setIsPlaying(false); goTo(0); }} disabled={index === 0} title="First (Home)">
          <SkipBack className="w-4 h-4" />
        </button>
        <button className={iconButton} onClick={() => { setIsPlaying(false); goTo(index - 1); }} disabled={index === 0} title="Previous (←)">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button className={iconButton} onClick={togglePlay} disabled={total === 0} title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}>
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button className={iconButton} onClick={() => { setIsPlaying(false); goTo(index + 1); }} disabled={index >= total} title="Next (→)">
          <ChevronRight className="w-4 h-4" />
        </button>
        <button className={iconButton} onClick={() => { setIsPlaying(false); goTo(total); }} disabled={index >= total} title="Last (End)">
          <SkipForward className="w-4 h-4" />
        </button>

        <input
          type="range"
          min={0}
          max={total}
          value={index}
          onChange={(e) => {
            setIsPlaying(false);
            goTo(Number(e.target.value));
          }}
          className="flex-1 mx-2 accent-cyan-400 cursor-pointer"
          aria-label="Move"
        />

        <span className="text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
          {index} / {total}
        </span>
      </div>

    </div>
  );
};
