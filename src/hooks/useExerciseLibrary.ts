import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDatabase } from '../context/DatabaseContext';
import type { AppError } from '../domain/errors';
import { exerciseDisplayName, type NameLookup } from '../domain/exerciseLibrary';
import type { Exercise } from '../domain/models';

export type LibraryState =
  | { status: 'loading' }
  | { status: 'unavailable'; error: AppError }
  | { status: 'failed'; error: AppError }
  | { status: 'ready'; exercises: Exercise[] };

/** Every exercise (hidden ones included; the screens filter), read through the repository. */
export function useExerciseLibrary(): { state: LibraryState; reload: () => Promise<void>; retryDatabase: () => void } {
  const { state: db, retry } = useDatabase();
  const [data, setData] = useState<{ exercises: Exercise[] } | { error: AppError } | null>(null);
  const repos = db.status === 'ready' ? db.repos : null;

  const fetchAll = useCallback(async () => {
    if (!repos) return null;
    const r = await repos.exercises.list({ includeArchived: true });
    return r.ok ? { exercises: r.value } : { error: r.error };
  }, [repos]);

  useEffect(() => {
    if (!repos) return;
    let cancelled = false;
    (async () => {
      const r = await fetchAll();
      if (!cancelled) setData(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [repos, fetchAll]);

  const reload = useCallback(async () => {
    setData(await fetchAll());
  }, [fetchAll]);

  let state: LibraryState;
  if (db.status === 'unavailable') state = { status: 'unavailable', error: db.error };
  else if (db.status === 'loading' || data === null) state = { status: 'loading' };
  else if ('error' in data) state = { status: 'failed', error: data.error };
  else state = { status: 'ready', exercises: data.exercises };
  return { state, reload, retryDatabase: retry };
}

/** `(exercise) => displayed name` in the current language. A missing translation falls back to the spelled-out slug. */
export function useExerciseName(): (e: Pick<Exercise, 'slug' | 'customName' | 'source'>) => string {
  const { t } = useTranslation();
  const lookup: NameLookup = (key) => {
    const v = t(key);
    return v === key ? undefined : v;
  };
  return (e) => exerciseDisplayName(e, lookup);
}
