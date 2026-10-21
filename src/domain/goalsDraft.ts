import {
  DEFAULT_ADJUSTMENT_PCT, estimateGoals, type Estimate, type EstimateLimit, type GoalEstimate,
} from './calculators';
import { isValidLocalDate } from './dates';
import type { Goals, Profile } from './models';
import { NUMBER_ISSUE_KEY, parseNumber, parseNumberText } from './numberText';
import { err, ok, type Result } from './result';
import { goalsInput, parseInput } from './schemas';
import type { ActivityLevel, GoalType, Sex } from './schemas/enums';
import type { GoalsInput } from './schemas/inputs';

/**
 * The Goals screen's form logic, kept pure so it can be tested without React or a database.
 * Everything the user types is a string; nothing is defaulted on their behalf except what the approved decisions fix
 * (goal type `maintain`, the 20 % / 10 % starting adjustments). Body measurements, sex, activity level and the weekly
 * workout target are NEVER guessed: until they are provided the calculation reports them as missing.
 */
export const TARGET_FIELDS = ['kcal', 'proteinG', 'carbsG', 'fatG', 'water'] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];
export type DraftIssues = Record<string, string>;

/** Re-exported for existing callers; see numberText.ts for the rules (ambiguous input such as "1,500" is rejected, not guessed). */
export { parseNumberText };

/** The weekly workout target choices. They are the whole range the goals schema stores (0-14) so a stored value is always selectable. */
export const WEEKLY_TARGET_CHOICES: readonly number[] = Array.from({ length: 15 }, (_, i) => i);

/**
 * How old a stored value may be and still be used to prefill an estimate input.
 *  - age: the profile stores the age as entered plus the local date it was entered on (`ageSetOn`). After a year it has
 *    certainly changed, and the birthday is unknown, so the age is not recomputed - the person is asked for the current one.
 *  - weight: body weight changes; the latest weight entry is used only if it is at most 30 days old.
 */
export const AGE_MAX_AGE_DAYS = 365;
export const WEIGHT_MAX_AGE_DAYS = 30;

export type SavedHintReason = 'old' | 'unknown_date' | 'future_date';
/** A stored value that was NOT used for prefill because its date says it cannot be trusted as current. */
export interface SavedHint {
  value: string;
  on: string | null;
  reason: SavedHintReason;
}

const dayNumber = (localDate: string) => {
  const [y, m, d] = localDate.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
/** 'fresh' when the stored value may be used; otherwise why not. `today` is the device's local date. */
export function freshness(on: string | null, today: string, maxAgeDays: number): 'fresh' | SavedHintReason {
  if (on === null || !isValidLocalDate(on) || !isValidLocalDate(today)) return 'unknown_date';
  const age = dayNumber(today) - dayNumber(on);
  if (age < 0) return 'future_date';
  return age > maxAgeDays ? 'old' : 'fresh';
}
export interface GoalsDraft {
  // inputs for the estimate (used for the calculation only; they are not saved by the Goals screen)
  sex: Sex | null;
  age: string;
  heightCm: string;
  weightKg: string;
  activityLevel: ActivityLevel | null;
  goalType: GoalType;
  /** Percent change from TDEE for lose_fat / build_muscle (text); unused for maintain. */
  adjustmentPct: string;
  // the goals themselves
  weeklyWorkoutTarget: number | null;
  kcal: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  water: string;
  /** Targets that are still exactly the calculated estimate (editing a value removes it from here). */
  estimated: Partial<Record<TargetField, true>>;
  /** Targets the user changed after they had been calculated ("Edited": not a fresh calculation). Cleared by a new calculation. */
  edited: Partial<Record<TargetField, true>>;
  /** The inputs changed after the estimate was calculated, so the shown estimate no longer matches them. */
  stale: boolean;
  /** What the last calculation had to do to stay inside the allowed ranges (null until something was calculated here). */
  estimateInfo: { bmrFloorApplied: boolean; limits: EstimateLimit[] } | null;
  /** Fields the user has changed in this session; database prefill never overwrites them (see mergePrefill). */
  touched: Partial<Record<string, true>>;
  /** Carried through unchanged so saving the goals never erases a target weight set elsewhere. */
  targetWeightKg: number | null;
  /** Stored age / weight that were too old (or undated) to prefill, shown to the person instead of being used silently. */
  savedHints: { age: SavedHint | null; weightKg: SavedHint | null };
}

export const newDraft = (): GoalsDraft => ({
  sex: null, age: '', heightCm: '', weightKg: '', activityLevel: null,
  goalType: 'maintain', adjustmentPct: '',
  weeklyWorkoutTarget: null, kcal: '', proteinG: '', carbsG: '', fatG: '', water: '',
  estimated: {}, edited: {}, stale: false, estimateInfo: null, touched: {}, targetWeightKg: null,
  savedHints: { age: null, weightKg: null },
});

const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const defaultAdjustment = (g: GoalType) => (g === 'maintain' ? '' : String(DEFAULT_ADJUSTMENT_PCT[g]));

/**
 * Starting state: saved goals (if any) plus whatever the database already knows about the person. Read-only inputs, nothing invented.
 * `today` is the device's local date. A stored age or weight whose date is too old, missing or in the future is NOT filled in;
 * it is kept in `savedHints` so the screen can say so.
 */
export function draftFromSaved(saved: {
  goals: Goals | null;
  profile: Profile | null;
  latestWeight: { weightKg: number; localDate: string } | null;
  today: string;
}): GoalsDraft {
  const { goals, profile, latestWeight, today } = saved;
  const d = newDraft();
  if (profile) {
    d.sex = profile.sex;
    d.heightCm = text(profile.heightCm);
    d.activityLevel = profile.activityLevel;
    if (profile.ageYears !== null) {
      const f = freshness(profile.ageSetOn, today, AGE_MAX_AGE_DAYS);
      if (f === 'fresh') d.age = text(profile.ageYears);
      else d.savedHints.age = { value: String(profile.ageYears), on: profile.ageSetOn, reason: f };
    }
  }
  if (latestWeight) {
    const f = freshness(latestWeight.localDate, today, WEIGHT_MAX_AGE_DAYS);
    if (f === 'fresh') d.weightKg = text(latestWeight.weightKg);
    else d.savedHints.weightKg = { value: String(latestWeight.weightKg), on: latestWeight.localDate, reason: f };
  }  else if (profile?.undatedWeightKg != null) {
    // carried over from the old profile, which never recorded when it was typed: shown to the person, never used as current
    d.savedHints.weightKg = { value: String(profile.undatedWeightKg), on: null, reason: 'unknown_date' };
  }
  if (goals) {
    d.goalType = goals.goalType;
    d.adjustmentPct = defaultAdjustment(goals.goalType);
    d.weeklyWorkoutTarget = goals.weeklyWorkoutTarget;
    d.kcal = text(goals.kcalTarget);
    d.proteinG = text(goals.proteinG);
    d.carbsG = text(goals.carbsG);
    d.fatG = text(goals.fatG);
    d.water = text(goals.waterMlTarget);
    d.targetWeightKg = goals.targetWeightKg;
    if (goals.source === 'calculated') for (const f of TARGET_FIELDS) if (d[f] !== '') d.estimated[f] = true;
  }
  return d;
}

/** The "not filled in because it is old" notes still relevant: only for fields the person has not typed into since. */
export function visibleHints(d: GoalsDraft): { age: SavedHint | null; weightKg: SavedHint | null } {
  return { age: d.touched.age ? null : d.savedHints.age, weightKg: d.touched.weightKg ? null : d.savedHints.weightKg };
}

type InputPatch = Partial<Pick<GoalsDraft, 'sex' | 'age' | 'heightCm' | 'weightKg' | 'activityLevel' | 'goalType' | 'adjustmentPct'>>;

const hasEstimate = (d: GoalsDraft) => TARGET_FIELDS.some((f) => d.estimated[f]);

/** Changes an input of the estimate. If an estimate is on screen it is now out of date (it stays visible, flagged stale). */
export function setInputs(d: GoalsDraft, patch: InputPatch): GoalsDraft {
  const next = { ...d, ...patch };
  if (patch.goalType && patch.goalType !== d.goalType) next.adjustmentPct = defaultAdjustment(patch.goalType);
  const touched = { ...d.touched };
  for (const k of Object.keys(patch)) touched[k] = true;
  if (patch.goalType) touched.adjustmentPct = true; // the goal type and its adjustment are one choice
  next.touched = touched;
  next.stale = d.stale || (hasEstimate(d) && Object.keys(patch).length > 0);
  return next;
}

/** Editing a target makes it the user's own goal: it is no longer a plain estimate, and is shown as "Edited" if it had been calculated. */
export function setTarget(d: GoalsDraft, field: TargetField, value: string): GoalsDraft {
  const estimated = { ...d.estimated };
  const edited = { ...d.edited };
  if (estimated[field]) edited[field] = true;
  delete estimated[field];
  return { ...d, [field]: value, estimated, edited, touched: { ...d.touched, [field]: true } };
}

export const setWeeklyTarget = (d: GoalsDraft, n: number | null): GoalsDraft => ({ ...d, weeklyWorkoutTarget: n, touched: { ...d.touched, weeklyWorkoutTarget: true } });

/**
 * Applies what the database holds to a draft that may already contain the user's typing (for example after a retry
 * following "unavailable"). Only fields the user has not touched are taken from `loaded`; nothing they entered is lost.
 * The target weight is not editable on this screen, so it always comes from the database.
 */
export function mergePrefill(current: GoalsDraft, loaded: GoalsDraft): GoalsDraft {
  const t = current.touched;
  const out: GoalsDraft = { ...current, targetWeightKg: loaded.targetWeightKg };
  if (!t.sex) out.sex = loaded.sex;
  if (!t.age) {
    out.age = loaded.age;
    out.savedHints = { ...out.savedHints, age: loaded.savedHints.age };
  }
  if (!t.heightCm) out.heightCm = loaded.heightCm;
  if (!t.weightKg) {
    out.weightKg = loaded.weightKg;
    out.savedHints = { ...out.savedHints, weightKg: loaded.savedHints.weightKg };
  }
  if (!t.activityLevel) out.activityLevel = loaded.activityLevel;
  if (!t.goalType && !t.adjustmentPct) {
    out.goalType = loaded.goalType;
    out.adjustmentPct = loaded.adjustmentPct;
  }
  if (!t.weeklyWorkoutTarget) out.weeklyWorkoutTarget = loaded.weeklyWorkoutTarget;
  const estimated = { ...current.estimated };
  for (const f of TARGET_FIELDS) {
    if (t[f]) continue;
    out[f] = loaded[f];
    if (loaded.estimated[f]) estimated[f] = true;
    else delete estimated[f];
  }
  out.estimated = estimated;
  return out;
}

export type Badge = 'estimate' | 'outdated' | 'edited' | 'preliminary';
/**
 * The provenance labels a target shows. Water is ALWAYS a "preliminary estimate" (it is a rule of thumb, whoever typed
 * the number); other targets are an "estimate" while exactly as calculated, "outdated" if their inputs changed since,
 * and "edited" once the user changed a calculated value (so an edited value never looks like a fresh calculation).
 */
export function fieldBadges(d: GoalsDraft, field: TargetField): Badge[] {
  const out: Badge[] = [];
  if (field === 'water') out.push('preliminary');
  if (d.estimated[field]) {
    if (d.stale) out.push('outdated');
    else if (field !== 'water') out.push('estimate');
  }
  if (d.edited[field]) out.push('edited');
  return out;
}

/** What saving would store as the goals' source: only an untouched, up-to-date calculation counts as "calculated". */
export function saveSource(d: GoalsDraft): 'calculated' | 'manual' {
  const allEstimated = TARGET_FIELDS.every((f) => d.estimated[f] && d[f] !== '');
  return allEstimated && !d.stale ? 'calculated' : 'manual';
}

const BODY_TO_DRAFT: Record<string, string> = {
  sex: 'sex', ageYears: 'age', heightCm: 'heightCm', weightKg: 'weightKg', activityLevel: 'activityLevel', goalType: 'goalType', adjustmentPct: 'adjustmentPct',
  kcalTarget: 'estimate', // the "calorie need is outside what the app can store" conflict is about the estimate as a whole
};

/** Calculates the estimate from the draft's inputs. Missing / unparsable fields are reported by field name; nothing is assumed. */
export function calculateEstimate(d: GoalsDraft): Result<Estimate<GoalEstimate>> {
  const issues: DraftIssues = {};
  const num = (field: 'age' | 'heightCm' | 'weightKg') => {
    const n = parseNumber(d[field]);
    if (!n.ok) {
      issues[field] = NUMBER_ISSUE_KEY[n.reason];
      return undefined;
    }
    return n.value;
  };
  const ageYears = num('age');
  const heightCm = num('heightCm');
  const weightKg = num('weightKg');
  let adjustmentPct: number | undefined;
  if (d.goalType !== 'maintain') {
    const n = parseNumber(d.adjustmentPct); // an emptied field is reported, not silently replaced by the default
    if (n.ok) adjustmentPct = n.value;
    else issues.adjustmentPct = NUMBER_ISSUE_KEY[n.reason];
  }
  const r = estimateGoals({ sex: d.sex, ageYears, heightCm, weightKg, activityLevel: d.activityLevel, goalType: d.goalType, adjustmentPct });
  if (r.ok && Object.keys(issues).length === 0) return r;
  const merged: DraftIssues = { ...issues };
  if (!r.ok && r.error.kind === 'validation') {
    for (const [k, v] of Object.entries(r.error.issues)) {
      const key = BODY_TO_DRAFT[k] ?? k;
      if (!merged[key]) merged[key] = v;
    }
  }
  return err({ kind: 'validation', issues: merged });
}

/** Shows an estimate in the form: all five targets are filled and flagged as estimates. */
export function applyEstimate(d: GoalsDraft, e: GoalEstimate): GoalsDraft {
  return {
    ...d,
    kcal: String(e.kcalTarget), proteinG: String(e.proteinG), carbsG: String(e.carbsG), fatG: String(e.fatG), water: String(e.waterMlTarget),
    estimated: { kcal: true, proteinG: true, carbsG: true, fatG: true, water: true },
    edited: {},
    stale: false,
    estimateInfo: { bmrFloorApplied: e.bmrFloorApplied, limits: [...e.limits] },
    // the numbers were calculated from exactly these inputs, so a later database prefill must not change any of them underneath the estimate
    touched: {
      ...d.touched, kcal: true, proteinG: true, carbsG: true, fatG: true, water: true,
      sex: true, age: true, heightCm: true, weightKg: true, activityLevel: true, goalType: true, adjustmentPct: true,
    },
  };
}

const TARGET_TO_SCHEMA: Record<string, string> = {
  kcalTarget: 'kcal', proteinG: 'proteinG', carbsG: 'carbsG', fatG: 'fatG', waterMlTarget: 'water', weeklyWorkoutTarget: 'weeklyWorkoutTarget',
};

/** Validates the draft for saving. Blank macro fields mean "no target"; water and the weekly workout target are required. */
export function toGoalsInput(d: GoalsDraft): Result<GoalsInput> {
  const issues: DraftIssues = {};
  const optional = (field: 'kcal' | 'proteinG' | 'carbsG' | 'fatG') => {
    if (d[field].trim() === '') return undefined;
    const n = parseNumber(d[field]);
    if (!n.ok) {
      issues[field] = NUMBER_ISSUE_KEY[n.reason];
      return undefined;
    }
    return n.value;
  };
  const kcalTarget = optional('kcal');
  const proteinG = optional('proteinG');
  const carbsG = optional('carbsG');
  const fatG = optional('fatG');
  let waterMlTarget: number | undefined;
  const water = parseNumber(d.water);
  if (water.ok) waterMlTarget = water.value;
  else issues.water = NUMBER_ISSUE_KEY[water.reason];
  if (d.weeklyWorkoutTarget === null) issues.weeklyWorkoutTarget = 'validation.required';
  if (Object.keys(issues).length) return err({ kind: 'validation', issues });

  const parsed = parseInput(goalsInput, {
    goalType: d.goalType,
    ...(d.targetWeightKg !== null ? { targetWeightKg: d.targetWeightKg } : {}),
    ...(kcalTarget !== undefined ? { kcalTarget } : {}),
    ...(proteinG !== undefined ? { proteinG } : {}),
    ...(carbsG !== undefined ? { carbsG } : {}),
    ...(fatG !== undefined ? { fatG } : {}),
    waterMlTarget,
    weeklyWorkoutTarget: d.weeklyWorkoutTarget,
    source: saveSource(d),
  });
  if (parsed.ok) return ok(parsed.value as GoalsInput);
  if (parsed.error.kind !== 'validation') return err(parsed.error);
  const mapped: DraftIssues = {};
  for (const [k, v] of Object.entries(parsed.error.issues)) mapped[TARGET_TO_SCHEMA[k] ?? k] = v;
  return err({ kind: 'validation', issues: mapped });
}
