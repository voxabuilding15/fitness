import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useDatabase } from '../context/DatabaseContext';
import { deviceLocalDate } from '../domain/dates';
import type { AppError } from '../domain/errors';
import type { DailyActivity, WorkoutSession, WorkoutSessionDetail } from '../domain/models';
import { periodWindow, type PeriodWindow, type StatsPeriod } from '../domain/statistics';

export type StatisticsState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'failed'; error: AppError }
  | { status: 'ready'; window: PeriodWindow; rows: DailyActivity[]; latest: WorkoutSessionDetail | null };

/**
 * Totals for one period plus the most recent finished workout, all read from saved COMPLETED sessions, again each time
 * the screen is focused or the period changes. A failed read is `failed`, never a screen of zeros.
 */
export function useStatistics(period: StatsPeriod) {
  const { state: db, retry: retryDatabase } = useDatabase();
  const repos = db.status === 'ready' ? db.repos : null;
  const [data, setData] = useState<{ period: StatsPeriod; window: PeriodWindow; rows: DailyActivity[]; latest: WorkoutSessionDetail | null } | { period: StatsPeriod; error: AppError } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!repos) return;
      void attempt;
      let cancelled = false;
      (async () => {
        const window = periodWindow(period, deviceLocalDate(Date.now()));
        const rows = await repos.sessions.dailyActivity({ from: window.from, to: window.to });
        if (cancelled) return;
        if (!rows.ok) return setData({ period, error: rows.error });
        const last = await repos.sessions.list({ status: 'completed', limit: 1 });
        if (cancelled) return;
        if (!last.ok) return setData({ period, error: last.error });
        let latest: WorkoutSessionDetail | null = null;
        const head: WorkoutSession | undefined = last.value[0];
        if (head) {
          const detail = await repos.sessions.get(head.id);
          if (cancelled) return;
          if (!detail.ok) return setData({ period, error: detail.error });
          latest = detail.value;
        }
        setData({ period, window, rows: rows.value, latest });
      })();
      return () => {
        cancelled = true;
      };
    }, [repos, period, attempt]),
  );

  let state: StatisticsState;
  if (db.status === 'unavailable') state = { status: 'unavailable' };
  else if (db.status === 'loading' || data === null || data.period !== period) state = { status: 'loading' };
  else if ('error' in data) state = { status: 'failed', error: data.error };
  else state = { status: 'ready', window: data.window, rows: data.rows, latest: data.latest };
  return { state, retryDatabase, retry: () => { setData(null); setAttempt((n) => n + 1); } };
}
