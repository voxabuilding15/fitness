import { EXERCISE_LIBRARY, EXERCISE_LIBRARY_VERSION, SEED_PACK } from '../../data/exerciseLibrary';
import { seedPackSchema } from '../../db/seedRunner';
import { exerciseNameKey, normalizeForSearch } from '../../domain/exerciseLibrary';
import { EQUIPMENT, EXERCISE_CATEGORY, MUSCLE, TRACKING_TYPE } from '../../domain/schemas/enums';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';

const nameOf = (messages: { exercises: Record<string, string> }, id: string) => messages.exercises[id];
const slugs = SEED_PACK.exercises!.map((e) => e.slug);

describe('the built-in exercise library (content checks)', () => {
  it('is a valid seed pack', () => {
    expect(seedPackSchema.safeParse(SEED_PACK).success).toBe(true);
    expect(SEED_PACK.version).toBe(EXERCISE_LIBRARY_VERSION);
  });
  it('has unique ids and unique snake_case slugs that map back to the same translation key', () => {
    const ids = EXERCISE_LIBRARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const e of EXERCISE_LIBRARY) {
      const slug = slugs[ids.indexOf(e.id)];
      expect(slug).toMatch(/^[a-z0-9_]{2,60}$/);
      expect(exerciseNameKey(slug)).toBe(`exercises.${e.id}`);
    }
  });
  it('every exercise has a non-empty name in BOTH languages, and the Arabic name is written in Arabic', () => {
    for (const e of EXERCISE_LIBRARY) {
      const n = nameOf(en, e.id);
      const a = nameOf(ar, e.id);
      expect({ id: e.id, en: !!n?.trim() }).toEqual({ id: e.id, en: true });
      expect({ id: e.id, ar: !!a?.trim() }).toEqual({ id: e.id, ar: true });
      expect({ id: e.id, arabicLetters: /[؀-ۿ]/.test(a) }).toEqual({ id: e.id, arabicLetters: true });
      expect(n.length).toBeLessThanOrEqual(60); // must also fit a custom-name sized field
      expect(a.length).toBeLessThanOrEqual(60);
    }
  });
  it('no two built-in exercises share a name in the same language (searching and duplicate checks stay unambiguous)', () => {
    for (const messages of [en, ar]) {
      const names = EXERCISE_LIBRARY.map((e) => normalizeForSearch(nameOf(messages, e.id)));
      expect(new Set(names).size).toBe(names.length);
    }
  });
  it('only uses values the database accepts, and a secondary muscle is never the primary one (no duplicates, at most 5)', () => {
    for (const e of EXERCISE_LIBRARY) {
      expect(EXERCISE_CATEGORY).toContain(e.category);
      expect(MUSCLE).toContain(e.primaryMuscle);
      expect(EQUIPMENT).toContain(e.equipment);
      expect(TRACKING_TYPE).toContain(e.trackingType);
      expect(e.secondaryMuscles).not.toContain(e.primaryMuscle);
      expect(new Set(e.secondaryMuscles).size).toBe(e.secondaryMuscles.length);
      expect(e.secondaryMuscles.length).toBeLessThanOrEqual(5);
    }
  });
  it('is internally consistent: weights need equipment, cardio is not logged by weight, mobility is timed', () => {
    for (const e of EXERCISE_LIBRARY) {
      if (e.trackingType === 'weight_reps') expect({ id: e.id, eq: e.equipment }).not.toEqual({ id: e.id, eq: 'bodyweight' });
      if (e.category === 'cardio') expect({ id: e.id, t: e.trackingType }).not.toEqual({ id: e.id, t: 'weight_reps' });
      if (e.category === 'mobility') expect(e.trackingType).toBe('duration');
    }
  });
  it('covers every muscle group, every category and a useful range of equipment', () => {
    for (const m of MUSCLE) expect({ m, n: EXERCISE_LIBRARY.some((e) => e.primaryMuscle === m) }).toEqual({ m, n: true });
    for (const c of EXERCISE_CATEGORY) expect(EXERCISE_LIBRARY.some((e) => e.category === c)).toBe(true);
    expect(new Set(EXERCISE_LIBRARY.map((e) => e.equipment)).size).toBeGreaterThanOrEqual(6);
    expect(EXERCISE_LIBRARY.length).toBeGreaterThanOrEqual(60);
  });
  it('ships no MET values, instructions or images (nothing unverified is presented as fact)', () => {
    for (const e of SEED_PACK.exercises!) expect(Object.keys(e).sort()).toEqual(['category', 'equipment', 'primaryMuscle', 'secondaryMuscles', 'slug', 'trackingType']);
  });
  it('the enum label tables cover every value in both languages', () => {
    for (const messages of [en, ar]) {
      for (const m of MUSCLE) expect((messages.library.muscles as Record<string, string>)[m]).toBeTruthy();
      for (const q of EQUIPMENT) expect((messages.library.equipmentNames as Record<string, string>)[q]).toBeTruthy();
      for (const c of EXERCISE_CATEGORY) expect((messages.library.categories as Record<string, string>)[c]).toBeTruthy();
      for (const t of TRACKING_TYPE) expect((messages.library.trackingTypes as Record<string, string>)[t]).toBeTruthy();
    }
  });
});
