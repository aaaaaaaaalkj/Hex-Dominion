import { Team } from '../types/game';

/**
 * Chess-style game clock: each side has a time bank that runs down while it is
 * on turn, plus a fixed increment for every move (ply) it makes. A side whose
 * bank reaches zero loses on time.
 */

export interface ClockPreset {
  id: string;
  label: string;
  baseMs: number;
  incrementMs: number;
}

export const CLOCK_PRESETS: ClockPreset[] = [
  { id: 'off', label: 'No clock', baseMs: 0, incrementMs: 0 },
  { id: '5+10', label: '5 min + 10s', baseMs: 5 * 60_000, incrementMs: 10_000 },
];

export interface ClockState {
  remaining: Record<Team, number>; // ms left, as of `since` for the running side
  running: Team | null;
  since: number; // timestamp (ms) when the running side's time started counting
}

// A fresh clock is stopped: it starts with the first move, like a chess clock
export function startClock(preset: ClockPreset): ClockState {
  return { remaining: { player: preset.baseMs, ai: preset.baseMs }, running: null, since: 0 };
}

// Time left for `team` at `now`, counting the running side's elapsed time
export function timeLeft(clock: ClockState, team: Team, now: number): number {
  const left = clock.remaining[team] - (clock.running === team ? now - clock.since : 0);
  return Math.max(0, left);
}

// Charges the running side for its elapsed time and starts `next` (null stops the clock)
export function switchClock(clock: ClockState, next: Team | null, now: number): ClockState {
  const remaining = { ...clock.remaining };
  if (clock.running) remaining[clock.running] = timeLeft(clock, clock.running, now);
  return { remaining, running: next, since: now };
}

export function addIncrement(clock: ClockState, team: Team, incrementMs: number): ClockState {
  return { ...clock, remaining: { ...clock.remaining, [team]: clock.remaining[team] + incrementMs } };
}

export function formatClock(ms: number): string {
  if (ms < 10_000) return `${Math.floor(ms / 1000)}.${Math.floor((ms % 1000) / 100)}`;
  const totalSeconds = Math.ceil(ms / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
