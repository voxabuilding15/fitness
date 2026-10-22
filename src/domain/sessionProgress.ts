import type { SessionExercise } from './models';
import type { SetDraft } from './setEntry';

/**
 * Where a person is in a running workout, counted only from the saved sets and the plan recorded at the start.
 * `planned` is null for an exercise with no recorded plan (an older session, or one added by hand): then there is no
 * target to be "done" against, and nothing is invented.
 */
export interface ExerciseProgress { logged: number; planned: number | null; done: boolean }

export function exerciseProgress(e: Pick<SessionExercise, 'sets' | 'plan'>): ExerciseProgress {
  const logged = e.sets.filter((s) => s.isCompleted).length;
  const planned = e.plan?.sets ?? null;
  return { logged, planned, done: planned !== null && logged >= planned };
}

export interface SessionProgress {
  loggedSets: number;
  /** Sum of the planned sets; null unless EVERY exercise has a plan (a partial sum would make the bar lie). */
  plannedSets: number | null;
  exercisesDone: number;
  exerciseCount: number;
  /** loggedSets / plannedSets capped at 1; null without a full plan. */
  ratio: number | null;
}

export function sessionProgress(exercises: readonly Pick<SessionExercise, 'sets' | 'plan'>[]): SessionProgress {
  const per = exercises.map(exerciseProgress);
  const loggedSets = per.reduce((n, p) => n + p.logged, 0);
  const allPlanned = per.length > 0 && per.every((p) => p.planned !== null);
  const plannedSets = allPlanned ? per.reduce((n, p) => n + (p.planned as number), 0) : null;
  return {
    loggedSets, plannedSets, exercisesDone: per.filter((p) => p.done).length, exerciseCount: per.length,
    ratio: plannedSets === null || plannedSets === 0 ? null : Math.min(1, loggedSets / plannedSets),
  };
}

/**
 * The exercise to show first (and after a resume): the first one that is not finished - one with planned sets still to
 * log, or, without a plan, one with nothing logged yet. When everything is done, the last one; for none, -1.
 */
export function firstOpenIndex(exercises: readonly Pick<SessionExercise, 'sets' | 'plan'>[]): number {
  if (exercises.length === 0) return -1;
  const i = exercises.findIndex((e) => {
    const p = exerciseProgress(e);
    return p.planned === null ? p.logged === 0 : !p.done;
  });
  return i >= 0 ? i : exercises.length - 1;
}

/** True when what was typed differs from what the form would show anyway (the previous set's values), i.e. there is something to lose. */
export function hasUnsavedInput(drafts: Readonly<Record<number, SetDraft>>, base: (exerciseRowId: number) => SetDraft | null): boolean {
  return Object.entries(drafts).some(([id, d]) => {
    const b = base(Number(id));
    return b === null || (Object.keys(d) as (keyof SetDraft)[]).some((k) => d[k] !== b[k]);
  });
}
