import type { DailyActivity } from '../../domain/models';
import { buildHomeSummary, homeWindow } from '../../domain/homeSummary';

const day = (localDate: string, p: Partial<DailyActivity> = {}): DailyActivity => ({ localDate, workouts: 1, sets: 3, reps: 24, volumeKg: 1000, minutes: 40, ...p });

describe('homeWindow / buildHomeSummary (Wednesday 2026-10-21)', () => {
  it('covers this week so far, from Saturday to today', () => {
    expect(homeWindow('2026-10-21')).toEqual({ from: '2026-10-17', to: '2026-10-21' });
    expect(homeWindow('2026-10-17')).toEqual({ from: '2026-10-17', to: '2026-10-17' }); // on a Saturday it is just today
  });
  it('counts this week\'s workouts and takes today\'s minutes and weight from today only', () => {
    const s = buildHomeSummary('2026-10-21', [day('2026-10-17'), day('2026-10-20', { workouts: 2 }), day('2026-10-21', { minutes: 25, volumeKg: 950.5 })], 4);
    expect(s).toEqual({ weekWorkouts: 4, todayMinutes: 25, todayVolumeKg: 950.5, weeklyTarget: 4, progress: 1 });
  });
  it('ignores days outside the window and has zeros, not placeholders, for an empty week', () => {
    expect(buildHomeSummary('2026-10-21', [day('2026-10-16'), day('2026-10-22')], null)).toEqual({ weekWorkouts: 0, todayMinutes: 0, todayVolumeKg: 0, weeklyTarget: null, progress: null });
  });
  it('progress is capped at 1, and a target of zero counts as no target', () => {
    expect(buildHomeSummary('2026-10-21', [day('2026-10-21', { workouts: 5 })], 3).progress).toBe(1);
    expect(buildHomeSummary('2026-10-21', [day('2026-10-21')], 0)).toMatchObject({ weeklyTarget: null, progress: null });
  });
});
