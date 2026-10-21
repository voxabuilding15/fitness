import type {
  ChartPoint, MetricId, MetricSeries, PeriodId, RecentWorkoutSummary, TodayStat,
} from '../types/activity';

/**
 * ACTIVITY DATA SOURCE
 * --------------------
 * Everything below is bundled *sample data*. Nothing here is read from a device
 * sensor, wearable or health API. `ActivityProvider` is the seam for a future
 * HealthKit / Health Connect integration: implement it and swap `activityProvider`.
 */
export interface ActivityProvider {
  readonly isDemo: boolean;
  getSeries(metric: MetricId, period: PeriodId): MetricSeries;
  getToday(): TodayStat[];
  getRecentWorkout(): RecentWorkoutSummary;
}

export const DAILY_STEP_GOAL = 8000;

export const WEEK_KEYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
export const MONTH_KEYS = ['w1', 'w2', 'w3', 'w4'];

const SAMPLE: Record<PeriodId, { steps: number[]; heartRate: number[] }> = {
  thisWeek: { steps: [4500, 6600, 3600, 5100, 9000, 4300, 4700], heartRate: [72, 75, 70, 78, 92, 74, 71] },
  lastWeek: { steps: [5200, 4100, 6800, 4400, 5900, 3800, 6100], heartRate: [73, 71, 77, 72, 80, 70, 76] },
  thisMonth: { steps: [5100, 4800, 5600, 5400], heartRate: [73, 74, 76, 75] },
};

export const average = (values: number[]) =>
  values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

/** "Regularity" = how much of the daily step goal was reached, capped at 100%. */
const regularity = (steps: number) => Math.min(100, Math.round((steps / DAILY_STEP_GOAL) * 100));

export function buildSeries(metric: MetricId, period: PeriodId): MetricSeries {
  const raw = SAMPLE[period];
  const keys = period === 'thisMonth' ? MONTH_KEYS : WEEK_KEYS;
  const values = metric === 'heartRate' ? raw.heartRate : metric === 'regularity' ? raw.steps.map(regularity) : raw.steps;
  const points: ChartPoint[] = values.map((value, i) => ({ labelKey: keys[i], value }));
  return { metric, period, points, average: average(values), isDemo: true };
}

/** Index highlighted by default: Wednesday for weeks (as in the design), latest bucket for the month. */
export const defaultSelectedIndex = (period: PeriodId) => (period === 'thisMonth' ? 3 : 4);

export const demoActivityProvider: ActivityProvider = {
  isDemo: true,
  getSeries: buildSeries,
  getToday: () => [
    { id: 'steps', value: 5400, goal: 7000, unit: 'steps' },
    { id: 'calories', value: 312, goal: 450, unit: 'kcal' },
    { id: 'distance', value: 3.9, goal: 5, unit: 'km' },
  ],
  getRecentWorkout: () => ({
    heartRateBpm: 120,
    heartRateTrace: [96, 104, 99, 112, 124, 118, 108, 114, 126, 120, 110, 118],
    calories: 143,
    durationMinutes: 130,
  }),
};

export const activityProvider: ActivityProvider = demoActivityProvider;

export type StatusLevel = 'good' | 'average' | 'low';
export const statusFor = (value: number, goal: number): StatusLevel => {
  const r = goal > 0 ? value / goal : 0;
  return r >= 0.7 ? 'good' : r >= 0.4 ? 'average' : 'low';
};
