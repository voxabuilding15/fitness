import en from '../locales/en.json';
import ar from '../locales/ar.json';
import { WORKOUTS, TODAYS_WORKOUT_ID, getWorkout } from '../data/workouts';
import { average, buildSeries, defaultSelectedIndex, statusFor } from '../services/activityService';
import { DEMO_PROFILE, toDraft, validateDraft } from '../services/profileService';
import { adjustForLevel, formatClock, matches } from '../services/workoutService';
import { initialSession, reduceSession } from '../services/workoutSession';

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('locales', () => {
  it('Arabic and English define exactly the same keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
  it('has a translation for every workout and exercise', () => {
    for (const w of WORKOUTS) {
      expect((en.workouts as Record<string, string>)[w.id]).toBeTruthy();
      for (const e of w.exercises) {
        expect((en.exercises as Record<string, string>)[e.id]).toBeTruthy();
        expect((ar.exercises as Record<string, string>)[e.id]).toBeTruthy();
      }
    }
  });
  it('keeps the interpolation placeholders aligned between languages', () => {
    const ph = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort().join();
    const flat = (o: object) => Object.fromEntries(keys(o).map((k) => [k, k.split('.').reduce((a: any, p) => a[p], o) as string]));
    const e = flat(en);
    const a = flat(ar);
    for (const k of Object.keys(e)) expect([k, ph(a[k])]).toEqual([k, ph(e[k])]);
  });
});

describe('activity data', () => {
  it('this-week step average matches the design (5,400) and is computed from the points', () => {
    const s = buildSeries('steps', 'thisWeek');
    expect(s.points.map((p) => p.labelKey)).toEqual(['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']);
    expect(s.average).toBe(5400);
    expect(s.average).toBe(average(s.points.map((p) => p.value)));
    expect(s.isDemo).toBe(true);
  });
  it('changes with metric and period', () => {
    expect(buildSeries('steps', 'lastWeek').average).not.toBe(buildSeries('steps', 'thisWeek').average);
    expect(buildSeries('heartRate', 'thisWeek').points[4].value).toBe(92);
    expect(buildSeries('steps', 'thisMonth').points).toHaveLength(4);
    const reg = buildSeries('regularity', 'thisWeek');
    expect(Math.max(...reg.points.map((p) => p.value))).toBeLessThanOrEqual(100);
  });
  it('picks sensible default selection and status', () => {
    expect(defaultSelectedIndex('thisWeek')).toBe(4);
    expect(defaultSelectedIndex('thisMonth')).toBe(3);
    expect(statusFor(5400, 7000)).toBe('good');
    expect(statusFor(312, 450)).toBe('average');
    expect(statusFor(100, 450)).toBe('low');
  });
});

describe('workouts', () => {
  it("today's workout has the 16 exercises shown in the design", () => {
    expect(getWorkout(TODAYS_WORKOUT_ID)!.exercises).toHaveLength(16);
  });
  it('scales reps by experience level', () => {
    const e = WORKOUTS[0].exercises[0]; // 12 reps
    expect(adjustForLevel(e, 'beginner').reps).toBe(9);
    expect(adjustForLevel(e, 'intermediate').reps).toBe(12);
    expect(adjustForLevel(e, 'advanced').reps).toBe(15);
  });
  it('formats clock and matches search text', () => {
    expect(formatClock(75)).toBe('01:15');
    expect(matches('Push-up', ' push')).toBe(true);
    expect(matches('Squat', 'xyz')).toBe(false);
  });
});

describe('workout session', () => {
  const plan = [{ sets: 2, restSec: 3 }, { sets: 1, restSec: 3 }];
  const run = (...actions: Parameters<typeof reduceSession>[1][]) =>
    actions.reduce((s, a) => reduceSession(s, a, plan), initialSession);

  it('only counts time while running', () => {
    expect(run({ type: 'TICK' }).elapsed).toBe(0);
    expect(run({ type: 'TOGGLE' }, { type: 'TICK' }, { type: 'TICK' }).elapsed).toBe(2);
    expect(run({ type: 'TOGGLE' }, { type: 'TICK' }, { type: 'TOGGLE' }, { type: 'TICK' }).elapsed).toBe(1);
  });
  it('walks sets, rest and exercises to completion', () => {
    let s = run({ type: 'TOGGLE' }, { type: 'COMPLETE_SET' });
    expect(s).toMatchObject({ exerciseIndex: 0, setIndex: 1, restLeft: 3 });
    s = reduceSession(s, { type: 'COMPLETE_SET' }, plan); // blocked while resting
    expect(s.setIndex).toBe(1);
    s = reduceSession(s, { type: 'SKIP_REST' }, plan);
    s = reduceSession(s, { type: 'COMPLETE_SET' }, plan);
    expect(s).toMatchObject({ exerciseIndex: 1, setIndex: 0 });
    s = reduceSession(reduceSession(s, { type: 'SKIP_REST' }, plan), { type: 'COMPLETE_SET' }, plan);
    expect(s.status).toBe('finished');
  });
  it('rest counts down on tick and reset restores the initial state', () => {
    const s = run({ type: 'TOGGLE' }, { type: 'COMPLETE_SET' }, { type: 'TICK' });
    expect(s.restLeft).toBe(2);
    expect(reduceSession(s, { type: 'RESET' }, plan)).toEqual(initialSession);
  });
});

describe('profile validation', () => {
  it('accepts the demo profile and returns typed values', () => {
    const r = validateDraft(toDraft(DEMO_PROFILE));
    expect(r.errors).toEqual({});
    expect(r.profile).toEqual(DEMO_PROFILE);
  });
  it('rejects bad input with translation keys', () => {
    const r = validateDraft({ name: ' ', location: '', age: '9', height: '99', weight: 'abc' });
    expect(r.profile).toBeUndefined();
    expect(r.errors).toEqual({
      name: 'validation.nameRequired',
      age: 'validation.ageRange',
      height: 'validation.heightRange',
      weight: 'validation.weightRange',
    });
  });
  it('accepts decimal weight and trims text', () => {
    const r = validateDraft({ name: ' Sara ', location: ' Cairo ', age: '30', height: '165', weight: '60,5' });
    expect(r.profile).toEqual({ name: 'Sara', location: 'Cairo', age: 30, heightCm: 165, weightKg: 60.5 });
  });
});

describe('persistence', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { loadProfile, saveProfile } = require('../services/profileService');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DEFAULT_SETTINGS, loadSettings, saveSettings } = require('../services/settingsService');

  it('returns demo profile / default settings before anything is saved', async () => {
    expect(await loadProfile()).toEqual(DEMO_PROFILE);
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it('round-trips a saved profile and settings (language, sound, level, reminders)', async () => {
    const p = { name: 'Lina', location: 'Amman', age: 31, heightCm: 168, weightKg: 58 };
    await saveProfile(p);
    expect(await loadProfile()).toEqual(p);
    const s = {
      ...DEFAULT_SETTINGS, language: 'ar', soundEnabled: false, experience: 'advanced',
      cautionAreas: ['knees'], reminders: { enabled: true, hour: 7, minute: 30, days: [0, 6] },
    };
    await saveSettings(s);
    expect(await loadSettings()).toEqual(s);
    // saving settings must not touch the profile
    expect(await loadProfile()).toEqual(p);
  });
});
