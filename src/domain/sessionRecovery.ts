import type { WorkoutSessionDetail } from './models';

/**
 * What can honestly be said about a workout that is opened again (after the app was closed, killed, or the screen was left).
 * Everything here comes from timestamps the database holds: the session's start and the time each set was logged.
 * The rest timer is NOT among them: it lives in memory only, so no rest time is ever reconstructed or guessed.
 */
export interface Recovery {
  loggedSets: number;
  /** The newest logged set's time; null when no set was logged. */
  lastLoggedAt: number | null;
  /** Whole minutes since that set; null when there is none, or when the clock reads earlier than it (a clock change - not guessed). */
  minutesSinceLastSet: number | null;
  /** Whole minutes since the workout started; null if the clock reads earlier than the start. */
  minutesSinceStart: number | null;
}

const minutesBetween = (from: number, now: number) => (Number.isFinite(now) && now >= from ? Math.floor((now - from) / 60_000) : null);

export function recoveryOf(session: WorkoutSessionDetail, now: number): Recovery {
  const logged = session.exercises.flatMap((e) => e.sets).filter((s) => s.isCompleted);
  const times = logged.map((s) => s.completedAt).filter((v): v is number => v !== null);
  const lastLoggedAt = times.length ? Math.max(...times) : null;
  return {
    loggedSets: logged.length,
    lastLoggedAt,
    minutesSinceLastSet: lastLoggedAt === null ? null : minutesBetween(lastLoggedAt, now),
    minutesSinceStart: minutesBetween(session.startedAt, now),
  };
}

/** The note about a reopened workout is for an in-progress session that already has logged sets (a just-started one has nothing to recover). */
export const shouldShowRecovery = (session: WorkoutSessionDetail, r: Recovery) => session.status === 'in_progress' && r.loggedSets > 0;

/** { h, m } for a number of whole minutes ("1 h 5 min"); under a minute is { 0, 0 }. */
export const splitMinutes = (minutes: number) => ({ h: Math.floor(minutes / 60), m: minutes % 60 });
