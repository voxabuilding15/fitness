import type { Profile } from '../../domain/models';
import { formFromSnapshot, planProfileSave, profileView, type ProfileForm, type ProfileSnapshot } from '../../domain/profileDraft';

const TODAY = '2026-10-21';
const profile = (over: Partial<Profile> = {}): Profile => ({
  displayName: 'Sam', location: 'Rabat', sex: 'female', ageYears: 28, ageSetOn: '2026-10-01', heightCm: 165, activityLevel: 'light', undatedWeightKg: null, updatedAt: 1, ...over,
});
const snap = (p: Profile | null, w: ProfileSnapshot['latestWeight'] = null): ProfileSnapshot => ({ profile: p, latestWeight: w, today: TODAY });
const issues = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { issues: Record<string, string> }).issues);
const plan = (r: { ok: boolean; value?: unknown; error?: unknown }) => {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value as { profile: Record<string, unknown>; weightKg: number | null };
};

describe('what the Profile tab shows', () => {
  it('no profile: an empty state, nothing made up', () => {
    expect(profileView(snap(null))).toEqual({ hasProfile: false, name: null, location: null, age: null, heightCm: null, weight: null });
  });
  it('a fresh age and weight are marked fresh', () => {
    const v = profileView(snap(profile(), { weightKg: 61.5, localDate: '2026-10-15' }));
    expect(v.age).toEqual({ value: 28, on: '2026-10-01', staleness: 'fresh' });
    expect(v.weight).toEqual({ value: 61.5, on: '2026-10-15', staleness: 'fresh' });
  });
  it('old, undated and future-dated values are labelled as such, not shown as current', () => {
    expect(profileView(snap(profile({ ageSetOn: '2024-01-01' }))).age?.staleness).toBe('old');
    expect(profileView(snap(profile({ ageSetOn: null }))).age).toEqual({ value: 28, on: null, staleness: 'unknown_date' });
    expect(profileView(snap(profile({ ageSetOn: '2026-12-01' }))).age?.staleness).toBe('future_date');
    expect(profileView(snap(profile(), { weightKg: 70, localDate: '2026-01-01' })).weight?.staleness).toBe('old');
  });
  it('a weight carried over from the old profile has no date; a dated weight entry outranks it', () => {
    expect(profileView(snap(profile({ undatedWeightKg: 52 }))).weight).toEqual({ value: 52, on: null, staleness: 'unknown_date' });
    expect(profileView(snap(profile({ undatedWeightKg: 52 }), { weightKg: 61, localDate: '2026-10-20' })).weight).toEqual({ value: 61, on: '2026-10-20', staleness: 'fresh' });
  });
});

describe('the edit form never presents an old or undated value as current', () => {
  it('fresh values fill the form', () => {
    expect(formFromSnapshot(snap(profile(), { weightKg: 61.5, localDate: '2026-10-15' }))).toEqual({
      form: { name: 'Sam', location: 'Rabat', age: '28', height: '165', weight: '61.5' }, hints: { age: null, weight: null },
    });
  });
  it('an undated age and weight (from the old profile) start EMPTY with a hint that says the date is unknown', () => {
    const s = formFromSnapshot(snap(profile({ ageSetOn: null, undatedWeightKg: 52 })));
    expect(s.form).toMatchObject({ age: '', weight: '', height: '165' });
    expect(s.hints.age).toEqual({ value: '28', on: null, reason: 'unknown_date' });
    expect(s.hints.weight).toEqual({ value: '52', on: null, reason: 'unknown_date' });
  });
  it('an old age or weight starts empty with the stored value and date in the hint', () => {
    const s = formFromSnapshot(snap(profile({ ageSetOn: '2025-01-02' }), { weightKg: 70, localDate: '2026-01-05' }));
    expect(s.form).toMatchObject({ age: '', weight: '' });
    expect(s.hints.age).toEqual({ value: '28', on: '2025-01-02', reason: 'old' });
    expect(s.hints.weight).toEqual({ value: '70', on: '2026-01-05', reason: 'old' });
  });
  it('an empty profile gives an empty form', () => {
    expect(formFromSnapshot(snap(null))).toEqual({ form: { name: '', location: '', age: '', height: '', weight: '' }, hints: { age: null, weight: null } });
  });
});

describe('what saving writes', () => {
  const fresh = snap(profile(), { weightKg: 61.5, localDate: '2026-10-15' });
  const start = (s = fresh) => formFromSnapshot(s).form;
  const edit = (patch: Partial<ProfileForm>, s = fresh) => planProfileSave({ ...start(s), ...patch }, start(s), s);

  it('changing only the name writes the same age (so its date is kept), logs no weight, and passes sex / activity through', () => {
    expect(plan(edit({ name: 'Samira' }))).toEqual({
      profile: { displayName: 'Samira', location: 'Rabat', sex: 'female', activityLevel: 'light', ageYears: 28, heightCm: 165 }, weightKg: null,
    });
  });
  it('a changed age is flagged as entered now; the same age re-typed is not', () => {
    expect(plan(edit({ age: '29' })).profile).toMatchObject({ ageYears: 29, ageConfirmed: true });
    expect(plan(edit({ age: '28' })).profile).not.toHaveProperty('ageConfirmed');
  });
  it('a changed weight is logged (rounded to 0.1); an unchanged one is not', () => {
    expect(plan(edit({ weight: '62,26' })).weightKg).toBe(62.3);
    expect(plan(edit({ weight: '61.5' })).weightKg).toBeNull();
  });
  it('an OLD or UNDATED age typed again counts as a new, confirmed entry (it was not in the form)', () => {
    const old = snap(profile({ ageSetOn: null, undatedWeightKg: 52 }));
    const r = plan(planProfileSave({ ...start(old), age: '28', weight: '52' }, start(old), old));
    expect(r.profile).toMatchObject({ ageYears: 28, ageConfirmed: true });
    expect(r.weightKg).toBe(52); // typed weight is logged as a dated entry for today
  });
  it('leaving an old / undated age and weight empty keeps them exactly as they are', () => {
    const old = snap(profile({ ageSetOn: null, undatedWeightKg: 52 }));
    const r = plan(planProfileSave({ ...start(old), name: 'Sam B' }, start(old), old));
    expect(r.profile).toMatchObject({ displayName: 'Sam B', ageYears: 28 }); // same value -> repository keeps the unknown date
    expect(r.profile).not.toHaveProperty('ageConfirmed');
    expect(r.weightKg).toBeNull();
  });
  it('creating a first profile: only the name is required; nothing else is made up', () => {
    const empty = snap(null);
    expect(plan(planProfileSave({ ...start(empty), name: '  Sam  ' }, start(empty), empty))).toEqual({ profile: { displayName: 'Sam' }, weightKg: null });
    expect(issues(planProfileSave(start(empty), start(empty), empty))).toEqual({ name: 'validation.nameRequired' });
  });
  it('validation names each bad field', () => {
    expect(issues(edit({ name: '', age: '9', height: '99', weight: '19', location: 'x'.repeat(61) }))).toEqual({
      name: 'validation.nameRequired', location: 'validation.locationTooLong', age: 'validation.ageRange', height: 'validation.heightRange', weight: 'validation.weightRangeKg',
    });
    expect(issues(edit({ name: 'x'.repeat(41) }))).toEqual({ name: 'validation.nameTooLong' });
    expect(issues(edit({ age: '30.5' }))).toEqual({ age: 'validation.ageRange' });
  });
  it('ambiguous or unreadable numbers are reported, never guessed', () => {
    expect(issues(edit({ weight: '1,500' }))).toEqual({ weight: 'validation.ambiguousNumber' });
    expect(issues(edit({ height: 'tall' }))).toEqual({ height: 'validation.invalid' });
    expect(issues(edit({ age: '1.500' }))).toEqual({ age: 'validation.ambiguousNumber' });
  });
  it('accepts the exact range limits', () => {
    expect(plan(edit({ age: '10' })).profile).toMatchObject({ ageYears: 10 });
    expect(plan(edit({ age: '100' })).profile).toMatchObject({ ageYears: 100 });
    expect(plan(edit({ height: '100' })).profile).toMatchObject({ heightCm: 100 });
    expect(plan(edit({ height: '250' })).profile).toMatchObject({ heightCm: 250 });
    expect(plan(edit({ weight: '20' })).weightKg).toBe(20);
    expect(plan(edit({ weight: '500' })).weightKg).toBe(500);
  });
  it('clearing the location clears it; clearing age / height / weight leaves them as they are', () => {
    const r = plan(edit({ location: '', age: '', height: '', weight: '' }));
    expect(r.profile).not.toHaveProperty('location');
    expect(r.profile).toMatchObject({ ageYears: 28, heightCm: 165 });
    expect(r.weightKg).toBeNull();
  });
});
