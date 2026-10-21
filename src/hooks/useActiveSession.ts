import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useDatabase } from '../context/DatabaseContext';
import type { AppError } from '../domain/errors';
import type { WorkoutSessionDetail } from '../domain/models';

export type ActiveSessionState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed'; error: AppError }
  | { status: 'ready'; active: WorkoutSessionDetail | null };

/** The workout in progress, if any, read again each time the screen is focused. */
export function useActiveSession(): ActiveSessionState {
  const { state: db } = useDatabase();
  const repos = db.status === 'ready' ? db.repos : null;
  const [data, setData] = useState<{ active: WorkoutSessionDetail | null } | { error: AppError } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!repos) return;
      let cancelled = false;
      (async () => {
        const r = await repos.sessions.getActive();
        if (!cancelled) setData(r.ok ? { active: r.value } : { error: r.error });
      })();
      return () => {
        cancelled = true;
      };
    }, [repos]),
  );

  if (db.status === 'unavailable') return { status: 'unavailable' };
  if (db.status === 'loading' || data === null) return { status: 'loading' };
  return 'error' in data ? { status: 'failed', error: data.error } : { status: 'ready', active: data.active };
}
