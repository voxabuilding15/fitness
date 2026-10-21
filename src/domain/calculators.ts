import { err, ok, type Result } from './result';
import type { ActivityLevel, GoalType, Sex } from './schemas/enums';

/**
 * Estimation formulas. Every public result is an `Estimate<T>`: the type carries `isEstimate: true`, so UI code that
 * shows a value can always show it as an estimate. These are general-population formulas, NOT medical advice.
 *
 * Product decisions encoded here (each is a named constant so it can be changed in one place and is covered by tests):
 *  - BMR: Mifflin-St Jeor.   - TDEE: BMR x a standard activity factor.
 *  - Calories: lose_fat -20 %, maintain 0 %, build_muscle +10 % of TDEE by default; the percentage is user-adjustable
 *    within ADJUSTMENT_LIMITS_PCT, and the target is never below the estimated BMR.
 *  - Protein per kg of body weight by goal; fat 25 % of calories; carbohydrate is the remainder.
 *  - Water: 35 ml per kg, rounded to 50 ml.
 *  - Workout energy: MET x kg x hours.   - 1RM: Epley, only for 1..12 reps.
 */
export type Estimate<T> = T & { readonly isEstimate: true };
const asEstimate = <T extends object>(value: T): Estimate<T> => ({ ...value, isEstimate: true });

/** Accepted input ranges (the same as the profile/goal schemas in domain/schemas/inputs.ts; a test keeps them in step). */
export const LIMITS = {
  ageYears: { min: 10, max: 100 },
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 20, max: 500 },
  kcalTarget: { min: 800, max: 6000 },
  proteinG: { max: 600 },
  carbsG: { max: 1500 },
  fatG: { max: 600 },
  waterMl: { min: 500, max: 8000 },
} as const;

export const ACTIVITY_FACTOR: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};
/** Default size of the calorie change from TDEE, in percent (deficit for lose_fat, surplus for build_muscle). */
export const DEFAULT_ADJUSTMENT_PCT: Record<GoalType, number> = { lose_fat: 20, maintain: 0, build_muscle: 10 };
/** Largest change a user may choose, in percent. `maintain` has no adjustment. */
export const ADJUSTMENT_LIMITS_PCT: Record<GoalType, { min: number; max: number }> = {
  lose_fat: { min: 0, max: 40 },
  maintain: { min: 0, max: 0 },
  build_muscle: { min: 0, max: 25 },
};
export const CALORIE_ADJUSTMENT: Record<GoalType, number> = { lose_fat: 0.8, maintain: 1, build_muscle: 1.1 };
const calorieFactor = (goal: GoalType, pct: number) => (goal === 'lose_fat' ? 1 - pct / 100 : goal === 'build_muscle' ? 1 + pct / 100 : 1);
export const PROTEIN_G_PER_KG: Record<GoalType, number> = { lose_fat: 2, maintain: 1.6, build_muscle: 1.8 };
export const FAT_SHARE_OF_KCAL = 0.25;
/** Issue key returned when the estimated BMR is above the largest calorie target the app can store. */
export const CALORIE_CONFLICT_KEY = 'goals.calorieConflict';
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;
export const WATER_ML_PER_KG = 35;
export const MAX_1RM_REPS = 12;

type Issues = Record<string, string>;
/** Own-property test for enum lookups: `'constructor' in {}` is true, so a plain `in` check would accept prototype keys. */
const isOwnKey = <T extends object>(obj: T, key: unknown): key is keyof T & string =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);
const invalid = (issues: Issues) => err({ kind: 'validation' as const, issues });
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** `null`/`undefined` -> required; non-finite or out of range -> outOfRange. */
function checkNumber(issues: Issues, field: string, value: number | null | undefined, min: number, max: number, integer = false) {
  if (value === null || value === undefined) issues[field] = 'validation.required';
  else if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) issues[field] = 'validation.outOfRange';
}

export interface BodyInput {
  sex: Sex | null | undefined;
  ageYears: number | null | undefined;
  heightCm: number | null | undefined;
  weightKg: number | null | undefined;
}

function checkBody(issues: Issues, b: BodyInput) {
  if (b.sex !== 'male' && b.sex !== 'female') issues.sex = b.sex == null ? 'validation.required' : 'validation.invalid';
  checkNumber(issues, 'ageYears', b.ageYears, LIMITS.ageYears.min, LIMITS.ageYears.max, true);
  checkNumber(issues, 'heightCm', b.heightCm, LIMITS.heightCm.min, LIMITS.heightCm.max);
  checkNumber(issues, 'weightKg', b.weightKg, LIMITS.weightKg.min, LIMITS.weightKg.max);
}

const rawBmr = (b: { sex: Sex; ageYears: number; heightCm: number; weightKg: number }) =>
  10 * b.weightKg + 6.25 * b.heightCm - 5 * b.ageYears + (b.sex === 'male' ? 5 : -161);

/** Basal metabolic rate in kcal/day (Mifflin-St Jeor), rounded to a whole kcal. */
export function estimateBmr(input: BodyInput): Result<Estimate<{ kcal: number }>> {
  const issues: Issues = {};
  checkBody(issues, input);
  if (Object.keys(issues).length) return invalid(issues);
  return ok(asEstimate({ kcal: Math.round(rawBmr(input as Required<{ [K in keyof BodyInput]: NonNullable<BodyInput[K]> }>)) }));
}

export interface GoalEstimateInput extends BodyInput {
  activityLevel: ActivityLevel | null | undefined;
  goalType: GoalType | null | undefined;
  /** Size of the calorie change in percent; defaults to DEFAULT_ADJUSTMENT_PCT[goalType]. Must be 0 (or omitted) for `maintain`. */
  adjustmentPct?: number | null;
}

/**
 * Every time a value was changed to stay inside what the app can store, so the screen never presents a clamped number as
 * the plain result of the formula.
 *  - kcal_min / kcal_max: the calorie target was raised to 800 / lowered to 6000 (the range the goal schema accepts).
 *  - protein_max / fat_max: capped at 600 g (schema maximum).
 *  - carbs_zero: protein and fat alone already use more than the calorie target, so carbohydrate is 0 g and the macros add up to MORE than the calories.
 *  - carbs_max: carbohydrate capped at 1500 g.
 *  - water_min / water_max: water limited to 500 / 8000 ml.
 */
export type EstimateLimit = 'kcal_min' | 'kcal_max' | 'protein_max' | 'fat_max' | 'carbs_zero' | 'carbs_max' | 'water_min' | 'water_max';

export interface GoalEstimate {
  bmrKcal: number;
  tdeeKcal: number;
  /** Never below `bmrKcal`: if that cannot be met inside the allowed range, no estimate is returned (see `calorieConflict`). */
  kcalTarget: number;
  /** True only when the adjusted calories were below the estimated BMR AND the final target is that BMR figure. */
  bmrFloorApplied: boolean;
  limits: EstimateLimit[];
  proteinG: number;
  carbsG: number;
  fatG: number;
  waterMlTarget: number;
}

/** Daily energy, macro and water targets from the profile and a goal. Missing or out-of-range fields are reported by name. */
export function estimateGoals(input: GoalEstimateInput): Result<Estimate<GoalEstimate>> {
  const issues: Issues = {};
  checkBody(issues, input);
  if (input.activityLevel == null) issues.activityLevel = 'validation.required';
  else if (!isOwnKey(ACTIVITY_FACTOR, input.activityLevel)) issues.activityLevel = 'validation.invalid';
  if (input.goalType == null) issues.goalType = 'validation.required';
  else if (!isOwnKey(DEFAULT_ADJUSTMENT_PCT, input.goalType)) issues.goalType = 'validation.invalid';
  const goalOk = !issues.goalType;
  if (goalOk && input.adjustmentPct != null) {
    const lim = ADJUSTMENT_LIMITS_PCT[input.goalType as GoalType];
    checkNumber(issues, 'adjustmentPct', input.adjustmentPct, lim.min, lim.max);
  }
  if (Object.keys(issues).length) return invalid(issues);

  const body = input as { sex: Sex; ageYears: number; heightCm: number; weightKg: number };
  const bmr = rawBmr(body);
  const tdee = bmr * ACTIVITY_FACTOR[input.activityLevel as ActivityLevel];
  const goal = input.goalType as GoalType;

  const limits: EstimateLimit[] = [];
  const pct = input.adjustmentPct ?? DEFAULT_ADJUSTMENT_PCT[goal];
  const adjusted = tdee * calorieFactor(goal, pct);

  // Never below the estimated BMR. If even the BMR is above the largest target the app can store, there is no honest
  // answer inside the allowed range: say so instead of returning a target below the BMR.
  if (Math.round(bmr) > LIMITS.kcalTarget.max) return invalid({ kcalTarget: CALORIE_CONFLICT_KEY });
  const wanted = Math.max(adjusted, bmr);
  let kcal = Math.round(wanted);
  if (kcal < LIMITS.kcalTarget.min) {
    kcal = LIMITS.kcalTarget.min; // still above the BMR, which is below the minimum here
    limits.push('kcal_min');
  } else if (kcal > LIMITS.kcalTarget.max) {
    kcal = LIMITS.kcalTarget.max; // at least the BMR (checked above)
    limits.push('kcal_max');
  }
  const bmrFloorApplied = adjusted < bmr && limits.length === 0; // (limits only holds calorie limits at this point)

  const rawProtein = Math.round(PROTEIN_G_PER_KG[goal] * body.weightKg);
  const proteinG = Math.min(rawProtein, LIMITS.proteinG.max);
  if (rawProtein > LIMITS.proteinG.max) limits.push('protein_max');
  const rawFat = Math.round((FAT_SHARE_OF_KCAL * kcal) / KCAL_PER_G.fat);
  const fatG = Math.min(rawFat, LIMITS.fatG.max);
  if (rawFat > LIMITS.fatG.max) limits.push('fat_max');
  const rawCarbs = Math.round((kcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat) / KCAL_PER_G.carbs);
  const carbsG = clamp(rawCarbs, 0, LIMITS.carbsG.max);
  if (rawCarbs < 0) limits.push('carbs_zero');
  if (rawCarbs > LIMITS.carbsG.max) limits.push('carbs_max');
  const rawWater = Math.round((WATER_ML_PER_KG * body.weightKg) / 50) * 50;
  const waterMlTarget = clamp(rawWater, LIMITS.waterMl.min, LIMITS.waterMl.max);
  if (rawWater < LIMITS.waterMl.min) limits.push('water_min');
  if (rawWater > LIMITS.waterMl.max) limits.push('water_max');

  const estimate = { bmrKcal: Math.round(bmr), tdeeKcal: Math.round(tdee), kcalTarget: kcal, bmrFloorApplied, limits, proteinG, carbsG, fatG, waterMlTarget };
  // belt and braces: a non-finite number must never be reported as a successful estimate
  for (const [k, v] of Object.entries(estimate)) if (typeof v === 'number' && !Number.isFinite(v)) return invalid({ [k]: 'validation.invalid' });
  return ok(asEstimate(estimate));
}

/** Energy of an activity in kcal: MET x body weight (kg) x hours. */
export function estimateActivityKcal(met: number, weightKg: number, durationMin: number): Result<Estimate<{ kcal: number }>> {
  const issues: Issues = {};
  checkNumber(issues, 'met', met, 1, 25);
  checkNumber(issues, 'weightKg', weightKg, LIMITS.weightKg.min, LIMITS.weightKg.max);
  checkNumber(issues, 'durationMin', durationMin, 0, 1440);
  if (Object.keys(issues).length) return invalid(issues);
  return ok(asEstimate({ kcal: Math.round(met * weightKg * (durationMin / 60) * 10) / 10 }));
}

/**
 * Estimated one-rep max (Epley: w x (1 + reps / 30); exactly the lifted weight for 1 rep), in kg rounded to 0.1. Only meaningful for 1..12 reps; more reps
 * (or fractional/zero reps) is an `outOfRange` issue rather than a misleadingly precise number.
 */
export function estimateOneRepMax(weightKg: number, reps: number): Result<Estimate<{ kg: number }>> {
  const issues: Issues = {};
  checkNumber(issues, 'weightKg', weightKg, 0.1, 1000);
  checkNumber(issues, 'reps', reps, 1, MAX_1RM_REPS, true);
  if (Object.keys(issues).length) return invalid(issues);
  const kg = reps === 1 ? weightKg : weightKg * (1 + reps / 30); // a single rep IS the max; Epley would overstate it by 3 %
  return ok(asEstimate({ kg: Math.round(kg * 10) / 10 }));
}
