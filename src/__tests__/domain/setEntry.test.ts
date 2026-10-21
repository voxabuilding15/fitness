import type { SessionSet } from '../../domain/models';
import { IDLE, MAX_REST_SEC, formatClock, remainingSec, startRest, tickRest } from '../../domain/restTimer';
import { emptySetDraft, fieldsFor, nextDraft, planSet, summarizeSession } from '../../domain/setEntry';

const draft = (p: Partial<ReturnType<typeof emptySetDraft>>) => ({ ...emptySetDraft(), ...p });
const issues = (r: ReturnType<typeof planSet>) => (r.ok ? {} : r.error.kind === 'validation' ? r.error.issues : { kind: r.error.kind });
const set = (p: Partial<SessionSet>): SessionSet => ({
  id: 1, sessionExerciseId: 1, setNumber: 1, weightKg: null, reps: null, durationSec: null, distanceM: null, rpe: null, isWarmup: false, isCompleted: true, completedAt: 1, ...p,
});

describe('planSet', () => {
  it('weight and reps become a completed set in kilograms', () => {
    const r = planSet('weight_reps', draft({ weight: '82,5', reps: '8' }));
    expect(r).toEqual({ ok: true, value: { isCompleted: true, weightKg: 82.5, reps: 8 } });
  });
  it('reps-only needs reps; timed needs seconds; distance work is kilometres and minutes stored as metres and seconds', () => {
    expect(planSet('reps_only', draft({ reps: '12' }))).toEqual({ ok: true, value: { isCompleted: true, reps: 12 } });
    expect(planSet('duration', draft({ durationSec: '45' }))).toEqual({ ok: true, value: { isCompleted: true, durationSec: 45 } });
    expect(planSet('distance_duration', draft({ distanceKm: '5', durationMin: '20.5' }))).toEqual({ ok: true, value: { isCompleted: true, distanceM: 5000, durationSec: 1230 } });
  });
  it('accepts Arabic-Indic digits', () => {
    expect(planSet('reps_only', draft({ reps: '١٢' }))).toEqual({ ok: true, value: { isCompleted: true, reps: 12 } });
  });
  it('requires every field the exercise asks for, and ignores fields it does not', () => {
    expect(issues(planSet('weight_reps', draft({})))).toEqual({ weight: 'validation.required', reps: 'validation.required' });
    expect(planSet('reps_only', draft({ reps: '5', weight: 'abc' })).ok).toBe(true);
  });
  it.each([
    ['weight_reps', { weight: '-1', reps: '5' }, 'weight', 'validation.invalid'],
    ['weight_reps', { weight: '1001', reps: '5' }, 'weight', 'validation.outOfRange'],
    ['weight_reps', { weight: 'NaN', reps: '5' }, 'weight', 'validation.invalid'],
    ['weight_reps', { weight: 'Infinity', reps: '5' }, 'weight', 'validation.invalid'],
    ['weight_reps', { weight: '1e3', reps: '5' }, 'weight', 'validation.invalid'],
    ['weight_reps', { weight: '1,500', reps: '5' }, 'weight', 'validation.ambiguousNumber'],
    ['weight_reps', { weight: '50', reps: '0' }, 'reps', 'validation.outOfRange'],
    ['weight_reps', { weight: '50', reps: '1001' }, 'reps', 'validation.outOfRange'],
    ['weight_reps', { weight: '50', reps: '2.5' }, 'reps', 'validation.invalid'],
    ['reps_only', { reps: '-3' }, 'reps', 'validation.invalid'],
    ['duration', { durationSec: '0' }, 'durationSec', 'validation.outOfRange'],
    ['duration', { durationSec: '86401' }, 'durationSec', 'validation.outOfRange'],
    ['duration', { durationSec: '1.5' }, 'durationSec', 'validation.invalid'],
    ['distance_duration', { distanceKm: '0', durationMin: '10' }, 'distanceKm', 'validation.outOfRange'],
    ['distance_duration', { distanceKm: '1001', durationMin: '10' }, 'distanceKm', 'validation.outOfRange'],
    ['distance_duration', { distanceKm: '5', durationMin: '0' }, 'durationMin', 'validation.outOfRange'],
  ] as const)('rejects %s %j', (tracking, d, field, issue) => {
    expect(issues(planSet(tracking, draft(d)))).toMatchObject({ [field]: issue });
  });
  it('allows a weight of zero (bodyweight) only when typed', () => {
    expect(planSet('weight_reps', draft({ weight: '0', reps: '10' })).ok).toBe(true);
    expect(planSet('weight_reps', draft({ reps: '10' })).ok).toBe(false);
  });
});

describe('fieldsFor / nextDraft', () => {
  it('lists the fields of each tracking type', () => {
    expect(fieldsFor('weight_reps')).toEqual(['weight', 'reps']);
    expect(fieldsFor('distance_duration')).toEqual(['distanceKm', 'durationMin']);
  });
  it('starts empty, then repeats the last logged set only for fields that exercise uses', () => {
    expect(nextDraft('weight_reps', undefined)).toEqual(emptySetDraft());
    expect(nextDraft('weight_reps', set({ weightKg: 82.5, reps: 8 }))).toMatchObject({ weight: '82.5', reps: '8' });
    expect(nextDraft('reps_only', set({ weightKg: 82.5, reps: 8 }))).toMatchObject({ weight: '', reps: '8' });
    expect(nextDraft('distance_duration', set({ distanceM: 5000, durationSec: 1200 }))).toMatchObject({ distanceKm: '5', durationMin: '20' });
    expect(nextDraft('duration', set({ durationSec: 45 }))).toMatchObject({ durationSec: '45' });
  });
});

describe('summarizeSession', () => {
  it('counts only saved completed sets', () => {
    const s = summarizeSession({
      startedAt: 0, endedAt: 31 * 60_000,
      exercises: [
        { id: 1, exerciseId: 1, position: 1, exerciseName: null, plan: null, sets: [set({ weightKg: 80, reps: 5 }), set({ weightKg: 82.5, reps: 3 }), set({ weightKg: 100, reps: 5, isCompleted: false, completedAt: null })] },
        { id: 2, exerciseId: 2, position: 2, exerciseName: null, plan: null, sets: [] },
        { id: 3, exerciseId: 3, position: 3, exerciseName: null, plan: null, sets: [set({ durationSec: 45 })] },
      ],
    });
    expect(s).toEqual({ loggedSets: 3, exercisesWithSets: 2, exerciseCount: 3, volumeKg: 647.5, totalReps: 8, durationMin: 31 });
  });
  it('has no duration while the session is open, and zero sets for an empty one', () => {
    expect(summarizeSession({ startedAt: 0, endedAt: null, exercises: [] })).toEqual({ loggedSets: 0, exercisesWithSets: 0, exerciseCount: 0, volumeKg: 0, totalReps: 0, durationMin: null });
  });
});

describe('rest timer value', () => {
  it('runs until its end time, then is done', () => {
    const t = startRest(1_000, 60, 7);
    expect(t).toEqual({ phase: 'running', endsAt: 61_000, totalSec: 60, exerciseKey: 7 });
    expect(remainingSec(t, 1_000)).toBe(60);
    expect(remainingSec(t, 60_001)).toBe(1);
    expect(tickRest(t, 60_999)).toBe(t);
    expect(tickRest(t, 61_000)).toEqual({ phase: 'done', totalSec: 60, exerciseKey: 7 });
    expect(tickRest(t, 9_999_999)).toMatchObject({ phase: 'done' }); // a late tick (app was in the background) still ends it
    expect(remainingSec(tickRest(t, 61_000), 61_000)).toBe(0);
  });
  it('refuses durations that make no sense', () => {
    for (const bad of [0, -5, 1.5, NaN, Infinity, MAX_REST_SEC + 1]) expect(startRest(1, bad, 1)).toBe(IDLE);
    expect(startRest(NaN, 30, 1)).toBe(IDLE);
    expect(startRest(1, 0, 1).phase).toBe('idle');
    expect(startRest(1, MAX_REST_SEC, 1).phase).toBe('running');
  });
  it('formats minutes and seconds', () => {
    expect([formatClock(0), formatClock(9), formatClock(65), formatClock(600)]).toEqual(['0:00', '0:09', '1:05', '10:00']);
  });
});
