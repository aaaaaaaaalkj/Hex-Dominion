import React, { useEffect, useState } from 'react';
import { Team } from '../types/game';
import { ClockState, formatClock, timeLeft } from '../utils/clock';

interface GameClockProps {
  clock: ClockState;
  onTimeout: (team: Team) => void;
}

/**
 * Both sides' clocks. Ticks on its own so the rest of the app does not re-render
 * every frame, and reports when the running side's time is up.
 */
export const GameClock: React.FC<GameClockProps> = ({ clock, onTimeout }) => {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!clock.running) return;
    const running = clock.running;
    const interval = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (timeLeft(clock, running, t) <= 0) {
        clearInterval(interval);
        onTimeout(running);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [clock, onTimeout]);

  return (
    <div className="absolute top-[4.25rem] left-4 z-30 flex items-center gap-2 font-mono tabular-nums text-sm pointer-events-none">
      {(['player', 'ai'] as Team[]).map((team) => {
        const active = clock.running === team;
        const left = timeLeft(clock, team, active ? Math.max(now, clock.since) : clock.since);
        const tone =
          left === 0
            ? 'text-rose-400'
            : left < 30_000
            ? 'text-amber-300'
            : active
            ? team === 'player'
              ? 'text-cyan-200'
              : 'text-rose-200'
            : 'text-slate-400';
        return (
          <div
            key={team}
            title={team === 'player' ? 'Your clock' : "Opponent's clock"}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border backdrop-blur-md shadow-lg transition-colors ${tone} ${
              active
                ? team === 'player'
                  ? 'bg-cyan-500/20 border-cyan-500/60'
                  : 'bg-rose-500/20 border-rose-500/60'
                : 'bg-slate-900/80 border-slate-800'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${team === 'player' ? 'bg-cyan-400' : 'bg-rose-500'}`} />
            {formatClock(left)}
          </div>
        );
      })}
    </div>
  );
};
