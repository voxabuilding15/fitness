import { CALORIE_CONFLICT_KEY } from '../../domain/calculators';
import {
  applyEstimate, calculateEstimate, draftFromSaved, fieldBadges, freshness, mergePrefill, newDraft, parseNumberText, saveSource, setInputs, setTarget, setWeeklyTarget,
  toGoalsInput, visibleHints, WEEKLY_TARGET_CHOICES, type GoalsDraft,
} from '../../domain/goalsDraft';
import type { Goals, Profile } from '../../domain/models';
import { goalsInput } from '../../domain/schemas';

const TODAY = '2026-10-21';
const issuesOf = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { issues: Record<string, string> }).issues);
const val = <T,>(r: { ok: boolean; value?: T; error?: unknown }): T => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value as T;
};
const filled = (patch: Partial<GoalsDraft> = {}): GoalsDraft => ({
  ...newDraft(), sex: 'male', age: '30', heightCm: '180', weightKg: '80', activityLevel: 'moderate', ...patch,
});
const savedGoals: Goals = {
  goalType: 'lose_fat', targetWeightKg: 75, kcalTarget: 2200, proteinG: 160, carbsG: 250, fatG: 60, waterMlTarget: 2800, weeklyWorkoutTarget: 4, source: 'manual', updatedAt: 1,
};
const savedProfile: Profile = { displayName: 'A', location: null, sex: 'female', ageYears: 28, ageSetOn: '2026-10-01', heightCm: 165, activityLevel: 'light', undatedWeightKg: null, updatedAt: 1 };

describe('starting state: nothing is invented', () => {
  it('a new draft is balanced nutrition (maintain) with every body field, the activity level and the weekly target unset', () => {
    expect(newDraft()).toEqual({
      sex: null, age: '', heightCm: '', weightKg: '', activityLevel: null, goalType: 'maintain', adjustmentPct: '',
      weeklyWorkoutTarget: null, kcal: '', proteinG: '', carbsG: '', fatG: '', water: '', estimated: {}, edited: {}, stale: false, estimateInfo: null, touched: {}, targetWeightKg: null, savedHints: { age: null, weightKg: null },
    });
  });
  it('with no saved data the draft stays empty, and with nothing known no estimate can be made', () => {
    const d = draftFromSaved({ goals: null, profile: null, latestWeight: null, today: TODAY });
    expect(d).toEqual(newDraft());
    expect(issuesOf(calculateEstimate(d))).toEqual({
      sex: 'validation.required', age: 'validation.required', heightCm: 'validation.required', weightKg: 'validation.required', activityLevel: 'validation.required',
    });
  });
  it('saved goals, the database profile and the latest weight prefill the form (read only)', () => {
    const d = draftFromSaved({ goals: savedGoals, profile: savedProfile, latestWeight: { weightKg: 70.5, localDate: TODAY }, today: TODAY });
    expect(d).toMatchObject({
      sex: 'female', age: '28', heightCm: '165', weightKg: '70.5', activityLevel: 'light', goalType: 'lose_fat', adjustmentPct: '20',
      weeklyWorkoutTarget: 4, kcal: '2200', proteinG: '160', carbsG: '250', fatG: '60', water: '2800', targetWeightKg: 75, estimated: {},
    });
  });
  it('goals saved as calculated are still labelled as estimates when reopened', () => {
    const d = draftFromSaved({ goals: { ...savedGoals, source: 'calculated' }, profile: null, latestWeight: null, today: TODAY });
    expect(d.estimated).toEqual({ kcal: true, proteinG: true, carbsG: true, fatG: true, water: true });
  });
  it('a target saved without a value is not labelled as an estimate', () => {
    const d = draftFromSaved({ goals: { ...savedGoals, source: 'calculated', carbsG: null, fatG: null }, profile: null, latestWeight: null, today: TODAY });
    expect(d.estimated).toEqual({ kcal: true, proteinG: true, water: true });
    expect(d.carbsG).toBe('');
  });
});

describe('calculating', () => {
  it('maintain: the same numbers as the calculator (2759 kcal, 128 / 389 / 77 g, 2800 ml) and nothing is applied until asked', () => {
    const d = filled();
    const e = val(calculateEstimate(d));
    expect(e).toMatchObject({ kcalTarget: 2759, proteinG: 128, carbsG: 389, fatG: 77, waterMlTarget: 2800, isEstimate: true });
    expect(d.kcal).toBe('');
  });
  it('applying the estimate fills all five targets and labels every one an estimate', () => {
    const d = applyEstimate(filled(), val(calculateEstimate(filled())));
    expect(d).toMatchObject({ kcal: '2759', proteinG: '128', carbsG: '389', fatG: '77', water: '2800', stale: false });
    expect(d.estimated).toEqual({ kcal: true, proteinG: true, carbsG: true, fatG: true, water: true });
  });
  it('choosing lose fat starts at the 20 % deficit and build muscle at the 10 % surplus; the user can change both', () => {
    const lose = setInputs(filled(), { goalType: 'lose_fat' });
    expect(lose.adjustmentPct).toBe('20');
    expect(val(calculateEstimate(lose)).kcalTarget).toBe(2207);
    expect(val(calculateEstimate(setInputs(lose, { adjustmentPct: '10' }))).kcalTarget).toBe(2483);
    const build = setInputs(filled(), { goalType: 'build_muscle' });
    expect(build.adjustmentPct).toBe('10');
    expect(val(calculateEstimate(build)).kcalTarget).toBe(3035);
    expect(val(calculateEstimate(setInputs(build, { adjustmentPct: '15' }))).kcalTarget).toBe(3173); // 2759 x 1.15 = 3172.85
    expect(setInputs(lose, { goalType: 'maintain' }).adjustmentPct).toBe('');
  });
  it('an emptied adjustment is reported, not replaced by the default; an out-of-range one is outOfRange', () => {
    const lose = setInputs(filled(), { goalType: 'lose_fat' });
    expect(issuesOf(calculateEstimate({ ...lose, adjustmentPct: '' }))).toEqual({ adjustmentPct: 'validation.required' });
    expect(issuesOf(calculateEstimate({ ...lose, adjustmentPct: '55' }))).toEqual({ adjustmentPct: 'validation.outOfRange' });
    expect(issuesOf(calculateEstimate({ ...lose, adjustmentPct: 'abc' }))).toEqual({ adjustmentPct: 'validation.invalid' });
  });
  it('reports each missing or bad field by its own name', () => {
    expect(issuesOf(calculateEstimate(filled({ sex: null })))).toEqual({ sex: 'validation.required' });
    expect(issuesOf(calculateEstimate(filled({ age: '' })))).toEqual({ age: 'validation.required' });
    expect(issuesOf(calculateEstimate(filled({ activityLevel: null })))).toEqual({ activityLevel: 'validation.required' });
    expect(issuesOf(calculateEstimate(filled({ age: '9' })))).toEqual({ age: 'validation.outOfRange' });
    expect(issuesOf(calculateEstimate(filled({ age: '30.5' })))).toEqual({ age: 'validation.outOfRange' });
    expect(issuesOf(calculateEstimate(filled({ heightCm: 'tall' })))).toEqual({ heightCm: 'validation.invalid' });
    expect(issuesOf(calculateEstimate(filled({ weightKg: '19' })))).toEqual({ weightKg: 'validation.outOfRange' });
    expect(issuesOf(calculateEstimate(filled({ weightKg: '-80' })))).toEqual({ weightKg: 'validation.invalid' });
    expect(issuesOf(calculateEstimate(filled({ weightKg: '  ' })))).toEqual({ weightKg: 'validation.required' });
  });
  it('several problems are all reported together', () => {
    expect(issuesOf(calculateEstimate(filled({ sex: null, age: '', heightCm: 'x', weightKg: '1' })))).toEqual({
      sex: 'validation.required', age: 'validation.required', heightCm: 'validation.invalid', weightKg: 'validation.outOfRange',
    });
  });
});

describe('number text in the form', () => {
  it.each([['80', 80], ['80.5', 80.5], ['80,5', 80.5], ['  80  ', 80], ['٨٠', 80], ['٨٠٫٥', 80.5], ['۸۰', 80], ['0', 0], ['1,500.5', 1500.5]])('parses %j as %j', (raw, n) =>
    expect(parseNumberText(raw)).toBe(n));
  it.each(['', ' ', 'abc', '8 0', '80kg', '-5', '+5', '1e3', '.5', '5.', 'NaN', 'Infinity', '٨٠x', '1,500', '1.500'])('rejects %j', (raw) =>
    expect(parseNumberText(raw)).toBeNull());
});

describe('R1 in the form: ambiguous numbers get their own message and are never turned into a different value', () => {
  it('an ambiguous weight is reported, not read as 1.5 kg or 1500 kg', () => {
    expect(issuesOf(calculateEstimate(filled({ weightKg: '1,500' })))).toEqual({ weightKg: 'validation.ambiguousNumber' });
    expect(issuesOf(calculateEstimate(filled({ heightCm: '1.500' })))).toEqual({ heightCm: 'validation.ambiguousNumber' });
    expect(issuesOf(calculateEstimate(filled({ age: '2,500' })))).toEqual({ age: 'validation.ambiguousNumber' });
  });
  it('an unambiguous grouped value is read correctly (it then fails the range check, not the parser)', () => {
    expect(issuesOf(calculateEstimate(filled({ weightKg: '1,500.5' })))).toEqual({ weightKg: 'validation.outOfRange' });
  });
  it('an ambiguous adjustment percentage is reported', () => {
    const lose = setInputs(filled(), { goalType: 'lose_fat' });
    expect(issuesOf(calculateEstimate({ ...lose, adjustmentPct: '1,500' }))).toEqual({ adjustmentPct: 'validation.ambiguousNumber' });
  });
  it('saving: ambiguous calories, macros and water are reported against their own fields and nothing is saved', () => {
    const d = setWeeklyTarget({ ...newDraft(), kcal: '2,500', proteinG: '1.500', carbsG: '300', fatG: '60', water: '2,500' }, 3);
    expect(issuesOf(toGoalsInput(d))).toEqual({ kcal: 'validation.ambiguousNumber', proteinG: 'validation.ambiguousNumber', water: 'validation.ambiguousNumber' });
  });
  it('"2,500" calories written with a clear separator is accepted: 2500 or 2,500.0', () => {
    expect(val(toGoalsInput(setWeeklyTarget({ ...newDraft(), kcal: '2500', water: '2,500.0' }, 3)))).toMatchObject({ kcalTarget: 2500, waterMlTarget: 2500 });
  });
  it('a decimal comma still works for decimals: protein "150,5"', () => {
    expect(val(toGoalsInput(setWeeklyTarget({ ...newDraft(), proteinG: '150,5', water: '2500' }, 3)))).toMatchObject({ proteinG: 150.5 });
  });
});

describe('R2: stored age and weight are used only while they are fresh', () => {
  const profile = (over: Partial<Profile> = {}): Profile => ({ ...savedProfile, ageYears: 28, ageSetOn: '2026-10-01', ...over });
  const from = (p: Profile | null, w: { weightKg: number; localDate: string } | null, today = TODAY) =>
    draftFromSaved({ goals: null, profile: p, latestWeight: w, today });

  it('a recent age and weight prefill the form and leave no hint', () => {
    const d = from(profile(), { weightKg: 70.5, localDate: '2026-10-20' });
    expect(d).toMatchObject({ age: '28', weightKg: '70.5', savedHints: { age: null, weightKg: null } });
  });
  it('the age boundary: exactly 365 days old is fresh, 366 is not', () => {
    expect(from(profile({ ageSetOn: '2025-10-21' }), null).age).toBe('28');
    const old = from(profile({ ageSetOn: '2025-10-20' }), null);
    expect(old.age).toBe('');
    expect(old.savedHints.age).toEqual({ value: '28', on: '2025-10-20', reason: 'old' });
  });
  it('the weight boundary: 30 days old is fresh, 31 is not', () => {
    expect(from(null, { weightKg: 70, localDate: '2026-09-21' }).weightKg).toBe('70');
    const old = from(null, { weightKg: 70, localDate: '2026-09-20' });
    expect(old.weightKg).toBe('');
    expect(old.savedHints.weightKg).toEqual({ value: '70', on: '2026-09-20', reason: 'old' });
  });
  it('an age with no entry date cannot be trusted as current', () => {
    const d = from(profile({ ageSetOn: null }), null);
    expect(d.age).toBe('');
    expect(d.savedHints.age).toEqual({ value: '28', on: null, reason: 'unknown_date' });
  });
  it('an unreadable date is treated as unknown, a date in the future as future', () => {
    expect(from(profile({ ageSetOn: '2026-02-30' }), null).savedHints.age?.reason).toBe('unknown_date');
    expect(from(profile({ ageSetOn: '2026-10-22' }), null).savedHints.age?.reason).toBe('future_date');
    expect(from(null, { weightKg: 70, localDate: '2026-10-22' }).savedHints.weightKg?.reason).toBe('future_date');
    expect(from(null, { weightKg: 70, localDate: 'garbage' }).savedHints.weightKg?.reason).toBe('unknown_date');
    expect(draftFromSaved({ goals: null, profile: profile(), latestWeight: null, today: 'bad' }).savedHints.age?.reason).toBe('unknown_date');
  });
  it('no stored age (null) is simply empty, with no hint; height and sex are not date-limited', () => {
    const d = from(profile({ ageYears: null, ageSetOn: null }), null);
    expect(d).toMatchObject({ age: '', heightCm: '165', sex: 'female', savedHints: { age: null, weightKg: null } });
  });
  it('a stale age is never silently used: calculating reports it as missing', () => {
    const d = setInputs(from(profile({ ageSetOn: '2024-01-01' }), { weightKg: 70, localDate: '2026-10-20' }), { sex: 'female', heightCm: '165', activityLevel: 'light' });
    expect(issuesOf(calculateEstimate(d))).toEqual({ age: 'validation.required' });
  });
  it('visibleHints shows a note until the person types into that field', () => {
    const d = from(profile({ ageSetOn: '2024-01-01' }), { weightKg: 70, localDate: '2026-01-01' });
    expect(visibleHints(d).age?.reason).toBe('old');
    expect(visibleHints(d).weightKg?.reason).toBe('old');
    const typed = setInputs(d, { age: '30' });
    expect(visibleHints(typed).age).toBeNull();
    expect(visibleHints(typed).weightKg?.reason).toBe('old');
  });
  it('merging a later database load keeps typed values and brings the notes for untouched fields', () => {
    const typed = setInputs(newDraft(), { age: '30' });
    const loaded = from(profile({ ageSetOn: '2024-01-01' }), { weightKg: 70, localDate: '2026-01-01' });
    const m = mergePrefill(typed, loaded);
    expect(m.age).toBe('30');
    expect(visibleHints(m)).toMatchObject({ age: null, weightKg: { reason: 'old' } });
  });
  it('freshness itself', () => {
    expect(freshness('2026-10-21', TODAY, 0)).toBe('fresh');
    expect(freshness('2026-10-20', TODAY, 0)).toBe('old');
    expect(freshness('2026-10-22', TODAY, 365)).toBe('future_date');
    expect(freshness(null, TODAY, 365)).toBe('unknown_date');
    expect(freshness('2024-02-29', '2025-02-28', 365)).toBe('fresh'); // leap day: 365 days
    expect(freshness('2024-02-29', '2025-03-01', 365)).toBe('old'); // 366 days
  });
});

describe('R4: the weekly target range is the whole stored range', () => {
  it('offers every value from 0 to 14, and nothing else', () => {
    expect(WEEKLY_TARGET_CHOICES).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
  it('every offered value is accepted by the goals schema, and the next one is not (the two cannot drift apart)', () => {
    for (const n of WEEKLY_TARGET_CHOICES) expect(goalsInput.safeParse({ goalType: 'maintain', waterMlTarget: 2000, weeklyWorkoutTarget: n, source: 'manual' }).success).toBe(true);
    expect(goalsInput.safeParse({ goalType: 'maintain', waterMlTarget: 2000, weeklyWorkoutTarget: 15, source: 'manual' }).success).toBe(false);
    expect(goalsInput.safeParse({ goalType: 'maintain', waterMlTarget: 2000, weeklyWorkoutTarget: -1, source: 'manual' }).success).toBe(false);
  });
  it('a stored value above 7 is kept when the goals are reopened and saved unchanged', () => {
    for (const n of [8, 10, 14]) {
      const d = draftFromSaved({ goals: { ...savedGoals, weeklyWorkoutTarget: n }, profile: null, latestWeight: null, today: TODAY });
      expect(d.weeklyWorkoutTarget).toBe(n);
      expect(WEEKLY_TARGET_CHOICES).toContain(d.weeklyWorkoutTarget);
      expect(val(toGoalsInput(d)).weeklyWorkoutTarget).toBe(n);
    }
  });
});

describe('editing keeps the labels honest', () => {
  const calc = () => applyEstimate(filled(), val(calculateEstimate(filled())));
  it('editing a target removes only its estimate label', () => {
    const d = setTarget(calc(), 'kcal', '2500');
    expect(d.kcal).toBe('2500');
    expect(d.estimated).toEqual({ proteinG: true, carbsG: true, fatG: true, water: true });
  });
  it('changing an input after calculating marks the estimate stale; it stays visible', () => {
    const d = setInputs(calc(), { weightKg: '90' });
    expect(d.stale).toBe(true);
    expect(d.kcal).toBe('2759');
    expect(setInputs(filled(), { weightKg: '90' }).stale).toBe(false); // nothing was calculated yet
    expect(applyEstimate(d, val(calculateEstimate(d))).stale).toBe(false);
  });
});

describe('saving', () => {
  const ready = () => setWeeklyTarget(applyEstimate(filled(), val(calculateEstimate(filled()))), 3);
  it('an untouched estimate is saved as source "calculated"', () => {
    expect(val(toGoalsInput(ready()))).toEqual({
      goalType: 'maintain', kcalTarget: 2759, proteinG: 128, carbsG: 389, fatG: 77, waterMlTarget: 2800, weeklyWorkoutTarget: 3, source: 'calculated',
    });
  });
  it('any edited target makes the goals "manual"', () => {
    expect(val(toGoalsInput(setTarget(ready(), 'proteinG', '140'))).source).toBe('manual');
    expect(val(toGoalsInput(setTarget(ready(), 'proteinG', '140'))).proteinG).toBe(140);
  });
  it('the weekly workout target is chosen by the user: without it nothing can be saved', () => {
    expect(issuesOf(toGoalsInput({ ...ready(), weeklyWorkoutTarget: null }))).toEqual({ weeklyWorkoutTarget: 'validation.required' });
    expect(val(toGoalsInput(setWeeklyTarget(ready(), 0))).weeklyWorkoutTarget).toBe(0);
  });
  it('water is required; macros and calories may be left blank (no target)', () => {
    const manual = setWeeklyTarget({ ...newDraft(), water: '2500' }, 5);
    expect(val(toGoalsInput(manual))).toEqual({ goalType: 'maintain', waterMlTarget: 2500, weeklyWorkoutTarget: 5, source: 'manual' });
    expect(issuesOf(toGoalsInput(setWeeklyTarget(newDraft(), 5)))).toEqual({ water: 'validation.required' });
  });
  it('invalid values are reported against the form field names', () => {
    const bad = { ...ready(), kcal: '700', proteinG: 'lots', carbsG: '9999', fatG: '-1', water: '100' };
    expect(issuesOf(toGoalsInput(bad))).toEqual({ proteinG: 'validation.invalid', fatG: 'validation.invalid' });
    expect(issuesOf(toGoalsInput({ ...ready(), kcal: '700', carbsG: '9999', water: '100' }))).toEqual({
      kcal: 'validation.outOfRange', carbsG: 'validation.outOfRange', water: 'validation.outOfRange',
    });
    expect(issuesOf(toGoalsInput({ ...ready(), kcal: '2200.5' }))).toEqual({ kcal: 'validation.invalid' }); // calories are whole numbers
  });
  it('a target weight set elsewhere is carried through, never erased', () => {
    const d = draftFromSaved({ goals: savedGoals, profile: null, latestWeight: null, today: TODAY });
    expect(val(toGoalsInput(d))).toMatchObject({ targetWeightKg: 75, goalType: 'lose_fat', weeklyWorkoutTarget: 4, source: 'manual' });
  });
  it('reopening saved goals and saving unchanged gives back the same values', () => {
    const d = draftFromSaved({ goals: { ...savedGoals, source: 'calculated' }, profile: null, latestWeight: null, today: TODAY });
    expect(val(toGoalsInput(d))).toEqual({
      goalType: 'lose_fat', targetWeightKg: 75, kcalTarget: 2200, proteinG: 160, carbsG: 250, fatG: 60, waterMlTarget: 2800, weeklyWorkoutTarget: 4, source: 'calculated',
    });
  });
});

describe('M2: a stale estimate is never saved as "calculated"', () => {
  const calc = (d: GoalsDraft = filled()) => applyEstimate(d, val(calculateEstimate(d)));
  const ready = (d: GoalsDraft) => setWeeklyTarget(d, 3);

  it('a fresh, untouched calculation is "calculated"', () => {
    expect(saveSource(calc())).toBe('calculated');
    expect(val(toGoalsInput(ready(calc()))).source).toBe('calculated');
  });
  it('changing the goal type after calculating makes the same numbers "manual" (and they are not relabelled by the new goal)', () => {
    const d = setInputs(calc(), { goalType: 'lose_fat' });
    expect(d.stale).toBe(true);
    expect(saveSource(d)).toBe('manual');
    expect(val(toGoalsInput(ready(d)))).toMatchObject({ goalType: 'lose_fat', kcalTarget: 2759, source: 'manual' });
  });
  it('changing any input after calculating (weight, age, height, sex, activity, adjustment) makes the result "manual"', () => {
    for (const patch of [{ weightKg: '120' }, { age: '31' }, { heightCm: '170' }, { sex: 'female' as const }, { activityLevel: 'light' as const }]) {
      expect(val(toGoalsInput(ready(setInputs(calc(), patch)))).source).toBe('manual');
    }
    const lose = calc(setInputs(filled(), { goalType: 'lose_fat' }));
    expect(val(toGoalsInput(ready(setInputs(lose, { adjustmentPct: '10' })))).source).toBe('manual');
  });
  it('recalculating makes it "calculated" again', () => {
    const stale = setInputs(calc(), { weightKg: '90' });
    const again = calc(stale);
    expect(again.stale).toBe(false);
    expect(val(toGoalsInput(ready(again))).source).toBe('calculated');
    expect(val(toGoalsInput(ready(again))).kcalTarget).toBe(val(calculateEstimate(again)).kcalTarget);
  });
  it('stale estimates are labelled "outdated", not "estimate"', () => {
    const d = setInputs(calc(), { weightKg: '90' });
    expect(fieldBadges(d, 'kcal')).toEqual(['outdated']);
    expect(fieldBadges(calc(), 'kcal')).toEqual(['estimate']);
  });
  it('inputs changed before anything was calculated do not mark anything stale', () => {
    expect(setInputs(filled(), { weightKg: '90' }).stale).toBe(false);
  });
});

describe('M3: database prefill only fills untouched fields', () => {
  const loaded = () => draftFromSaved({ goals: savedGoals, profile: savedProfile, latestWeight: { weightKg: 60, localDate: TODAY }, today: TODAY });

  it('merging into a pristine draft equals the plain prefill', () => {
    expect(mergePrefill(newDraft(), loaded())).toEqual(loaded());
  });
  it('typed details survive; untouched fields are filled from the database', () => {
    let d = setInputs(newDraft(), { age: '41', sex: 'male' });
    d = setTarget(d, 'water', '3000');
    const m = mergePrefill(d, loaded());
    expect(m).toMatchObject({ age: '41', sex: 'male', water: '3000' }); // user's
    expect(m).toMatchObject({ heightCm: '165', weightKg: '60', activityLevel: 'light', kcal: '2200', proteinG: '160', weeklyWorkoutTarget: 4 }); // database
    expect(m.goalType).toBe('lose_fat');
  });
  it('a calculated estimate typed in before the database came back is kept in full', () => {
    const typed = setInputs(newDraft(), { sex: 'male', age: '30', heightCm: '180', weightKg: '80', activityLevel: 'moderate' }); // as typed on screen
    const d = setWeeklyTarget(applyEstimate(typed, val(calculateEstimate(typed))), 2);
    const m = mergePrefill(d, loaded());
    expect(m).toMatchObject({ age: '30', heightCm: '180', weightKg: '80', sex: 'male', activityLevel: 'moderate', kcal: '2759', water: '2800', weeklyWorkoutTarget: 2, goalType: 'maintain' });
    expect(m.estimated).toEqual(d.estimated);
  });
  it('the inputs an estimate was calculated from are never changed underneath it by a later prefill', () => {
    const d = applyEstimate(filled(), val(calculateEstimate(filled()))); // maintain, 80 kg, ...
    const m = mergePrefill(d, loaded()); // database says: lose fat, 60 kg, 165 cm ...
    expect(m).toMatchObject({ goalType: 'maintain', weightKg: '80', heightCm: '180', age: '30', sex: 'male', activityLevel: 'moderate', kcal: '2759' });
  });
  it('a field the user emptied on purpose is still theirs (not refilled)', () => {
    const d = setInputs(filled({ age: '30' }), { age: '' });
    expect(mergePrefill(d, loaded()).age).toBe('');
  });
  it('the goal type and its adjustment are kept together', () => {
    const d = setInputs(newDraft(), { goalType: 'build_muscle' });
    expect(mergePrefill(d, loaded())).toMatchObject({ goalType: 'build_muscle', adjustmentPct: '10' });
    const d2 = setInputs(setInputs(newDraft(), { goalType: 'lose_fat' }), { adjustmentPct: '15' });
    expect(mergePrefill(d2, loaded())).toMatchObject({ goalType: 'lose_fat', adjustmentPct: '15' });
  });
  it('estimate labels from a saved "calculated" goal apply only to the untouched targets', () => {
    const calculated = draftFromSaved({ goals: { ...savedGoals, source: 'calculated' }, profile: null, latestWeight: null, today: TODAY });
    const m = mergePrefill(setTarget(newDraft(), 'kcal', '2500'), calculated);
    expect(m.kcal).toBe('2500');
    expect(m.estimated).toEqual({ proteinG: true, carbsG: true, fatG: true, water: true });
  });
  it('the target weight always comes from the database, and the typed weekly target wins', () => {
    const m = mergePrefill(setWeeklyTarget(newDraft(), 6), loaded());
    expect(m.targetWeightKg).toBe(75);
    expect(m.weeklyWorkoutTarget).toBe(6);
  });
});

describe('R3: provenance labels', () => {
  const calc = () => applyEstimate(filled(), val(calculateEstimate(filled())));
  it('water is a preliminary estimate even before anything is calculated and after reopening saved manual goals', () => {
    expect(fieldBadges(newDraft(), 'water')).toEqual(['preliminary']);
    expect(fieldBadges(draftFromSaved({ goals: savedGoals, profile: null, latestWeight: null, today: TODAY }), 'water')).toEqual(['preliminary']);
  });
  it('water stays labelled when OTHER fields are edited', () => {
    const d = setTarget(setTarget(calc(), 'kcal', '2500'), 'proteinG', '150');
    expect(fieldBadges(d, 'water')).toEqual(['preliminary']);
    expect(fieldBadges(d, 'carbsG')).toEqual(['estimate']);
  });
  it('an edited calculated value is "edited", never "estimate"; edited water keeps its preliminary label', () => {
    const d = setTarget(setTarget(calc(), 'kcal', '2500'), 'water', '3000');
    expect(fieldBadges(d, 'kcal')).toEqual(['edited']);
    expect(fieldBadges(d, 'water')).toEqual(['preliminary', 'edited']);
  });
  it('a value typed from scratch (never calculated) carries no estimate or edited label', () => {
    const d = setTarget(newDraft(), 'kcal', '2000');
    expect(fieldBadges(d, 'kcal')).toEqual([]);
  });
  it('a new calculation clears "edited" and restores the plain labels', () => {
    const d = setTarget(calc(), 'kcal', '2500');
    const again = applyEstimate(d, val(calculateEstimate(d)));
    expect(fieldBadges(again, 'kcal')).toEqual(['estimate']);
    expect(fieldBadges(again, 'water')).toEqual(['preliminary']);
  });
  it('an outdated estimated water value shows both labels', () => {
    expect(fieldBadges(setInputs(calc(), { weightKg: '90' }), 'water')).toEqual(['preliminary', 'outdated']);
  });
});

describe('L2 in the form: limits and conflicts are passed on, not hidden', () => {
  it('records whether the BMR floor applied and which limits were hit', () => {
    const floor = applyEstimate(filled({ sex: 'female', age: '25', heightCm: '165', weightKg: '60', activityLevel: 'sedentary', goalType: 'lose_fat', adjustmentPct: '20' }),
      val(calculateEstimate(filled({ sex: 'female', age: '25', heightCm: '165', weightKg: '60', activityLevel: 'sedentary', goalType: 'lose_fat', adjustmentPct: '20' }))));
    expect(floor.estimateInfo).toEqual({ bmrFloorApplied: true, limits: [] });
    expect(applyEstimate(filled(), val(calculateEstimate(filled()))).estimateInfo).toEqual({ bmrFloorApplied: false, limits: [] });
  });
  it('a calorie conflict is reported against the estimate as a whole', () => {
    const r = calculateEstimate(filled({ sex: 'male', age: '10', heightCm: '250', weightKg: '500', activityLevel: 'very_active' }));
    expect(issuesOf(r)).toEqual({ estimate: CALORIE_CONFLICT_KEY });
  });
});
