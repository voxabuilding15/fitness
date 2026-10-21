import {
  completeSessionInput, dateRangeInput, exerciseInput, exercisePatch, foodInput, goalsInput, habitInput, habitLogInput, mealInput, mealPatch,
  parseInput, profileInput, sessionPatch, sessionStartInput, setInput, setPatch, templateInput, waterInput, weightInput,
} from '../../domain/schemas';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';

const issues = (schema: any, data: unknown) => {
  const r = parseInput(schema, data);
  return r.ok ? null : (r.error as any).issues as Record<string, string>;
};
const valid = (schema: any, data: unknown) => {
  const r = parseInput(schema, data);
  if (!r.ok) throw new Error(`expected valid, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe('parseInput: mapping to translation keys', () => {
  it('missing / blank / too long / out of range / wrong type', () => {
    expect(issues(profileInput, {})).toEqual({ displayName: 'validation.required' });
    expect(issues(profileInput, { displayName: '   ' })).toEqual({ displayName: 'validation.required' });
    expect(issues(profileInput, { displayName: 'x'.repeat(41) })).toEqual({ displayName: 'validation.tooLong' });
    expect(issues(profileInput, { displayName: 'A', ageYears: 9 })).toEqual({ ageYears: 'validation.outOfRange' });
    expect(issues(profileInput, { displayName: 'A', heightCm: '170' })).toEqual({ heightCm: 'validation.invalid' });
    expect(issues(profileInput, { displayName: 'A', heightCm: NaN })).toEqual({ heightCm: 'validation.invalid' });
    expect(issues(profileInput, { displayName: 'A', ageYears: 30.5 })).toEqual({ ageYears: 'validation.invalid' });
  });
  it('rejects unknown fields instead of ignoring them', () => {
    expect(issues(profileInput, { displayName: 'A', nickname: 'x' })).toEqual({ _: 'validation.invalid' });
  });
  it('reports every offending field, not just the first', () => {
    expect(issues(profileInput, { displayName: '', ageYears: 200, heightCm: 10 })).toEqual({
      displayName: 'validation.required', ageYears: 'validation.outOfRange', heightCm: 'validation.outOfRange',
    });
  });
  it('every key the schemas can emit exists in both languages', () => {
    const get = (o: any, p: string) => p.split('.').reduce((a, k) => a?.[k], o);
    for (const k of ['required', 'tooLong', 'outOfRange', 'invalidDate', 'invalid']) {
      expect(typeof get(en, `validation.${k}`)).toBe('string');
      expect(typeof get(ar, `validation.${k}`)).toBe('string');
    }
  });
});

describe('profile and goals', () => {
  it('accepts a minimal and a complete profile; trims text', () => {
    expect(valid(profileInput, { displayName: ' Sara ' })).toEqual({ displayName: 'Sara' });
    expect(valid(profileInput, { displayName: 'Sara', location: 'Cairo', sex: 'female', ageYears: 30, heightCm: 165.5, activityLevel: 'light' })).toMatchObject({ ageYears: 30 });
  });
  it('rejects unknown enum values', () => {
    expect(issues(profileInput, { displayName: 'A', sex: 'x' })).toEqual({ sex: 'validation.invalid' });
    expect(issues(profileInput, { displayName: 'A', activityLevel: 'extreme' })).toEqual({ activityLevel: 'validation.invalid' });
  });
  it('goals: required fields and ranges', () => {
    const base = { goalType: 'maintain', waterMlTarget: 2000, weeklyWorkoutTarget: 3, source: 'manual' };
    expect(valid(goalsInput, base)).toMatchObject({ goalType: 'maintain' });
    expect(issues(goalsInput, { ...base, kcalTarget: 700 })).toEqual({ kcalTarget: 'validation.outOfRange' });
    expect(issues(goalsInput, { ...base, goalType: 'bulkzilla' })).toEqual({ goalType: 'validation.invalid' });
    expect(issues(goalsInput, { goalType: 'maintain' })).toEqual({ waterMlTarget: 'validation.required', weeklyWorkoutTarget: 'validation.required', source: 'validation.required' });
  });
});

describe('exercises and templates', () => {
  const ex = { name: 'Cable fly', category: 'strength', primaryMuscle: 'chest', equipment: 'cable', trackingType: 'weight_reps' };
  it('accepts a custom exercise (secondary muscles default to [])', () => {
    expect(valid(exerciseInput, ex)).toMatchObject({ secondaryMuscles: [] });
  });
  it('secondary muscles: no duplicates, not the primary, max 5', () => {
    expect(issues(exerciseInput, { ...ex, secondaryMuscles: ['chest'] })).toEqual({ secondaryMuscles: 'validation.invalid' });
    expect(issues(exerciseInput, { ...ex, secondaryMuscles: ['triceps', 'triceps'] })).toEqual({ secondaryMuscles: 'validation.invalid' });
    expect(issues(exerciseInput, { ...ex, secondaryMuscles: ['triceps', 'shoulders', 'core', 'back', 'biceps', 'glutes'] })).toEqual({ secondaryMuscles: 'validation.outOfRange' });
  });
  it('exercise patch allows partial updates but still validates', () => {
    expect(valid(exercisePatch, { name: 'New name' })).toEqual({ name: 'New name' });
    expect(issues(exercisePatch, { metValue: 40 })).toEqual({ metValue: 'validation.outOfRange' });
    expect(valid(exercisePatch, { metValue: null })).toEqual({ metValue: null });
  });
  const te = { exerciseId: 1, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSec: 60 };
  it('template needs a name and 1..30 exercises', () => {
    expect(valid(templateInput, { name: 'Push', exercises: [te] }).exercises).toHaveLength(1);
    expect(issues(templateInput, { name: 'Push', exercises: [] })).toEqual({ exercises: 'validation.outOfRange' });
    expect(issues(templateInput, { name: '', exercises: [te] })).toEqual({ name: 'validation.required' });
    expect(issues(templateInput, { name: 'x', exercises: Array.from({ length: 31 }, () => te) })).toEqual({ exercises: 'validation.outOfRange' });
  });
  it('template exercise: sets, rest, rep range, and a reps-or-duration target', () => {
    expect(issues(templateInput, { name: 'x', exercises: [{ ...te, targetSets: 0 }] })).toEqual({ 'exercises.0.targetSets': 'validation.outOfRange' });
    expect(issues(templateInput, { name: 'x', exercises: [{ ...te, restSec: 901 }] })).toEqual({ 'exercises.0.restSec': 'validation.outOfRange' });
    expect(issues(templateInput, { name: 'x', exercises: [{ ...te, targetRepsMin: 12, targetRepsMax: 8 }] })).toEqual({ 'exercises.0.targetRepsMin': 'validation.outOfRange' });
    expect(issues(templateInput, { name: 'x', exercises: [{ exerciseId: 1, targetSets: 3, restSec: 60 }] })).toEqual({ 'exercises.0.targetRepsMin': 'validation.required' });
    expect(valid(templateInput, { name: 'x', exercises: [{ exerciseId: 1, targetSets: 2, targetDurationSec: 45, restSec: 30 }] })).toBeTruthy();
  });
});

describe('sessions and sets', () => {
  it('start: everything optional, but ids must be positive integers', () => {
    expect(valid(sessionStartInput, {})).toEqual({});
    expect(issues(sessionStartInput, { templateId: 0 })).toEqual({ templateId: 'validation.outOfRange' });
    expect(issues(sessionStartInput, { exerciseIds: [1, -2] })).toEqual({ 'exerciseIds.1': 'validation.outOfRange' });
  });
  it('set: defaults, ranges, and a completed set needs a metric', () => {
    expect(valid(setInput, { reps: 5 })).toMatchObject({ isWarmup: false, isCompleted: false });
    expect(issues(setInput, { reps: -1 })).toEqual({ reps: 'validation.outOfRange' });
    expect(issues(setInput, { weightKg: -5, reps: 5 })).toEqual({ weightKg: 'validation.outOfRange' });
    expect(issues(setInput, { reps: 5, rpe: 11 })).toEqual({ rpe: 'validation.outOfRange' });
    expect(issues(setInput, { isCompleted: true })).toEqual({ reps: 'validation.required' });
    expect(valid(setInput, { isCompleted: true, durationSec: 30 })).toBeTruthy();
  });
  it('set patch allows null to clear a value', () => {
    expect(valid(setPatch, { weightKg: null, reps: 8 })).toEqual({ weightKg: null, reps: 8 });
    expect(issues(setPatch, { reps: 2000 })).toEqual({ reps: 'validation.outOfRange' });
  });
  it('session corrections and completion input', () => {
    expect(valid(sessionPatch, { name: 'Fixed', rpe: null })).toEqual({ name: 'Fixed', rpe: null });
    expect(issues(sessionPatch, { rpe: 11 })).toEqual({ rpe: 'validation.outOfRange' });
    expect(issues(completeSessionInput, { rpe: 0 })).toEqual({ rpe: 'validation.outOfRange' });
    expect(valid(completeSessionInput, {})).toEqual({});
  });
});

describe('nutrition, water, weight', () => {
  const food = { name: 'Rice', unit: 'g', kcalPer100: 130, proteinPer100: 2.7, carbsPer100: 28, fatPer100: 0.3, defaultServing: 150 };
  it('food: ranges and impossible macro totals', () => {
    expect(valid(foodInput, food)).toBeTruthy();
    expect(issues(foodInput, { ...food, kcalPer100: 1200 })).toEqual({ kcalPer100: 'validation.outOfRange' });
    expect(issues(foodInput, { ...food, unit: 'oz' })).toEqual({ unit: 'validation.invalid' });
    expect(issues(foodInput, { ...food, proteinPer100: 60, carbsPer100: 50, fatPer100: 10 })).toEqual({ proteinPer100: 'validation.outOfRange' });
    expect(issues(foodInput, { ...food, defaultServing: 0 })).toEqual({ defaultServing: 'validation.outOfRange' });
  });
  it('meal: food entry or quick entry; dates must be real', () => {
    expect(valid(mealInput, { kind: 'food', foodId: 1, amount: 150, mealType: 'lunch' })).toBeTruthy();
    expect(valid(mealInput, { kind: 'quick', quickLabel: 'Snack', kcal: 200, mealType: 'snack' })).toMatchObject({ proteinG: 0, carbsG: 0, fatG: 0 });
    expect(issues(mealInput, { kind: 'food', foodId: 1, amount: 0, mealType: 'lunch' })).toEqual({ amount: 'validation.outOfRange' });
    expect(issues(mealInput, { kind: 'food', foodId: 1, amount: 100, mealType: 'brunch' })).toEqual({ mealType: 'validation.invalid' });
    expect(issues(mealInput, { kind: 'food', foodId: 1, amount: 100, mealType: 'lunch', localDate: '2026-02-30' })).toEqual({ localDate: 'validation.invalidDate' });
    expect(issues(mealInput, { kind: 'quick', kcal: 100, mealType: 'snack' })).toEqual({ quickLabel: 'validation.required' });
    expect(issues(mealInput, { kind: 'drink' })).toBeTruthy();
    expect(valid(mealPatch, { amount: 80 })).toEqual({ amount: 80 });
  });
  it('water and weight', () => {
    expect(valid(waterInput, { amountMl: 250 })).toBeTruthy();
    expect(issues(waterInput, { amountMl: 0 })).toEqual({ amountMl: 'validation.outOfRange' });
    expect(issues(waterInput, { amountMl: 250.5 })).toEqual({ amountMl: 'validation.invalid' });
    expect(issues(waterInput, { amountMl: 250, localDate: '2026-13-01' })).toEqual({ localDate: 'validation.invalidDate' });
    expect(valid(weightInput, { weightKg: 72.4, localDate: '2028-02-29' })).toBeTruthy();
    expect(issues(weightInput, { weightKg: 10 })).toEqual({ weightKg: 'validation.outOfRange' });
    expect(issues(weightInput, { weightKg: 70, note: 'x'.repeat(201) })).toEqual({ note: 'validation.tooLong' });
  });
});

describe('habits and ranges', () => {
  it('count habits need a target; boolean habits must not have one', () => {
    expect(valid(habitInput, { name: 'Walk', kind: 'boolean' })).toMatchObject({ scheduleDays: 127 });
    expect(valid(habitInput, { name: 'Water', kind: 'count', targetCount: 8 })).toBeTruthy();
    expect(issues(habitInput, { name: 'Water', kind: 'count' })).toEqual({ targetCount: 'validation.required' });
    expect(issues(habitInput, { name: 'Walk', kind: 'boolean', targetCount: 3 })).toEqual({ targetCount: 'validation.required' });
    expect(issues(habitInput, { name: 'Walk', kind: 'boolean', scheduleDays: 0 })).toEqual({ scheduleDays: 'validation.outOfRange' });
  });
  it('habit log and date range', () => {
    expect(valid(habitLogInput, { habitId: 1, localDate: '2026-10-21', value: 1 })).toBeTruthy();
    expect(issues(habitLogInput, { habitId: 1, localDate: '2026-10-21', value: -1 })).toEqual({ value: 'validation.outOfRange' });
    expect(valid(dateRangeInput, { from: '2026-10-01', to: '2026-10-31' })).toBeTruthy();
    expect(issues(dateRangeInput, { from: '2026-10-31', to: '2026-10-01' })).toEqual({ to: 'validation.invalidDate' });
  });
});
