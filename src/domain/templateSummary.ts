import type { TemplateExercise } from './models';

export interface Targets {
  sets: number;
  repsMin: number | null;
  repsMax: number | null;
  durationSec: number | null;
  restSec: number;
}
type T = (key: string, o?: Record<string, string | number>) => string;

/** The numbers of one row, in words: "3 × 8–12 · rest 60 s". Works for a template row and for a session's recorded plan. */
export function summarizeTargets(t: T, e: Targets): string {
  if (e.repsMin === null && e.repsMax === null && e.durationSec !== null) {
    return t('templates.summaryDuration', { sets: e.sets, seconds: e.durationSec, rest: e.restSec });
  }
  const lo = e.repsMin ?? e.repsMax;
  const reps = e.repsMax !== null && e.repsMin !== null && e.repsMax !== e.repsMin ? t('templates.repsRange', { min: e.repsMin, max: e.repsMax }) : String(lo);
  return t('templates.summaryReps', { sets: e.sets, reps, rest: e.restSec });
}

export const targetSummary = (t: T, e: TemplateExercise): string =>
  summarizeTargets(t, { sets: e.targetSets, repsMin: e.targetRepsMin, repsMax: e.targetRepsMax, durationSec: e.targetDurationSec, restSec: e.restSec });
