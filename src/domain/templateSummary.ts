import type { TemplateExercise } from './models';

/** The numbers of one row, in words: "3 × 8–12 · rest 60 s". */
export function targetSummary(t: (key: string, o?: Record<string, string | number>) => string, e: TemplateExercise): string {
  const rest = e.restSec;
  if (e.targetRepsMin === null && e.targetRepsMax === null && e.targetDurationSec !== null) {
    return t('templates.summaryDuration', { sets: e.targetSets, seconds: e.targetDurationSec, rest });
  }
  const lo = e.targetRepsMin ?? e.targetRepsMax;
  const reps = e.targetRepsMax !== null && e.targetRepsMin !== null && e.targetRepsMax !== e.targetRepsMin ? t('templates.repsRange', { min: e.targetRepsMin, max: e.targetRepsMax }) : String(lo);
  return t('templates.summaryReps', { sets: e.targetSets, reps, rest });
}
