import type { Exercise } from '../../domain/models';
import {
  NO_FILTER, emptyExerciseForm, exerciseDisplayName, exerciseNameKey, filterExercises, findDuplicateName, formFromExercise, hasActiveFilter,
  normalizeForSearch, planExerciseSave, setPrimaryMuscle, sortExercises, toggleSecondaryMuscle, type ExerciseForm,
} from '../../domain/exerciseLibrary';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';

let nextId = 1;
const ex = (over: Partial<Exercise>): Exercise => ({
  id: nextId++, slug: null, source: 'user', customName: 'X', category: 'strength', primaryMuscle: 'chest', secondaryMuscles: [], equipment: 'barbell',
  trackingType: 'weight_reps', metValue: null, isArchived: false, createdAt: 1, ...over,
});
const lookupOf = (messages: object) => (key: string) => key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), messages) as string | undefined;
const nameEn = (e: Exercise) => exerciseDisplayName(e, lookupOf(en));
const nameAr = (e: Exercise) => exerciseDisplayName(e, lookupOf(ar));
const seed = (slug: string, over: Partial<Exercise> = {}) => ex({ source: 'seed', slug, customName: null, ...over });
const names = (list: Exercise[], f = nameEn) => list.map(f);

describe('names', () => {
  it('maps a slug to the translation key of its name', () => {
    expect(exerciseNameKey('push_up')).toBe('exercises.pushUp');
    expect(exerciseNameKey('squat')).toBe('exercises.squat');
    expect(exerciseNameKey('incline_dumbbell_press')).toBe('exercises.inclineDumbbellPress');
  });
  it('shows the translated name of a built-in exercise in each language, and a custom exercise as typed', () => {
    const s = seed('push_up');
    expect(nameEn(s)).toBe('Push-up');
    expect(nameAr(s)).toBe('تمرين الضغط');
    expect(nameEn(ex({ customName: 'My move' }))).toBe('My move');
  });
  it('a built-in exercise with no translation falls back to its spelled-out slug, never to nothing', () => {
    expect(nameEn(seed('brand_new_move'))).toBe('Brand new move');
  });
});

describe('normalizeForSearch', () => {
  it('ignores case, hyphens, punctuation and repeated spaces', () => {
    expect(normalizeForSearch('  Step-Up ')).toBe('step up');
    expect(normalizeForSearch("Child's   pose")).toBe('child s pose');
  });
  it('ignores Arabic diacritics and tatweel, and unifies alef / yaa / taa marbuta variants', () => {
    expect(normalizeForSearch('ضَغْطٌ')).toBe('ضغط');
    expect(normalizeForSearch('أرجحة')).toBe(normalizeForSearch('ارجحة'));
    expect(normalizeForSearch('إلى')).toBe(normalizeForSearch('الي'));
    expect(normalizeForSearch('السباحة')).toBe(normalizeForSearch('السباحه'));
    expect(normalizeForSearch('ضــغط')).toBe('ضغط');
  });
});

describe('filtering and sorting', () => {
  const squat = seed('squat', { primaryMuscle: 'quads', equipment: 'bodyweight' });
  const pushUp = seed('push_up', { primaryMuscle: 'chest', equipment: 'bodyweight' });
  const stepUp = seed('step_up', { primaryMuscle: 'quads', equipment: 'bodyweight' });
  const run = seed('running', { category: 'cardio', primaryMuscle: 'cardio', equipment: 'bodyweight' });
  const mine = ex({ customName: 'Zercher squat', primaryMuscle: 'quads', equipment: 'barbell' });
  const hidden = ex({ customName: 'Old curl', primaryMuscle: 'biceps', isArchived: true });
  const all = [squat, pushUp, stepUp, run, mine, hidden];

  it('no filter: everything except hidden exercises, alphabetical by the displayed name', () => {
    expect(names(filterExercises(all, NO_FILTER, nameEn))).toEqual(['Push-up', 'Running', 'Squat', 'Step-up', 'Zercher squat']);
  });
  it('the order follows the language: Arabic names sort as Arabic', () => {
    const order = names(filterExercises(all, NO_FILTER, nameAr), nameAr);
    expect(order).toEqual([...order].sort((a, b) => normalizeForSearch(a).localeCompare(normalizeForSearch(b))));
  });
  it('hidden exercises appear only when asked for', () => {
    expect(names(filterExercises(all, { ...NO_FILTER, includeHidden: true }, nameEn))).toContain('Old curl');
    expect(names(filterExercises(all, NO_FILTER, nameEn))).not.toContain('Old curl');
  });
  it('search: every word must match; case and hyphens do not matter; a part of a word is enough', () => {
    expect(names(filterExercises(all, { ...NO_FILTER, query: 'STEP up' }, nameEn))).toEqual(['Step-up']);
    expect(names(filterExercises(all, { ...NO_FILTER, query: 'squ' }, nameEn))).toEqual(['Squat', 'Zercher squat']);
    expect(names(filterExercises(all, { ...NO_FILTER, query: 'squat zerch' }, nameEn))).toEqual(['Zercher squat']);
    expect(filterExercises(all, { ...NO_FILTER, query: 'nonsense' }, nameEn)).toEqual([]);
  });
  it('search runs on the DISPLAYED name, so the same exercise is found by its Arabic name in Arabic', () => {
    expect(names(filterExercises(all, { ...NO_FILTER, query: 'ضغط' }, nameAr), nameAr)).toEqual(['تمرين الضغط']);
    expect(filterExercises(all, { ...NO_FILTER, query: 'ضغط' }, nameEn)).toEqual([]);
  });
  it('muscle, equipment and category filters are exact and combine with search', () => {
    expect(names(filterExercises(all, { ...NO_FILTER, muscle: 'quads' }, nameEn))).toEqual(['Squat', 'Step-up', 'Zercher squat']);
    expect(names(filterExercises(all, { ...NO_FILTER, muscle: 'quads', equipment: 'bodyweight' }, nameEn))).toEqual(['Squat', 'Step-up']);
    expect(names(filterExercises(all, { ...NO_FILTER, category: 'cardio' }, nameEn))).toEqual(['Running']);
    expect(names(filterExercises(all, { ...NO_FILTER, muscle: 'quads', query: 'up' }, nameEn))).toEqual(['Step-up']);
  });
  it('hasActiveFilter', () => {
    expect(hasActiveFilter(NO_FILTER)).toBe(false);
    expect(hasActiveFilter({ ...NO_FILTER, query: ' x ' })).toBe(true);
    expect(hasActiveFilter({ ...NO_FILTER, query: '   ' })).toBe(false);
    expect(hasActiveFilter({ ...NO_FILTER, includeHidden: true })).toBe(true);
  });
  it('sorting is stable for equal names and never mutates its input', () => {
    const a = ex({ customName: 'Same' });
    const b = ex({ customName: 'same' });
    const input = [b, a];
    expect(sortExercises(input, nameEn).map((e) => e.id)).toEqual([a.id, b.id].sort((x, y) => x - y));
    expect(input).toEqual([b, a]);
  });
});

describe('duplicate names', () => {
  const bench = seed('bench_press');
  const mine = ex({ customName: 'My Row' });
  const hidden = ex({ customName: 'Hidden Move', isArchived: true });
  const all = [bench, mine, hidden];
  it('finds a built-in exercise by its displayed name, ignoring spelling variants', () => {
    expect(findDuplicateName('barbell bench PRESS', all, nameEn)).toBe(bench);
  });
  it('finds custom and hidden exercises too', () => {
    expect(findDuplicateName(' my   row ', all, nameEn)).toBe(mine);
    expect(findDuplicateName('hidden move', all, nameEn)).toBe(hidden);
  });
  it('the exercise being edited does not count as its own duplicate', () => {
    expect(findDuplicateName('My Row', all, nameEn, mine.id)).toBeNull();
    expect(findDuplicateName('Something else', all, nameEn)).toBeNull();
    expect(findDuplicateName('   ', all, nameEn)).toBeNull();
  });
});

describe('the exercise form', () => {
  const filled = (over: Partial<ExerciseForm> = {}): ExerciseForm => ({
    name: 'Cable woodchop', category: 'strength', primaryMuscle: 'core', equipment: 'cable', trackingType: 'weight_reps', secondaryMuscles: ['shoulders'], ...over,
  });
  const issues = (r: { ok: boolean; error?: unknown }) => (r.ok ? null : (r.error as { issues: Record<string, string> }).issues);
  const value = (r: { ok: boolean; value?: unknown; error?: unknown }) => {
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  };

  it('starts with nothing chosen: no category, muscle, equipment or tracking type is assumed', () => {
    expect(emptyExerciseForm()).toEqual({ name: '', category: null, primaryMuscle: null, equipment: null, trackingType: null, secondaryMuscles: [] });
    expect(issues(planExerciseSave(emptyExerciseForm(), [], nameEn))).toEqual({
      name: 'validation.required', category: 'library.chooseOne', primaryMuscle: 'library.chooseOne', equipment: 'library.chooseOne', trackingType: 'library.chooseOne',
    });
  });
  it('a complete form becomes a repository input with a tidy name', () => {
    expect(value(planExerciseSave(filled({ name: '  Cable   woodchop ' }), [], nameEn))).toEqual({
      name: 'Cable woodchop', category: 'strength', primaryMuscle: 'core', equipment: 'cable', trackingType: 'weight_reps', secondaryMuscles: ['shoulders'],
    });
  });
  it('name rules: required, at most 60 characters, no duplicates', () => {
    expect(issues(planExerciseSave(filled({ name: '   ' }), [], nameEn))).toEqual({ name: 'validation.required' });
    expect(issues(planExerciseSave(filled({ name: 'x'.repeat(61) }), [], nameEn))).toEqual({ name: 'validation.tooLong' });
    expect(planExerciseSave(filled({ name: 'x'.repeat(60) }), [], nameEn).ok).toBe(true);
    const others = [seed('squat'), ex({ customName: 'Mine' })];
    expect(issues(planExerciseSave(filled({ name: 'SQUAT' }), others, nameEn))).toEqual({ name: 'library.duplicateName' });
    expect(issues(planExerciseSave(filled({ name: 'mine' }), others, nameEn))).toEqual({ name: 'library.duplicateName' });
    expect(planExerciseSave(filled({ name: 'mine' }), others, nameEn, others[1].id).ok).toBe(true); // editing it
  });
  it('the main muscle can never also be a secondary one, and at most five secondary muscles are kept', () => {
    let f = filled({ secondaryMuscles: ['shoulders', 'core'] });
    f = setPrimaryMuscle(f, 'core');
    expect(f.secondaryMuscles).toEqual(['shoulders']);
    expect(toggleSecondaryMuscle(f, 'core')).toBe(f);
    let g = filled({ secondaryMuscles: [] });
    for (const m of ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads'] as const) g = toggleSecondaryMuscle(g, m);
    expect(g.secondaryMuscles).toEqual(['chest', 'back', 'shoulders', 'biceps', 'triceps']);
    expect(toggleSecondaryMuscle(g, 'chest').secondaryMuscles).toEqual(['back', 'shoulders', 'biceps', 'triceps']);
  });
  it('a hand-built overlap is still rejected by the shared validation', () => {
    expect(issues(planExerciseSave(filled({ secondaryMuscles: ['core'] }), [], nameEn))).toEqual({ secondaryMuscles: 'validation.invalid' });
  });
  it('a copy of a built-in exercise starts from its displayed name and facts', () => {
    const s = seed('push_up', { category: 'strength', primaryMuscle: 'chest', secondaryMuscles: ['triceps', 'shoulders'], equipment: 'bodyweight', trackingType: 'reps_only' });
    expect(formFromExercise(s, nameEn)).toEqual({ name: 'Push-up', category: 'strength', primaryMuscle: 'chest', equipment: 'bodyweight', trackingType: 'reps_only', secondaryMuscles: ['triceps', 'shoulders'] });
    // saving the copy unchanged is a duplicate name: the person has to name it
    expect(issues(planExerciseSave(formFromExercise(s, nameEn), [s], nameEn))).toEqual({ name: 'library.duplicateName' });
  });
});
