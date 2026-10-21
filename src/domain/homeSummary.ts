import type { DailyActivity } from './models';
import { weekStart } from './statistics';

/** The days Home summarises: this week so far (weeks start on Saturday, as on the Statistics screen). */
export const homeWindow = (today: string) => ({ from: weekStart(today), to: today });

export interface HomeSummary {
  weekWorkouts: number;
  todayMinutes: number;
  todayVolumeKg: number;
  /** The weekly workout goal from the saved goals; null when no goals were saved. */
  weeklyTarget: number | null;
  /** weekWorkouts / weeklyTarget, 0..1; null without a target. */
  progress: number | null;
}

/** Totals from saved COMPLETED workouts only (see `SessionRepository.dailyActivity`); nothing is estimated. */
export function buildHomeSummary(today: string, rows: readonly DailyActivity[], weeklyTarget: number | null): HomeSummary {
  const { from } = homeWindow(today);
  const week = rows.filter((r) => r.localDate >= from && r.localDate <= today);
  const now = rows.find((r) => r.localDate === today);
  const weekWorkouts = week.reduce((s, r) => s + r.workouts, 0);
  const target = weeklyTarget !== null && weeklyTarget > 0 ? weeklyTarget : null;
  return {
    weekWorkouts, todayMinutes: now?.minutes ?? 0, todayVolumeKg: now?.volumeKg ?? 0, weeklyTarget: target,
    progress: target === null ? null : Math.min(1, weekWorkouts / target),
  };
}
