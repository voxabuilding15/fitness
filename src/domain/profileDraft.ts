import { AGE_MAX_AGE_DAYS, WEIGHT_MAX_AGE_DAYS, freshness, type SavedHint } from './goalsDraft';
import type { Profile } from './models';
import { NUMBER_ISSUE_KEY, parseNumber } from './numberText';
import { err, ok, type Result } from './result';
import type { ProfileInput } from './schemas/inputs';

/**
 * Pure logic of the Profile tab: what to show, what the edit form starts with, and what saving writes.
 *
 * Principles (shared with the Goals screen):
 *  - nothing is invented: a person without a profile sees an empty state, never made-up values;
 *  - a stored age or weight is shown together with how old it is, and an OLD or UNDATED value is not put into the edit form
 *    as if it were current - the field starts empty with a note and must be typed again;
 *  - saving writes only what the person actually changed: an unchanged age keeps its stored date (which may be "unknown"),
 *    an unchanged weight is not logged again, and an empty field means "leave as it is" (not "erase").
 */
export interface ProfileSnapshot {
  profile: Profile | null;
  latestWeight: { weightKg: number; localDate: string } | null;
  /** The device's local date. */
  today: string;
}

export type Staleness = 'fresh' | 'old' | 'unknown_date' | 'future_date';
export interface DatedValue {
  value: number;
  /** When it was entered, or null when that is not known. */
  on: string | null;
  staleness: Staleness;
}
export interface ProfileView {
  hasProfile: boolean;
  name: string | null;
  location: string | null;
  age: DatedValue | null;
  heightCm: number | null;
  weight: DatedValue | null;
}

const dated = (value: number, on: string | null, today: string, maxDays: number): DatedValue => ({ value, on, staleness: freshness(on, today, maxDays) });

/** What the Profile tab shows. Weight prefers the latest dated entry; a carried-over weight of unknown date is the fallback. */
export function profileView({ profile, latestWeight, today }: ProfileSnapshot): ProfileView {
  let weight: DatedValue | null = null;
  if (latestWeight) weight = dated(latestWeight.weightKg, latestWeight.localDate, today, WEIGHT_MAX_AGE_DAYS);
  else if (profile?.undatedWeightKg != null) weight = { value: profile.undatedWeightKg, on: null, staleness: 'unknown_date' };
  return {
    hasProfile: profile !== null,
    name: profile?.displayName ?? null,
    location: profile?.location ?? null,
    age: profile?.ageYears != null ? dated(profile.ageYears, profile.ageSetOn, today, AGE_MAX_AGE_DAYS) : null,
    heightCm: profile?.heightCm ?? null,
    weight,
  };
}

export interface ProfileForm {
  name: string;
  location: string;
  age: string;
  height: string;
  weight: string;
}
export type ProfileFormField = keyof ProfileForm;
export type ProfileIssues = Partial<Record<ProfileFormField, string>>;

export interface ProfileFormStart {
  form: ProfileForm;
  /** Stored values that were left OUT of the form because they are old, undated or dated in the future. */
  hints: { age: SavedHint | null; weight: SavedHint | null };
}

const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const hintOf = (v: DatedValue): SavedHint | null =>
  v.staleness === 'fresh' ? null : { value: String(v.value), on: v.on, reason: v.staleness };

/** The values the edit form starts with: fresh ones filled in; old / undated / future-dated age and weight left empty, with a hint. */
export function formFromSnapshot(snapshot: ProfileSnapshot): ProfileFormStart {
  const v = profileView(snapshot);
  return {
    form: {
      name: v.name ?? '',
      location: v.location ?? '',
      age: v.age && v.age.staleness === 'fresh' ? text(v.age.value) : '',
      height: text(v.heightCm),
      weight: v.weight && v.weight.staleness === 'fresh' ? text(v.weight.value) : '',
    },
    hints: { age: v.age ? hintOf(v.age) : null, weight: v.weight ? hintOf(v.weight) : null },
  };
}

export interface ProfileSavePlan {
  profile: ProfileInput;
  /** A new weight to log for today, or null when the weight was not changed. */
  weightKg: number | null;
}

const numberField = (raw: string, min: number, max: number, integer: boolean, rangeKey: string): { value?: number; issue?: string } => {
  const n = parseNumber(raw);
  if (!n.ok) return { issue: NUMBER_ISSUE_KEY[n.reason] };
  if (n.value < min || n.value > max || (integer && !Number.isInteger(n.value))) return { issue: rangeKey };
  return { value: n.value };
};

/**
 * Validates the form and works out what to write. `start` is what the form began with (to tell "changed" from "left alone").
 * The name is required and is never made up; everything else is optional.
 */
export function planProfileSave(form: ProfileForm, start: ProfileForm, snapshot: ProfileSnapshot): Result<ProfileSavePlan> {
  const issues: ProfileIssues = {};
  const stored = snapshot.profile;

  const name = form.name.trim();
  if (!name) issues.name = 'validation.nameRequired';
  else if (name.length > 40) issues.name = 'validation.nameTooLong';
  const location = form.location.trim();
  if (location.length > 60) issues.location = 'validation.locationTooLong';

  // age: typed -> that age (dated today because the person just entered it); empty -> unchanged
  let ageYears = stored?.ageYears ?? undefined;
  let ageConfirmed = false;
  if (form.age.trim() !== '') {
    const a = numberField(form.age, 10, 100, true, 'validation.ageRange');
    if (a.issue) issues.age = a.issue;
    else {
      ageYears = a.value;
      ageConfirmed = form.age.trim() !== start.age.trim(); // re-typing the shown (fresh) age is not a new confirmation
    }
  }
  let heightCm = stored?.heightCm ?? undefined;
  if (form.height.trim() !== '') {
    const h = numberField(form.height, 100, 250, false, 'validation.heightRange');
    if (h.issue) issues.height = h.issue;
    else heightCm = h.value;
  }
  let weightKg: number | null = null;
  if (form.weight.trim() !== '') {
    const w = numberField(form.weight, 20, 500, false, 'validation.weightRangeKg');
    if (w.issue) issues.weight = w.issue;
    else if (form.weight.trim() !== start.weight.trim()) weightKg = Math.round(w.value! * 10) / 10; // only a CHANGED weight is logged
  }

  if (Object.keys(issues).length) return err({ kind: 'validation', issues: issues as Record<string, string> });
  const profile: ProfileInput = {
    displayName: name,
    ...(location ? { location } : {}),
    ...(stored?.sex ? { sex: stored.sex } : {}), // this screen does not edit sex / activity level; they are passed through untouched
    ...(stored?.activityLevel ? { activityLevel: stored.activityLevel } : {}),
    ...(ageYears !== undefined ? { ageYears } : {}),
    ...(ageConfirmed ? { ageConfirmed: true } : {}),
    ...(heightCm !== undefined ? { heightCm } : {}),
  };
  return ok({ profile, weightKg });
}
