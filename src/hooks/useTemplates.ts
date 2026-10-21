import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useDatabase } from '../context/DatabaseContext';
import type { AppError } from '../domain/errors';
import type { Exercise, WorkoutTemplate } from '../domain/models';

export type TemplatesState =
  | { status: 'loading' }
  | { status: 'unavailable'; error: AppError }
  | { status: 'failed'; error: AppError }
  | { status: 'ready'; templates: WorkoutTemplate[]; exercises: Exercise[] };

/**
 * Every saved template plus every exercise (hidden ones included, so a template that uses a hidden exercise still
 * shows its name). Read again each time the screen comes into focus. Any failed read yields `failed`, never an empty
 * list, so no screen can mistake a read failure for "nothing saved".
 */
export function useTemplates(): { state: TemplatesState; retryDatabase: () => void; retry: () => void } {
  const { state: db, retry: retryDatabase } = useDatabase();
  const repos = db.status === 'ready' ? db.repos : null;
  const [data, setData] = useState<{ templates: WorkoutTemplate[]; exercises: Exercise[] } | { error: AppError } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!repos) return;
      void attempt; // changing it re-runs the read ("try again")
      let cancelled = false;
      (async () => {
        const [t, e] = await Promise.all([repos.templates.list(), repos.exercises.list({ includeArchived: true })]);
        if (cancelled) return;
        if (!t.ok) setData({ error: t.error });
        else if (!e.ok) setData({ error: e.error });
        else setData({ templates: t.value, exercises: e.value });
      })();
      return () => {
        cancelled = true;
      };
    }, [repos, attempt]),
  );

  let state: TemplatesState;
  if (db.status === 'unavailable') state = { status: 'unavailable', error: db.error };
  else if (db.status === 'loading' || data === null) state = { status: 'loading' };
  else if ('error' in data) state = { status: 'failed', error: data.error };
  else state = { status: 'ready', templates: data.templates, exercises: data.exercises };
  return { state, retryDatabase, retry: () => { setData(null); setAttempt((n) => n + 1); } };
}
