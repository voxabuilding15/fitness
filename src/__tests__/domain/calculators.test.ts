import {
  ACTIVITY_FACTOR, ADJUSTMENT_LIMITS_PCT, CALORIE_ADJUSTMENT, CALORIE_CONFLICT_KEY, DEFAULT_ADJUSTMENT_PCT, KCAL_PER_G, LIMITS, estimateActivityKcal, estimateBmr, estimateGoals, estimateOneRepMax,
  type GoalEstimateInput,
} from '../../domain/calculators';
import { goalsInput, profileInput } from '../../domain/schemas';
import { ACTIVITY_LEVEL, GOAL_TYPE, SEX } from '../../domain/schemas/enums';

const male: GoalEstimateInput = { sex: 'male', ageYears: 30, heightCm: 180, weightKg: 80, activityLevel: 'moderate', goalType: 'maintain' };
const female: GoalEstimateInput = { sex: 'female', ageYears: 25, heightCm: 165, weightKg: 60, activityLevel: 'light', goalType: 'lose_fat' };
const value = <T,>(r: { ok: boolean; value?: T; error?: unknown }): T => {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value as T;
};
const issues = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { issues: Record<string, string> }).issues);

describe('BMR (Mifflin-St Jeor), hand-computed values', () => {
  it('male 80 kg / 180 cm / 30 y = 10*80 + 6.25*180 - 5*30 + 5 = 1780', () => {
    expect(value(estimateBmr(male)).kcal).toBe(1780);
  });
  it('female 60 kg / 165 cm / 25 y = 600 + 1031.25 - 125 - 161 = 1345.25 -> 1345', () => {
    expect(value(estimateBmr(female)).kcal).toBe(1345);
  });
  it('every result is marked as an estimate', () => {
    expect(value(estimateBmr(male)).isEstimate).toBe(true);
  });
});

describe('goal estimates, hand-computed values', () => {
  it('male maintain: TDEE 1780 x 1.55 = 2759; protein 1.6 g/kg = 128; fat 25 % = 77; carbs = remainder = 389; water 35 ml/kg = 2800', () => {
    expect(value(estimateGoals(male))).toEqual({
      bmrKcal: 1780, tdeeKcal: 2759, kcalTarget: 2759, bmrFloorApplied: false, limits: [], proteinG: 128, fatG: 77, carbsG: 389, waterMlTarget: 2800, isEstimate: true,
    });
  });
  it('female lose fat: TDEE 1850, -20 % = 1480; protein 2 g/kg = 120; fat 41; carbs 158; water 2100', () => {
    expect(value(estimateGoals(female))).toEqual({
      bmrKcal: 1345, tdeeKcal: 1850, kcalTarget: 1480, bmrFloorApplied: false, limits: [], proteinG: 120, fatG: 41, carbsG: 158, waterMlTarget: 2100, isEstimate: true,
    });
  });
  it('build muscle adds 10 %: male 2759 -> 3035 kcal, protein 1.8 g/kg = 144', () => {
    const g = value(estimateGoals({ ...male, goalType: 'build_muscle' }));
    expect(g).toMatchObject({ kcalTarget: 3035, proteinG: 144, fatG: 84, carbsG: 426 });
  });
  it('a deficit never goes below the estimated BMR', () => {
    // sedentary female: TDEE 1614, -20 % would be 1291 < BMR 1345
    const g = value(estimateGoals({ ...female, activityLevel: 'sedentary' }));
    expect(g.kcalTarget).toBe(1345);
    expect(g.bmrFloorApplied).toBe(true);
    expect(g.kcalTarget).toBeGreaterThanOrEqual(g.bmrKcal);
  });
  it('the goal changes with the profile (acceptance): heavier, older, taller and more active move the targets in the expected direction', () => {
    const base = value(estimateGoals(male));
    expect(value(estimateGoals({ ...male, weightKg: 90 })).kcalTarget).toBeGreaterThan(base.kcalTarget);
    expect(value(estimateGoals({ ...male, heightCm: 190 })).kcalTarget).toBeGreaterThan(base.kcalTarget);
    expect(value(estimateGoals({ ...male, ageYears: 40 })).kcalTarget).toBeLessThan(base.kcalTarget);
    expect(value(estimateGoals({ ...male, activityLevel: 'very_active' })).kcalTarget).toBeGreaterThan(base.kcalTarget);
    expect(value(estimateGoals({ ...male, sex: 'female' })).kcalTarget).toBeLessThan(base.kcalTarget);
    expect(value(estimateGoals({ ...male, weightKg: 90 })).waterMlTarget).toBeGreaterThan(base.waterMlTarget);
    expect(value(estimateGoals({ ...male, goalType: 'lose_fat' })).kcalTarget).toBeLessThan(base.kcalTarget);
    expect(value(estimateGoals({ ...male, goalType: 'build_muscle' })).kcalTarget).toBeGreaterThan(base.kcalTarget);
  });
  it('the activity factors and goal adjustments are ordered', () => {
    const f = ACTIVITY_LEVEL.map((l) => ACTIVITY_FACTOR[l]);
    expect([...f].sort((a, b) => a - b)).toEqual(f);
    expect(CALORIE_ADJUSTMENT.lose_fat).toBeLessThan(CALORIE_ADJUSTMENT.maintain);
    expect(CALORIE_ADJUSTMENT.maintain).toBeLessThan(CALORIE_ADJUSTMENT.build_muscle);
  });
});

describe('inputs are validated, never guessed', () => {
  it('reports every missing profile field by name', () => {
    const r = estimateGoals({ sex: null, ageYears: null, heightCm: undefined, weightKg: null, activityLevel: null, goalType: null });
    expect(issues(r)).toEqual({
      sex: 'validation.required', ageYears: 'validation.required', heightCm: 'validation.required', weightKg: 'validation.required',
      activityLevel: 'validation.required', goalType: 'validation.required',
    });
  });
  it.each([
    ['age below range', { ageYears: 9 }, 'ageYears'], ['age above range', { ageYears: 101 }, 'ageYears'], ['fractional age', { ageYears: 30.5 }, 'ageYears'],
    ['NaN weight', { weightKg: NaN }, 'weightKg'], ['Infinity height', { heightCm: Infinity }, 'heightCm'],
    ['weight 19', { weightKg: 19 }, 'weightKg'], ['height 99', { heightCm: 99 }, 'heightCm'], ['negative height', { heightCm: -170 }, 'heightCm'],
  ] as const)('rejects %s', (_n, patch, field) => {
    expect(issues(estimateGoals({ ...male, ...patch }))).toEqual({ [field]: 'validation.outOfRange' });
  });
  it('rejects an unknown sex / activity level / goal instead of defaulting', () => {
    const bad = { ...male, sex: 'x', activityLevel: 'extreme', goalType: 'bulk' } as unknown as GoalEstimateInput;
    expect(issues(estimateGoals(bad))).toEqual({ sex: 'validation.invalid', activityLevel: 'validation.invalid', goalType: 'validation.invalid' });
  });
  it('accepts the exact range boundaries', () => {
    for (const patch of [{ ageYears: 10 }, { ageYears: 100 }, { heightCm: 100 }, { heightCm: 250 }, { weightKg: 20 }, { weightKg: 500 }]) {
      expect(estimateGoals({ ...male, ...patch }).ok).toBe(true);
    }
  });
  it('the limits equal the profile schema (a change in one must change the other)', () => {
    const p = { displayName: 'x', sex: 'male', ageYears: 30, heightCm: 180, activityLevel: 'moderate' } as const;
    expect(profileInput.safeParse({ ...p, ageYears: LIMITS.ageYears.min }).success).toBe(true);
    expect(profileInput.safeParse({ ...p, ageYears: LIMITS.ageYears.min - 1 }).success).toBe(false);
    expect(profileInput.safeParse({ ...p, ageYears: LIMITS.ageYears.max }).success).toBe(true);
    expect(profileInput.safeParse({ ...p, ageYears: LIMITS.ageYears.max + 1 }).success).toBe(false);
    expect(profileInput.safeParse({ ...p, heightCm: LIMITS.heightCm.min }).success).toBe(true);
    expect(profileInput.safeParse({ ...p, heightCm: LIMITS.heightCm.min - 1 }).success).toBe(false);
    expect(profileInput.safeParse({ ...p, heightCm: LIMITS.heightCm.max }).success).toBe(true);
    expect(profileInput.safeParse({ ...p, heightCm: LIMITS.heightCm.max + 1 }).success).toBe(false);
  });
});

describe('across the whole valid input space', () => {
  const ages = [10, 18, 30, 55, 100];
  const heights = [100, 150, 180, 250];
  const weights = [20, 45, 80, 140, 300, 500];
  it('every result is finite, non-negative, inside the goal schema, never below the reported BMR, and honest about every clamp', () => {
    let ok = 0;
    let conflicts = 0;
    for (const sex of SEX) for (const ageYears of ages) for (const heightCm of heights) for (const weightKg of weights)
      for (const activityLevel of ACTIVITY_LEVEL) for (const goalType of GOAL_TYPE) {
        const label = JSON.stringify({ sex, ageYears, heightCm, weightKg, activityLevel, goalType });
        const r = estimateGoals({ sex, ageYears, heightCm, weightKg, activityLevel, goalType });
        if (!r.ok) {
          // the only legitimate failure for valid input is the documented calorie conflict
          expect({ label, issues: issues(r) }).toEqual({ label, issues: { kcalTarget: CALORIE_CONFLICT_KEY } });
          conflicts++;
          continue;
        }
        const g = r.value;
        for (const v of Object.values(g)) if (typeof v === 'number') expect(Number.isFinite(v) && v >= 0).toBe(true);
        const parsed = goalsInput.safeParse({
          goalType, kcalTarget: g.kcalTarget, proteinG: g.proteinG, carbsG: g.carbsG, fatG: g.fatG, waterMlTarget: g.waterMlTarget,
          weeklyWorkoutTarget: 3, source: 'calculated',
        });
        if (!parsed.success) throw new Error(`not a valid goals input for ${label}: ${JSON.stringify(g)}`);
        expect({ label, meetsBmr: g.kcalTarget >= g.bmrKcal }).toEqual({ label, meetsBmr: true });
        // the BMR flag is only ever true when the target IS the BMR figure
        if (g.bmrFloorApplied) expect({ label, target: g.kcalTarget }).toEqual({ label, target: Math.max(g.bmrKcal, g.kcalTarget) });
        if (g.bmrFloorApplied) expect(g.limits.some((l) => l === 'kcal_min' || l === 'kcal_max')).toBe(false);
        // macros add up to the calories unless a clamp is reported
        const macroKcal = g.proteinG * KCAL_PER_G.protein + g.carbsG * KCAL_PER_G.carbs + g.fatG * KCAL_PER_G.fat;
        const macroClamps = g.limits.filter((l) => l === 'protein_max' || l === 'fat_max' || l === 'carbs_zero' || l === 'carbs_max');
        if (macroClamps.length === 0) expect({ label, diff: Math.abs(macroKcal - g.kcalTarget) <= 7 }).toEqual({ label, diff: true });
        if (g.limits.includes('carbs_zero')) expect(macroKcal).toBeGreaterThan(g.kcalTarget);
        ok++;
      }
    expect(ok + conflicts).toBe(2 * 5 * 4 * 6 * 5 * 3);
    expect(ok).toBeGreaterThan(0);
    expect(conflicts).toBeGreaterThan(0);
  });
});

describe('enum inputs are checked with own-property allowlists (never prototype keys)', () => {
  const hostile = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'extreme', '', ' moderate', 'MODERATE', 42, {}, [], true];
  it.each(hostile.map((v, i) => [i, v]))('activity level #%i is rejected, never a successful NaN estimate', (_i, v) => {
    const r = estimateGoals({ ...male, activityLevel: v as never });
    expect(r.ok).toBe(false);
    expect(issues(r)).toEqual({ activityLevel: 'validation.invalid' });
  });
  it.each(hostile.map((v, i) => [i, v]))('goal type #%i is rejected, never a successful NaN estimate', (_i, v) => {
    const r = estimateGoals({ ...male, goalType: v as never });
    expect(r.ok).toBe(false);
    expect(issues(r)).toEqual({ goalType: 'validation.invalid' });
  });
  it.each(hostile.map((v, i) => [i, v]))('sex #%i is rejected', (_i, v) => {
    expect(issues(estimateGoals({ ...male, sex: v as never }))).toEqual({ sex: 'validation.invalid' });
    expect(issues(estimateBmr({ ...male, sex: v as never }))).toEqual({ sex: 'validation.invalid' });
  });
  it('an adjustment given with a prototype-key goal does not leak a second confusing issue', () => {
    expect(issues(estimateGoals({ ...male, goalType: 'constructor' as never, adjustmentPct: 10 }))).toEqual({ goalType: 'validation.invalid' });
  });
  it('whatever the input, an ok result never contains a non-finite number', () => {
    const odd: unknown[] = [NaN, Infinity, -Infinity, 1e308, -1, 0, '80', null, undefined, {}];
    for (const w of odd) for (const a of odd) {
      const r = estimateGoals({ ...male, weightKg: w as never, ageYears: a as never });
      if (r.ok) for (const v of Object.values(r.value)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('the BMR floor, the calorie limits and macro clamps are reported truthfully', () => {
  it('a floor that is really applied is flagged and the target is exactly the BMR', () => {
    const g = value(estimateGoals({ ...female, activityLevel: 'sedentary' })); // 1614 x 0.8 = 1291 < BMR 1345
    expect(g).toMatchObject({ kcalTarget: 1345, bmrKcal: 1345, bmrFloorApplied: true, limits: [] });
  });
  it('no floor is claimed when the adjusted calories are already above the BMR', () => {
    expect(value(estimateGoals(male)).bmrFloorApplied).toBe(false);
  });
  it('very small body: the app minimum (800) applies, the target is above the BMR, and the BMR floor is NOT claimed', () => {
    const g = value(estimateGoals({ sex: 'female', ageYears: 100, heightCm: 100, weightKg: 20, activityLevel: 'sedentary', goalType: 'lose_fat' }));
    expect(g).toMatchObject({ bmrKcal: 164, kcalTarget: 800, bmrFloorApplied: false });
    expect(g.limits).toContain('kcal_min');
    expect(g.kcalTarget).toBeGreaterThanOrEqual(g.bmrKcal);
  });
  it('very large body with a surplus: capped at 6000, still at least the BMR, and reported', () => {
    const g = value(estimateGoals({ sex: 'male', ageYears: 30, heightCm: 250, weightKg: 300, activityLevel: 'very_active', goalType: 'build_muscle' }));
    expect(g.kcalTarget).toBe(6000);
    expect(g.bmrKcal).toBeLessThan(6000);
    expect(g.limits).toContain('kcal_max');
    expect(g.bmrFloorApplied).toBe(false);
  });
  it('a BMR above the largest storable target is a reported conflict, never a successful estimate below the BMR', () => {
    const r = estimateGoals({ sex: 'male', ageYears: 10, heightCm: 250, weightKg: 500, activityLevel: 'very_active', goalType: 'maintain' }); // BMR 6518
    expect(r.ok).toBe(false);
    expect(issues(r)).toEqual({ kcalTarget: CALORIE_CONFLICT_KEY });
  });
  it('the boundary of that conflict: BMR 6000 is fine, BMR 6001 is a conflict', () => {
    // male: 10w + 6.25h - 5a + 5 ; w 500, h 160, a 10 -> 5000 + 1000 - 50 + 5 = 5955 ; h 167.2 -> 5000 + 1045 - 50 + 5 = 6000
    expect(estimateGoals({ sex: 'male', ageYears: 10, heightCm: 167.2, weightKg: 500, activityLevel: 'sedentary', goalType: 'maintain' }).ok).toBe(true);
    expect(issues(estimateGoals({ sex: 'male', ageYears: 10, heightCm: 167.4, weightKg: 500, activityLevel: 'sedentary', goalType: 'maintain' }))).toEqual({ kcalTarget: CALORIE_CONFLICT_KEY });
  });
  it('protein is never silently capped: above 600 g the cap is reported', () => {
    const g = value(estimateGoals({ ...male, weightKg: 400, heightCm: 190, goalType: 'lose_fat' })); // 2 g/kg x 400 = 800 g
    expect(g.proteinG).toBe(600);
    expect(g.limits).toContain('protein_max');
    expect(value(estimateGoals(male)).limits).not.toContain('protein_max');
  });
  it('carbohydrate is never silently floored: when protein + fat exceed the calories the 0 g is reported and the macros exceed the target', () => {
    const g = value(estimateGoals({ sex: 'female', ageYears: 100, heightCm: 100, weightKg: 200, activityLevel: 'sedentary', goalType: 'lose_fat' }));
    expect(g.carbsG).toBe(0);
    expect(g.limits).toContain('carbs_zero');
    expect(g.proteinG * 4 + g.fatG * 9).toBeGreaterThan(g.kcalTarget);
  });
  it('water above 8000 ml is capped and reported', () => {
    const g = value(estimateGoals({ ...male, weightKg: 500, heightCm: 180, ageYears: 30 }));
    expect(g.waterMlTarget).toBe(8000);
    expect(g.limits).toContain('water_max');
  });
  it('an ordinary estimate reports no limits at all', () => {
    expect(value(estimateGoals(male)).limits).toEqual([]);
    expect(value(estimateGoals(female)).limits).toEqual([]);
  });
});

describe('workout energy (MET)', () => {
  it('8 MET, 70 kg, 30 min = 8 x 70 x 0.5 = 280 kcal', () => {
    expect(value(estimateActivityKcal(8, 70, 30))).toEqual({ kcal: 280, isEstimate: true });
  });
  it('is proportional to time and weight; zero minutes is 0 kcal', () => {
    expect(value(estimateActivityKcal(5, 80, 60)).kcal).toBe(400);
    expect(value(estimateActivityKcal(5, 80, 0)).kcal).toBe(0);
  });
  it('rejects nonsense', () => {
    expect(issues(estimateActivityKcal(0.5, 70, 30))).toEqual({ met: 'validation.outOfRange' });
    expect(issues(estimateActivityKcal(8, 10, 30))).toEqual({ weightKg: 'validation.outOfRange' });
    expect(issues(estimateActivityKcal(8, 70, -1))).toEqual({ durationMin: 'validation.outOfRange' });
    expect(issues(estimateActivityKcal(NaN, 70, 30))).toEqual({ met: 'validation.outOfRange' });
  });
});

describe('estimated 1RM (Epley)', () => {
  it('100 kg x 5 = 100 x (1 + 5/30) = 116.7', () => {
    expect(value(estimateOneRepMax(100, 5))).toEqual({ kg: 116.7, isEstimate: true });
  });
  it('100 kg x 10 = 133.3; 60 kg x 8 = 76', () => {
    expect(value(estimateOneRepMax(100, 10)).kg).toBe(133.3);
    expect(value(estimateOneRepMax(60, 8)).kg).toBe(76);
  });
  it('one rep is exactly the weight lifted', () => {
    expect(value(estimateOneRepMax(142.5, 1)).kg).toBe(142.5);
  });
  it('rejects 0, fractional, negative and too many reps (the formula is unreliable beyond 12)', () => {
    for (const reps of [0, 0.5, -3, 13, 30, NaN]) expect(issues(estimateOneRepMax(100, reps))).toEqual({ reps: 'validation.outOfRange' });
    expect(value(estimateOneRepMax(100, 12)).kg).toBe(140);
    expect(issues(estimateOneRepMax(0, 5))).toEqual({ weightKg: 'validation.outOfRange' });
  });
});

describe('user-adjustable calorie change', () => {
  it('defaults are the approved 20 % deficit and 10 % surplus', () => {
    expect(DEFAULT_ADJUSTMENT_PCT).toEqual({ lose_fat: 20, maintain: 0, build_muscle: 10 });
    expect(value(estimateGoals({ ...male, goalType: 'lose_fat' })).kcalTarget).toBe(2207); // 2759 x 0.8
    expect(value(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: 20 })).kcalTarget).toBe(2207);
  });
  it('a custom deficit / surplus is applied: 10 % deficit 2483, 0 % = TDEE 2759, 25 % surplus 3449', () => {
    expect(value(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: 10 })).kcalTarget).toBe(2483);
    expect(value(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: 0 })).kcalTarget).toBe(2759);
    expect(value(estimateGoals({ ...male, goalType: 'build_muscle', adjustmentPct: 25 })).kcalTarget).toBe(3449);
    expect(value(estimateGoals({ ...male, goalType: 'build_muscle', adjustmentPct: 5 })).kcalTarget).toBe(2897); // 2759 x 1.05
  });
  it('a bigger deficit never goes below BMR and says so', () => {
    const g = value(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: 40 })); // 2759 x 0.6 = 1655 < BMR 1780
    expect(g).toMatchObject({ kcalTarget: 1780, bmrFloorApplied: true });
    expect(value(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: 20 })).bmrFloorApplied).toBe(false);
  });
  it('rejects an adjustment outside the allowed range, or any adjustment for maintain', () => {
    expect(issues(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: 41 }))).toEqual({ adjustmentPct: 'validation.outOfRange' });
    expect(issues(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: -1 }))).toEqual({ adjustmentPct: 'validation.outOfRange' });
    expect(issues(estimateGoals({ ...male, goalType: 'build_muscle', adjustmentPct: 26 }))).toEqual({ adjustmentPct: 'validation.outOfRange' });
    expect(issues(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: NaN }))).toEqual({ adjustmentPct: 'validation.outOfRange' });
    expect(issues(estimateGoals({ ...male, goalType: 'maintain', adjustmentPct: 10 }))).toEqual({ adjustmentPct: 'validation.outOfRange' });
    expect(value(estimateGoals({ ...male, goalType: 'maintain', adjustmentPct: 0 })).kcalTarget).toBe(2759);
    expect(ADJUSTMENT_LIMITS_PCT.maintain).toEqual({ min: 0, max: 0 });
  });
  it('the macro split follows the adjusted calories (protein is by body weight, fat 25 % of the new target)', () => {
    const g = value(estimateGoals({ ...male, goalType: 'lose_fat', adjustmentPct: 10 })); // 2483 kcal
    expect(g).toMatchObject({ kcalTarget: 2483, proteinG: 160, fatG: 69 }); // 2.0 x 80; round(0.25 x 2483 / 9) = 69
    expect(g.carbsG).toBe(Math.round((2483 - 160 * 4 - 69 * 9) / 4)); // 305.5 -> 306
  });
});
