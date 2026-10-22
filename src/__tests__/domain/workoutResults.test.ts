import type { SessionExercise, SessionSet } from '../../domain/models';
import { bestSet, exerciseResults, notDone } from '../../domain/workoutResults';

const set = (n: number, o: Partial<SessionSet> = {}): SessionSet => ({
  id: n, sessionExerciseId: 1, setNumber: n, weightKg: null, reps: null, durationSec: null, distanceM: null, rpe: null, isWarmup: false, isCompleted: true, completedAt: 1000 + n, ...o,
});

describe('bestSet', () => {
  it('weight x reps: the heaviest set, more reps break a tie, the earliest wins an exact tie', () => {
    expect(bestSet('weight_reps', [set(1, { weightKg: 60, reps: 10 }), set(2, { weightKg: 80, reps: 5 }), set(3, { weightKg: 80, reps: 6 }), set(4, { weightKg: 80, reps: 6 })])?.setNumber).toBe(3);
  });
  it('never picks a warm-up or an unfinished set, and is null when nothing qualifies', () => {
    expect(bestSet('weight_reps', [set(1, { weightKg: 100, reps: 3, isWarmup: true }), set(2, { weightKg: 60, reps: 8 }), set(3, { weightKg: 200, reps: 1, isCompleted: false, completedAt: null })])?.setNumber).toBe(2);
    expect(bestSet('weight_reps', [set(1, { weightKg: 40, reps: 10, isWarmup: true })])).toBeNull();
    expect(bestSet('weight_reps', [])).toBeNull();
    expect(bestSet('weight_reps', [set(1, { reps: 8 })])).toBeNull(); // no weight recorded: nothing to rank
  });
  it('reps only, duration and distance rank by their own measure', () => {
    expect(bestSet('reps_only', [set(1, { reps: 10 }), set(2, { reps: 15 })])?.setNumber).toBe(2);
    expect(bestSet('duration', [set(1, { durationSec: 30 }), set(2, { durationSec: 60 }), set(3, { durationSec: 45 })])?.setNumber).toBe(2);
    expect(bestSet('distance_duration', [set(1, { distanceM: 5000, durationSec: 1500 }), set(2, { distanceM: 5000, durationSec: 1800 }), set(3, { distanceM: 3000, durationSec: 2000 })])?.setNumber).toBe(2);
  });
});

describe('exerciseResults / notDone', () => {
  it('counts logged sets per exercise and flags exercises with none', () => {
    const ex = (id: number, position: number, sets: SessionSet[]) => ({ id, exerciseId: id, position, exerciseName: null, plan: null, sets }) as SessionExercise;
    const list = [ex(1, 1, [set(1, { weightKg: 50, reps: 5 })]), ex(2, 2, []), ex(3, 3, [set(1, { isCompleted: false, completedAt: null, reps: 5 })])];
    const r = exerciseResults(list, () => 'weight_reps');
    expect(r.map((x) => x.loggedSets)).toEqual([1, 0, 0]);
    expect(r[0].best?.weightKg).toBe(50);
    expect(notDone(r)).toEqual([2, 3]);
  });
});
