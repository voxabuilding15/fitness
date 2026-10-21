import en from '../locales/en.json';
import ar from '../locales/ar.json';
import { DEMO_PROFILE, toDraft, validateDraft } from '../services/profileService';

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('locales', () => {
  it('Arabic and English define exactly the same keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
  it('keeps the interpolation placeholders aligned between languages', () => {
    const ph = (s: string) => (s.match(/{{\w+}}/g) ?? []).sort().join();
    const flat = (o: object) => Object.fromEntries(keys(o).map((k) => [k, k.split('.').reduce((a: any, p) => a[p], o) as string]));
    const e = flat(en);
    const a = flat(ar);
    for (const k of Object.keys(e)) expect([k, ph(a[k])]).toEqual([k, ph(e[k])]);
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
