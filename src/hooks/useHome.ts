import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useDatabase } from '../context/DatabaseContext';
import { deviceLocalDate } from '../domain/dates';
import type { AppError } from '../domain/errors';
import type { Exercise, WorkoutSession, WorkoutTemplate } from '../domain/models';
import { buildHomeSummary, homeWindow, type HomeSummary } from '../domain/homeSummary';

export type HomeData =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed'; error: AppError }
  | { status: 'ready'; summary: HomeSummary; active: WorkoutSession | null; templates: WorkoutTemplate[]; exercises: Exercise[] };

/**
 * Everything Home shows beyond the greeting, read from the database when the screen is focused: this week's totals,
 * the workout in progress, and the saved workouts and exercises (for the "your workout" card and the search). If any
 * read fails the whole block is `failed` - Home never shows partial numbers as if they were complete.
 */
export function useHome() {
  const { state: db, retry: retryDatabase } = useDatabase();
  const repos = db.status === 'ready' ? db.repos : null;
  const [data, setData] = useState<{ summary: HomeSummary; active: WorkoutSession | null; templates: WorkoutTemplate[]; exercises: Exercise[] } | { error: AppError } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!repos) return;
      void attempt;
      let cancelled = false;
      (async () => {
        const today = deviceLocalDate(Date.now());
        const [rows, goals, active, templates, exercises] = await Promise.all([
          repos.sessions.dailyActivity(homeWindow(today)), repos.goals.get(), repos.sessions.getActive(), repos.templates.list(), repos.exercises.list({ includeArchived: true }),
        ]);
        if (cancelled) return;
        if (!rows.ok) return setData({ error: rows.error });
        if (!goals.ok) return setData({ error: goals.error });
        if (!active.ok) return setData({ error: active.error });
        if (!templates.ok) return setData({ error: templates.error });
        if (!exercises.ok) return setData({ error: exercises.error });
        setData({
          summary: buildHomeSummary(today, rows.value, goals.value?.weeklyWorkoutTarget ?? null),
          active: active.value, templates: templates.value, exercises: exercises.value,
        });
      })();
      return () => {
        cancelled = true;
      };
    }, [repos, attempt]),
  );

  let state: HomeData;
  if (db.status === 'unavailable') state = { status: 'unavailable' };
  else if (db.status === 'loading' || data === null) state = { status: 'loading' };
  else if ('error' in data) state = { status: 'failed', error: data.error };
  else state = { status: 'ready', ...data };
  return { state, retryDatabase, retry: () => { setData(null); setAttempt((n) => n + 1); } };
}
