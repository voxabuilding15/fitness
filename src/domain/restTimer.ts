/**
 * The rest timer as a value: it stores WHEN rest ends, not a count, so it is right after the app was in the background
 * or a tick was late. It is only a guide - the saved sets of the session are the record of the workout.
 */
export type RestTimer =
  | { phase: 'idle' }
  | { phase: 'running'; endsAt: number; totalSec: number; exerciseKey: number }
  | { phase: 'done'; totalSec: number; exerciseKey: number };

export const IDLE: RestTimer = { phase: 'idle' };
export const MAX_REST_SEC = 900;

/** Starts a rest of `seconds` (1..900). Anything else leaves the timer idle: a bad duration never starts a timer. */
export function startRest(now: number, seconds: number, exerciseKey: number): RestTimer {
  if (!Number.isFinite(now) || !Number.isInteger(seconds) || seconds < 1 || seconds > MAX_REST_SEC) return IDLE;
  return { phase: 'running', endsAt: now + seconds * 1000, totalSec: seconds, exerciseKey };
}
/** Moves a running timer to `done` once its end has passed. */
export const tickRest = (t: RestTimer, now: number): RestTimer => (t.phase === 'running' && now >= t.endsAt ? { phase: 'done', totalSec: t.totalSec, exerciseKey: t.exerciseKey } : t);
/** Whole seconds left, rounded up (so "0:00" only shows when it is over). */
export const remainingSec = (t: RestTimer, now: number) => (t.phase === 'running' ? Math.max(0, Math.ceil((t.endsAt - now) / 1000)) : 0);
/** "1:05". */
export const formatClock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
