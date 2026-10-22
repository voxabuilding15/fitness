import type { SessionExercise, SessionSet } from './models';
import type { TrackingType } from './schemas/enums';

/**
 * Highlights of a finished workout, counted only from its saved sets. There are no personal records here: "best" means the
 * best set OF THIS WORKOUT for that exercise, never a comparison with history.
 */
export interface ExerciseResult {
  sessionExerciseId: number;
  position: number;
  loggedSets: number;
  /** The set that stands out for this exercise in this workout; null when no working set qualifies. */
  best: SessionSet | null;
}

const working = (s: SessionSet) => s.isCompleted && !s.isWarmup;

/**
 * weight x reps: the heaviest set (more reps breaks a tie); reps only: the most reps; duration: the longest;
 * distance: the farthest (longer time breaks a tie). The earliest set wins an exact tie. Warm-ups are never "best".
 */
export function bestSet(tracking: TrackingType, sets: readonly SessionSet[]): SessionSet | null {
  const score = (s: SessionSet): [number, number] | null => {
    switch (tracking) {
      case 'weight_reps': return s.weightKg !== null && s.reps !== null ? [s.weightKg, s.reps] : null;
      case 'reps_only': return s.reps !== null ? [s.reps, 0] : null;
      case 'duration': return s.durationSec !== null ? [s.durationSec, 0] : null;
      case 'distance_duration': return s.distanceM !== null ? [s.distanceM, s.durationSec ?? 0] : null;
    }
  };
  let best: SessionSet | null = null;
  let bestScore: [number, number] | null = null;
  for (const s of sets) {
    if (!working(s)) continue;
    const sc = score(s);
    if (!sc) continue;
    if (!bestScore || sc[0] > bestScore[0] || (sc[0] === bestScore[0] && sc[1] > bestScore[1])) { best = s; bestScore = sc; }
  }
  return best;
}

export function exerciseResults(exercises: readonly SessionExercise[], trackingOf: (e: SessionExercise) => TrackingType): ExerciseResult[] {
  return exercises.map((e) => ({
    sessionExerciseId: e.id,
    position: e.position,
    loggedSets: e.sets.filter((s) => s.isCompleted).length,
    best: bestSet(trackingOf(e), e.sets),
  }));
}

/** Exercises that ended with no logged set (a partly done workout). */
export const notDone = (results: readonly ExerciseResult[]) => results.filter((r) => r.loggedSets === 0).map((r) => r.sessionExerciseId);

export const EFFORT_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
