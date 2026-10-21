import type { ExperienceLevel, CautionArea } from '../types/settings';
import type { Exercise } from '../types/workout';

const LEVEL_FACTOR: Record<ExperienceLevel, number> = { beginner: 0.75, intermediate: 1, advanced: 1.25 };

/** Scales reps / hold time to the saved experience level. */
export function adjustForLevel(exercise: Exercise, level: ExperienceLevel): Exercise {
  const f = LEVEL_FACTOR[level];
  return {
    ...exercise,
    reps: exercise.reps ? Math.max(1, Math.round(exercise.reps * f)) : undefined,
    seconds: exercise.seconds ? Math.max(5, Math.round((exercise.seconds * f) / 5) * 5) : undefined,
  };
}

export const overlappingCautions = (exercise: Exercise, selected: CautionArea[]) =>
  exercise.areas.filter((a) => selected.includes(a));

export function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Lower-cased text used by the Home search to match workout and exercise names. */
export const matches = (haystack: string, query: string) =>
  haystack.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
