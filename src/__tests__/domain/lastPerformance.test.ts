import type { LastPerformance, SessionSet } from '../../domain/models';
import { canUseLast, draftFromLast, listedSets, referenceSet } from '../../domain/lastPerformance';
import { emptySetDraft } from '../../domain/setEntry';

const set = (n: number, weightKg: number, reps: number, isWarmup = false): SessionSet => ({
  id: n, sessionExerciseId: 1, setNumber: n, weightKg, reps, durationSec: null, distanceM: null, rpe: null, isWarmup, isCompleted: true, completedAt: 1000 + n,
});
const last = (...sets: SessionSet[]): LastPerformance => ({ sessionId: 1, localDate: '2026-10-14', sets });

describe('referenceSet / draftFromLast', () => {
  it('uses the last working set, not a trailing warm-up', () => {
    const l = last(set(1, 60, 10), set(2, 80, 6), set(3, 40, 15, true));
    expect(referenceSet(l)?.setNumber).toBe(2);
    expect(draftFromLast('weight_reps', l)).toMatchObject({ weight: '80', reps: '6' });
  });
  it('falls back to a warm-up only when there is nothing else, and to an empty draft for no sets', () => {
    expect(referenceSet(last(set(1, 40, 15, true)))?.setNumber).toBe(1);
    expect(referenceSet(last())).toBeUndefined();
    expect(draftFromLast('weight_reps', last())).toEqual(emptySetDraft());
  });
  it('only fills the fields the exercise asks for', () => {
    expect(draftFromLast('reps_only', last(set(1, 80, 8)))).toEqual({ ...emptySetDraft(), reps: '8' });
  });
});

describe('canUseLast', () => {
  it('only while nothing is logged here and nothing is typed', () => {
    expect(canUseLast(emptySetDraft(), 0)).toBe(true);
    expect(canUseLast({ ...emptySetDraft(), reps: '  ' }, 0)).toBe(true);
    expect(canUseLast({ ...emptySetDraft(), reps: '5' }, 0)).toBe(false);
    expect(canUseLast(emptySetDraft(), 1)).toBe(false);
  });
});

describe('listedSets', () => {
  it('lists at most five and counts the rest', () => {
    const sets = [1, 2, 3, 4, 5, 6, 7].map((n) => set(n, 50, 5));
    expect(listedSets(sets)).toMatchObject({ more: 2 });
    expect(listedSets(sets).shown).toHaveLength(5);
    expect(listedSets(sets.slice(0, 3))).toMatchObject({ more: 0 });
  });
});
