import type { DailyActivity } from '../../domain/models';
import { buildStats, periodWindow, weekStart } from '../../domain/statistics';

const day = (localDate: string, p: Partial<DailyActivity> = {}): DailyActivity => ({ localDate, workouts: 1, sets: 3, reps: 24, volumeKg: 1000, minutes: 40, ...p });

describe('weekStart (weeks begin on Saturday)', () => {
  it.each([
    ['2026-10-17', '2026-10-17'], // Sat
    ['2026-10-18', '2026-10-17'], // Sun
    ['2026-10-21', '2026-10-17'], // Wed
    ['2026-10-23', '2026-10-17'], // Fri
    ['2026-10-24', '2026-10-24'], // next Sat
    ['2026-01-01', '2025-12-27'], // across a year
    ['2024-03-01', '2024-02-24'], // across a leap February
  ])('%s -> %s', (date, expected) => expect(weekStart(date)).toBe(expected));
});

describe('periodWindow', () => {
  it('this week: seven single-day buckets from Saturday, today in its own bucket', () => {
    const w = periodWindow('thisWeek', '2026-10-21');
    expect([w.from, w.to]).toEqual(['2026-10-17', '2026-10-23']);
    expect(w.buckets.map((b) => b.labelKey)).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']);
    expect(w.buckets.every((b) => b.from === b.to)).toBe(true);
    expect(w.todayIndex).toBe(4);
  });
  it('last week: the seven days before, and today is not inside it (the last bucket is selected)', () => {
    const w = periodWindow('lastWeek', '2026-10-21');
    expect([w.from, w.to]).toEqual(['2026-10-10', '2026-10-16']);
    expect(w.todayIndex).toBe(6);
  });
  it.each([
    ['2026-10-21', '2026-10-31'], ['2026-02-10', '2026-02-28'], ['2024-02-10', '2024-02-29'], ['2026-04-30', '2026-04-30'], ['2026-12-05', '2026-12-31'],
  ])('this month (%s): four buckets that cover the month exactly', (today, last) => {
    const w = periodWindow('thisMonth', today);
    expect(w.buckets.map((b) => b.labelKey)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(w.from).toBe(`${today.slice(0, 7)}-01`);
    expect(w.to).toBe(last);
    expect(w.buckets[0].to).toBe(`${today.slice(0, 7)}-07`);
    expect(w.buckets[3].from).toBe(`${today.slice(0, 7)}-22`);
    // no gap and no overlap between buckets
    for (let i = 1; i < 4; i++) expect(new Date(w.buckets[i].from).getTime() - new Date(w.buckets[i - 1].to).getTime()).toBe(86_400_000);
    expect(today >= w.buckets[w.todayIndex].from && today <= w.buckets[w.todayIndex].to).toBe(true);
  });
});

describe('buildStats', () => {
  const w = periodWindow('thisWeek', '2026-10-21');
  const rows = [day('2026-10-17', { workouts: 1, volumeKg: 500.5, minutes: 30 }), day('2026-10-21', { workouts: 2, volumeKg: 1200, minutes: 75 }), day('2026-10-30')];
  it('sums per bucket, fills empty days with zero, and ignores rows outside the period', () => {
    const s = buildStats(w, rows, 'workouts');
    expect(s.points.map((p) => p.value)).toEqual([1, 0, 0, 0, 2, 0, 0]);
    expect(s.total).toBe(3);
    expect(s.workouts).toBe(3);
  });
  it('volume and minutes use their own field', () => {
    expect(buildStats(w, rows, 'volume').total).toBe(1700.5);
    expect(buildStats(w, rows, 'minutes').points[4].value).toBe(75);
  });
  it('with no rows everything is zero (the screen says nothing was finished, it does not invent values)', () => {
    const s = buildStats(w, [], 'volume');
    expect(s.points.every((p) => p.value === 0)).toBe(true);
    expect(s).toMatchObject({ total: 0, workouts: 0 });
  });
  it('month buckets add the days they contain', () => {
    const m = periodWindow('thisMonth', '2026-10-21');
    const s = buildStats(m, [day('2026-10-01'), day('2026-10-07'), day('2026-10-08'), day('2026-10-22'), day('2026-10-31')], 'workouts');
    expect(s.points.map((p) => p.value)).toEqual([2, 1, 0, 2]);
  });
});
