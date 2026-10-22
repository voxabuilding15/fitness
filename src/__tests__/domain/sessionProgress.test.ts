import { extendRest, IDLE, MAX_REST_SEC, remainingSec, startRest, tickRest } from '../../domain/restTimer';
import { exerciseProgress, firstOpenIndex, hasUnsavedInput, sessionProgress } from '../../domain/sessionProgress';
import { emptySetDraft } from '../../domain/setEntry';

const set = (done = true) => ({ id: 1, sessionExerciseId: 1, setNumber: 1, weightKg: null, reps: 5, durationSec: null, distanceM: null, rpe: null, isWarmup: false, isCompleted: done, completedAt: done ? 1 : null });
const plan = (sets: number) => ({ sets, repsMin: 8, repsMax: null, durationSec: null, restSec: 60 });
const ex = (logged: number, planned: number | null, unfinished = 0) => ({
  sets: [...Array(logged).fill(0).map(() => set(true)), ...Array(unfinished).fill(0).map(() => set(false))],
  plan: planned === null ? null : plan(planned),
});

describe('exerciseProgress', () => {
  it('counts logged sets against the plan; done when the plan is reached or passed', () => {
    expect(exerciseProgress(ex(2, 3))).toEqual({ logged: 2, planned: 3, done: false });
    expect(exerciseProgress(ex(3, 3))).toEqual({ logged: 3, planned: 3, done: true });
    expect(exerciseProgress(ex(5, 3))).toEqual({ logged: 5, planned: 3, done: true });
  });
  it('without a plan nothing is ever "done" - there is no target to compare with', () => {
    expect(exerciseProgress(ex(4, null))).toEqual({ logged: 4, planned: null, done: false });
  });
  it('sets that were never completed are not counted', () => {
    expect(exerciseProgress(ex(1, 3, 2)).logged).toBe(1);
  });
});

describe('sessionProgress', () => {
  it('sums sets and counts finished exercises, with a ratio capped at 1', () => {
    expect(sessionProgress([ex(3, 3), ex(1, 3), ex(0, 2)])).toEqual({ loggedSets: 4, plannedSets: 8, exercisesDone: 1, exerciseCount: 3, ratio: 0.5 });
    expect(sessionProgress([ex(6, 3)]).ratio).toBe(1);
  });
  it('without a complete plan there is no total and no ratio (a partial sum would mislead)', () => {
    expect(sessionProgress([ex(2, 3), ex(1, null)])).toMatchObject({ loggedSets: 3, plannedSets: null, ratio: null });
    expect(sessionProgress([ex(1, null)])).toMatchObject({ plannedSets: null, ratio: null });
  });
  it('an empty workout has zeros and no ratio', () => {
    expect(sessionProgress([])).toEqual({ loggedSets: 0, plannedSets: null, exercisesDone: 0, exerciseCount: 0, ratio: null });
  });
});

describe('firstOpenIndex', () => {
  it('is the first unfinished exercise, so a resumed workout opens where you left off', () => {
    expect(firstOpenIndex([ex(3, 3), ex(2, 3), ex(0, 3)])).toBe(1);
    expect(firstOpenIndex([ex(0, 3), ex(0, 3)])).toBe(0);
  });
  it('without a plan, an exercise with nothing logged is the open one', () => {
    expect(firstOpenIndex([ex(2, null), ex(0, null)])).toBe(1);
  });
  it('when everything is done it stays on the last exercise; with none it is -1', () => {
    expect(firstOpenIndex([ex(3, 3), ex(3, 3)])).toBe(1);
    expect(firstOpenIndex([])).toBe(-1);
  });
});

describe('hasUnsavedInput', () => {
  const base = { ...emptySetDraft(), weight: '80', reps: '8' };
  it('is false when nothing was typed, or what was typed equals what the form shows anyway', () => {
    expect(hasUnsavedInput({}, () => base)).toBe(false);
    expect(hasUnsavedInput({ 1: { ...base } }, () => base)).toBe(false);
  });
  it('is true when a value differs from the prefilled one, in any exercise', () => {
    expect(hasUnsavedInput({ 1: { ...base, reps: '9' } }, () => base)).toBe(true);
    expect(hasUnsavedInput({ 1: { ...base }, 2: { ...base, weight: '' } }, () => base)).toBe(true);
  });
  it('is true for a draft of an exercise that no longer exists (nothing to compare with)', () => {
    expect(hasUnsavedInput({ 7: base }, () => null)).toBe(true);
  });
});

describe('extendRest', () => {
  it('adds time to a running timer and its total', () => {
    const t = startRest(1_000, 60, 7);
    const e = extendRest(t, 31_000, 15); // 30 s were left
    expect(remainingSec(e, 31_000)).toBe(45);
    expect(e).toMatchObject({ phase: 'running', exerciseKey: 7, totalSec: 75 });
  });
  it('never takes the time left past 15 minutes', () => {
    const t = startRest(0, MAX_REST_SEC, 1);
    expect(remainingSec(extendRest(t, 0, 15), 0)).toBe(MAX_REST_SEC);
    expect(remainingSec(extendRest(startRest(0, 890, 1), 0, 60), 0)).toBe(MAX_REST_SEC);
  });
  it('does nothing for an idle or finished timer, or for a bad amount', () => {
    expect(extendRest(IDLE, 0, 15)).toBe(IDLE);
    const done = tickRest(startRest(0, 5, 1), 10_000);
    expect(extendRest(done, 10_000, 15)).toBe(done);
    const t = startRest(0, 60, 1);
    for (const bad of [0, -5, 1.5, NaN]) expect(extendRest(t, 0, bad)).toBe(t);
    expect(extendRest(t, NaN, 15)).toBe(t);
  });
});
