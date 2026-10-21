import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useDatabase } from '../context/DatabaseContext';
import type { AppError } from '../domain/errors';
import type { WorkoutSession } from '../domain/models';

export const HISTORY_PAGE_SIZE = 20;

export type HistoryState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed'; error: AppError }
  | { status: 'ready'; items: WorkoutSession[]; hasMore: boolean };

/**
 * Completed workouts, newest first, read through `sessions.list({ status: 'completed' })` (never an unfiltered list, so
 * discarded and in-progress sessions can't appear). The first page is read again each time the screen is focused; further
 * pages are appended on request. A failed "show more" keeps the pages already shown and reports its own error.
 */
export function useWorkoutHistory() {
  const { state: db, retry: retryDatabase } = useDatabase();
  const repos = db.status === 'ready' ? db.repos : null;
  const [data, setData] = useState<{ items: WorkoutSession[]; hasMore: boolean } | { error: AppError } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [moreError, setMoreError] = useState<AppError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const busy = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!repos) return;
      void attempt;
      let cancelled = false;
      (async () => {
        const r = await repos.sessions.list({ status: 'completed', limit: HISTORY_PAGE_SIZE, offset: 0 });
        if (cancelled) return;
        setMoreError(null);
        setData(r.ok ? { items: r.value, hasMore: r.value.length === HISTORY_PAGE_SIZE } : { error: r.error });
      })();
      return () => {
        cancelled = true;
      };
    }, [repos, attempt]),
  );

  const loadMore = useCallback(async () => {
    if (!repos || busy.current || !data || 'error' in data || !data.hasMore) return;
    busy.current = true;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const r = await repos.sessions.list({ status: 'completed', limit: HISTORY_PAGE_SIZE, offset: data.items.length });
      if (!r.ok) return setMoreError(r.error);
      const seen = new Set(data.items.map((s) => s.id));
      setData({ items: [...data.items, ...r.value.filter((s) => !seen.has(s.id))], hasMore: r.value.length === HISTORY_PAGE_SIZE });
    } finally {
      busy.current = false;
      setLoadingMore(false);
    }
  }, [repos, data]);

  let state: HistoryState;
  if (db.status === 'unavailable') state = { status: 'unavailable' };
  else if (db.status === 'loading' || data === null) state = { status: 'loading' };
  else if ('error' in data) state = { status: 'failed', error: data.error };
  else state = { status: 'ready', items: data.items, hasMore: data.hasMore };
  return { state, loadMore, loadingMore, moreError, retryDatabase, retry: () => { setData(null); setAttempt((n) => n + 1); } };
}
