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
/**
 * Adds time to a RUNNING timer (never beyond 900 s left, never to an idle or finished one). Anything else is returned as it is.
 * `done` is not revived: after "rest is over" a new rest is started on purpose.
 */
export function extendRest(t: RestTimer, now: number, seconds: number): RestTimer {
  if (t.phase !== 'running' || !Number.isFinite(now) || !Number.isInteger(seconds) || seconds < 1) return t;
  const left = Math.max(0, t.endsAt - now);
  const endsAt = now + Math.min(MAX_REST_SEC * 1000, left + seconds * 1000);
  // the rest as a whole is longer by exactly how much later it now ends (so a progress bar stays truthful)
  return { ...t, endsAt, totalSec: Math.max(1, t.totalSec + Math.round((endsAt - t.endsAt) / 1000)) };
}
/** Moves a running timer to `done` once its end has passed. */
export const tickRest = (t: RestTimer, now: number): RestTimer => (t.phase === 'running' && now >= t.endsAt ? { phase: 'done', totalSec: t.totalSec, exerciseKey: t.exerciseKey } : t);
/** Whole seconds left, rounded up (so "0:00" only shows when it is over). */
export const remainingSec = (t: RestTimer, now: number) => (t.phase === 'running' ? Math.max(0, Math.ceil((t.endsAt - now) / 1000)) : 0);
/** "1:05". */
export const formatClock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
