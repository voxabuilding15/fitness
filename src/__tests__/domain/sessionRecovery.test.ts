import type { WorkoutSessionDetail } from '../../domain/models';
import { recoveryOf, shouldShowRecovery, splitMinutes } from '../../domain/sessionRecovery';

const set = (id: number, completedAt: number | null, isCompleted = true) => ({
  id, sessionExerciseId: 1, setNumber: id, weightKg: null, reps: 5, durationSec: null, distanceM: null, rpe: null, isWarmup: false, isCompleted, completedAt,
});
const session = (sets: ReturnType<typeof set>[], status: WorkoutSessionDetail['status'] = 'in_progress', startedAt = 1_000_000) =>
  ({ id: 1, status, startedAt, exercises: [{ id: 1, sets }] }) as unknown as WorkoutSessionDetail;

describe('recoveryOf', () => {
  it('counts logged sets and takes the newest completion time from the saved sets', () => {
    const r = recoveryOf(session([set(1, 2_000_000), set(2, 3_000_000), set(3, null, false)]), 3_000_000 + 125_000);
    expect(r).toEqual({ loggedSets: 2, lastLoggedAt: 3_000_000, minutesSinceLastSet: 2, minutesSinceStart: 35 });
  });
  it('has no last-set time without logged sets', () => {
    const r = recoveryOf(session([set(1, null, false)]), 9_000_000);
    expect(r).toMatchObject({ loggedSets: 0, lastLoggedAt: null, minutesSinceLastSet: null });
  });
  it('never invents a duration when the clock reads earlier than the record or is not a number', () => {
    expect(recoveryOf(session([set(1, 5_000_000)]), 4_000_000)).toMatchObject({ minutesSinceLastSet: null });
    expect(recoveryOf(session([set(1, 5_000_000)], 'in_progress', 6_000_000), 5_500_000)).toMatchObject({ minutesSinceStart: null });
    expect(recoveryOf(session([set(1, 5_000_000)]), Number.NaN)).toMatchObject({ minutesSinceLastSet: null, minutesSinceStart: null });
  });
  it('rounds down to whole minutes', () => {
    expect(recoveryOf(session([set(1, 0)]), 59_999).minutesSinceLastSet).toBe(0);
    expect(recoveryOf(session([set(1, 0)]), 60_000).minutesSinceLastSet).toBe(1);
  });
});

describe('shouldShowRecovery', () => {
  it('only for an in-progress workout that has logged sets', () => {
    const logged = session([set(1, 2_000_000)]);
    expect(shouldShowRecovery(logged, recoveryOf(logged, 3_000_000))).toBe(true);
    const empty = session([]);
    expect(shouldShowRecovery(empty, recoveryOf(empty, 3_000_000))).toBe(false);
    for (const status of ['completed', 'discarded'] as const) {
      const done = session([set(1, 2_000_000)], status);
      expect(shouldShowRecovery(done, recoveryOf(done, 3_000_000))).toBe(false);
    }
  });
});

describe('splitMinutes', () => {
  it('splits hours and minutes', () => {
    expect(splitMinutes(0)).toEqual({ h: 0, m: 0 });
    expect(splitMinutes(59)).toEqual({ h: 0, m: 59 });
    expect(splitMinutes(65)).toEqual({ h: 1, m: 5 });
  });
});
