export type MetricId = 'steps' | 'heartRate' | 'regularity';
export type PeriodId = 'thisWeek' | 'lastWeek' | 'thisMonth';

export interface ChartPoint {
  /** Translation key suffix for the axis label, e.g. "sat" or "w1" */
  labelKey: string;
  value: number;
}

export interface MetricSeries {
  metric: MetricId;
  period: PeriodId;
  points: ChartPoint[];
  average: number;
  /** true while values come from bundled sample data rather than a device/health source */
  isDemo: boolean;
}

export interface TodayStat {
  id: 'steps' | 'calories' | 'distance';
  value: number;
  goal: number;
  unit: 'steps' | 'kcal' | 'km';
}

export interface RecentWorkoutSummary {
  heartRateBpm: number;
  heartRateTrace: number[];
  calories: number;
  durationMinutes: number;
}
