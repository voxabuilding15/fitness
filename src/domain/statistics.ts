import { addDays } from './dates';
import type { DailyActivity } from './models';

/**
 * Statistics from saved workouts. Nothing here is estimated or sampled: every number is a sum over what the database
 * holds for COMPLETED sessions (see `SessionRepository.dailyActivity`). Weeks start on Saturday (as the chart's day labels
 * do); a month is split into four buckets - days 1-7, 8-14, 15-21 and 22 to the end of the month.
 */
export type StatsMetric = 'workouts' | 'volume' | 'minutes';
export type StatsPeriod = 'thisWeek' | 'lastWeek' | 'thisMonth';
export const WEEK_LABELS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'] as const;
export const MONTH_LABELS = ['w1', 'w2', 'w3', 'w4'] as const;

export interface Bucket { labelKey: string; from: string; to: string }
export interface PeriodWindow { from: string; to: string; buckets: Bucket[]; todayIndex: number }

const dow = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
};
/** The Saturday on or before `date`. */
export const weekStart = (date: string) => addDays(date, -((dow(date) + 1) % 7));
const monthEnd = (date: string) => {
  const [y, m] = date.split('-').map(Number);
  return addDays(`${String(m === 12 ? y + 1 : y).padStart(4, '0')}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
};

/** The days a period covers, split into the chart's buckets, and which bucket holds `today` (the last one when today is outside it). */
export function periodWindow(period: StatsPeriod, today: string): PeriodWindow {
  let buckets: Bucket[];
  if (period === 'thisMonth') {
    const first = `${today.slice(0, 7)}-01`;
    const last = monthEnd(today);
    buckets = MONTH_LABELS.map((labelKey, i) => ({ labelKey, from: addDays(first, i * 7), to: i === 3 ? last : addDays(first, i * 7 + 6) }));
  } else {
    const start = addDays(weekStart(today), period === 'lastWeek' ? -7 : 0);
    buckets = WEEK_LABELS.map((labelKey, i) => ({ labelKey, from: addDays(start, i), to: addDays(start, i) }));
  }
  const idx = buckets.findIndex((b) => today >= b.from && today <= b.to);
  return { from: buckets[0].from, to: buckets[buckets.length - 1].to, buckets, todayIndex: idx >= 0 ? idx : buckets.length - 1 };
}

const pick = (d: DailyActivity, metric: StatsMetric) => (metric === 'workouts' ? d.workouts : metric === 'volume' ? d.volumeKg : d.minutes);

export interface StatsSeries { metric: StatsMetric; points: { labelKey: string; value: number }[]; total: number; workouts: number }

/** One value per bucket (0 where nothing was done) and the period total. */
export function buildStats(window: PeriodWindow, rows: readonly DailyActivity[], metric: StatsMetric): StatsSeries {
  const points = window.buckets.map((b) => ({
    labelKey: b.labelKey,
    value: Math.round(rows.filter((r) => r.localDate >= b.from && r.localDate <= b.to).reduce((sum, r) => sum + pick(r, metric), 0) * 10) / 10,
  }));
  const inWindow = rows.filter((r) => r.localDate >= window.from && r.localDate <= window.to);
  return { metric, points, total: Math.round(points.reduce((s, p) => s + p.value, 0) * 10) / 10, workouts: inWindow.reduce((s, r) => s + r.workouts, 0) };
}
