import { createRepoEnv, errorOf, H, T0, unwrap, type RepoEnv } from '../../db/testing/repoEnv';

let env: RepoEnv;
beforeEach(async () => { env = await createRepoEnv(); });

describe('profile', () => {
  it('is null (not a demo profile) until the user saves one', async () => {
    expect(unwrap(await env.repos.profile.get())).toBeNull();
  });
  it('saves, reads back, and updates in place (singleton)', async () => {
    const saved = unwrap(await env.repos.profile.save({ displayName: ' Sara ', location: 'Cairo', sex: 'female', ageYears: 30, heightCm: 165, activityLevel: 'light' }));
    expect(saved).toMatchObject({ displayName: 'Sara', ageYears: 30, ageSetOn: '2026-10-21', updatedAt: T0 });
    env.clock.advance(H);
    unwrap(await env.repos.profile.save({ displayName: 'Sara A.' }));
    const again = unwrap(await env.repos.profile.get())!;
    expect(again).toMatchObject({ displayName: 'Sara A.', location: null, ageYears: null, ageSetOn: null, heightCm: null });
    expect(again.updatedAt).toBe(T0 + H);
    expect(Number((await env.db.first<{ c: number }>('SELECT count(*) c FROM profile'))!.c)).toBe(1);
  });
  it('rejects invalid input with translation keys and writes nothing', async () => {
    expect(errorOf(await env.repos.profile.save({ displayName: '', ageYears: 5 }))).toEqual({ kind: 'validation', issues: { displayName: 'validation.required', ageYears: 'validation.outOfRange' } });
    expect(unwrap(await env.repos.profile.get())).toBeNull();
  });
  it('records the age date in the device-local day, not the UTC day', async () => {
    const late = await createRepoEnv(120); // UTC+2
    late.clock.set(Date.UTC(2026, 9, 21, 23, 30));
    expect(unwrap(await late.repos.profile.save({ displayName: 'X', ageYears: 30 })).ageSetOn).toBe('2026-10-22');
  });
});

describe('goals', () => {
  const goals = { goalType: 'lose_fat', kcalTarget: 2000, proteinG: 140, waterMlTarget: 2500, weeklyWorkoutTarget: 4, source: 'calculated' } as const;
  it('is null until saved, then upserts', async () => {
    expect(unwrap(await env.repos.goals.get())).toBeNull();
    expect(unwrap(await env.repos.goals.save(goals))).toMatchObject({ goalType: 'lose_fat', kcalTarget: 2000, carbsG: null, source: 'calculated' });
    unwrap(await env.repos.goals.save({ ...goals, goalType: 'maintain', kcalTarget: undefined, source: 'manual' }));
    expect(unwrap(await env.repos.goals.get())).toMatchObject({ goalType: 'maintain', kcalTarget: null, source: 'manual' });
  });
  it('validates', async () => {
    expect(errorOf(await env.repos.goals.save({ ...goals, kcalTarget: 500 }))).toMatchObject({ kind: 'validation', issues: { kcalTarget: 'validation.outOfRange' } });
  });
});

const ex = { name: 'Cable fly', category: 'strength', primaryMuscle: 'chest', equipment: 'cable', trackingType: 'weight_reps' } as const;
const seed = (slug: string, muscle = 'chest', equipment = 'barbell') =>
  env.db.run(`INSERT INTO exercises(source,slug,category,primary_muscle,equipment,tracking_type,created_at) VALUES ('seed',?,'strength',?,?,'weight_reps',?)`, [slug, muscle, equipment, T0]);

describe('exercises', () => {
  it('creates a custom exercise and reads it back', async () => {
    const e = unwrap(await env.repos.exercises.create({ ...ex, secondaryMuscles: ['triceps'], metValue: 3.5 }));
    expect(e).toMatchObject({ source: 'user', slug: null, customName: 'Cable fly', secondaryMuscles: ['triceps'], metValue: 3.5, isArchived: false, createdAt: T0 });
    expect(unwrap(await env.repos.exercises.get(e.id))).toEqual(e);
  });
  it('list: filters, search (with LIKE wildcards escaped), archived hidden by default, stable order', async () => {
    await seed('bench_press');
    await seed('squat', 'quads');
    unwrap(await env.repos.exercises.create(ex));
    unwrap(await env.repos.exercises.create({ ...ex, name: '100% effort_row', primaryMuscle: 'back', equipment: 'barbell' }));
    const names = (r: any) => (unwrap(r) as any[]).map((e) => e.customName ?? e.slug);
    expect(names(await env.repos.exercises.list())).toEqual(['100% effort_row', 'bench_press', 'Cable fly', 'squat']);
    expect(names(await env.repos.exercises.list({ primaryMuscle: 'chest' }))).toEqual(['bench_press', 'Cable fly']);
    expect(names(await env.repos.exercises.list({ equipment: 'barbell' }))).toEqual(['100% effort_row', 'bench_press', 'squat']);
    expect(names(await env.repos.exercises.list({ search: 'fly' }))).toEqual(['Cable fly']);
    expect(names(await env.repos.exercises.list({ search: '%' }))).toEqual(['100% effort_row']); // literal %, not "match everything"
    expect(names(await env.repos.exercises.list({ search: '_' }))).toEqual(['100% effort_row', 'bench_press']); // literal underscore only
    expect(names(await env.repos.exercises.list({ search: 'nothing-matches' }))).toEqual([]);
    await env.repos.exercises.setArchived(1, true);
    expect(names(await env.repos.exercises.list())).not.toContain('bench_press');
    expect(names(await env.repos.exercises.list({ includeArchived: true }))).toContain('bench_press');
  });
  it('updates only what is named and keeps the rest (patches never reset fields)', async () => {
    const e = unwrap(await env.repos.exercises.create({ ...ex, secondaryMuscles: ['triceps', 'shoulders'], metValue: 4 }));
    const u = unwrap(await env.repos.exercises.update(e.id, { name: 'Pec fly' }));
    expect(u).toMatchObject({ customName: 'Pec fly', secondaryMuscles: ['triceps', 'shoulders'], metValue: 4 });
    expect(unwrap(await env.repos.exercises.update(e.id, { metValue: undefined })).metValue).toBe(4); // undefined = unchanged
    expect(unwrap(await env.repos.exercises.update(e.id, { metValue: null })).metValue).toBeNull(); // null = clear
  });
  it('validates the merged result (secondary muscles cannot include the primary)', async () => {
    const e = unwrap(await env.repos.exercises.create({ ...ex, secondaryMuscles: ['triceps'] }));
    expect(errorOf(await env.repos.exercises.update(e.id, { primaryMuscle: 'triceps' }))).toMatchObject({ kind: 'validation' });
    expect(unwrap(await env.repos.exercises.get(e.id)).primaryMuscle).toBe('chest');
  });
  it('built-in exercises cannot be edited or deleted, but can be archived', async () => {
    await seed('bench_press');
    expect(errorOf(await env.repos.exercises.update(1, { name: 'Hacked' }))).toEqual({ kind: 'immutable', reason: 'seed_row' });
    expect(errorOf(await env.repos.exercises.delete(1))).toMatchObject({ kind: 'immutable' });
    expect(unwrap(await env.repos.exercises.setArchived(1, true)).isArchived).toBe(true);
  });
  it('not found / delete rules', async () => {
    expect(errorOf(await env.repos.exercises.get(999))).toEqual({ kind: 'not_found', entity: 'exercise' });
    const e = unwrap(await env.repos.exercises.create(ex));
    unwrap(await env.repos.exercises.delete(e.id));
    expect(errorOf(await env.repos.exercises.get(e.id)).kind).toBe('not_found');
  });
  it('an exercise used by a template cannot be deleted (foreign key RESTRICT)', async () => {
    const e = unwrap(await env.repos.exercises.create(ex));
    unwrap(await env.repos.templates.create({ name: 'T', exercises: [{ exerciseId: e.id, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    expect(errorOf(await env.repos.exercises.delete(e.id))).toMatchObject({ kind: 'constraint', constraint: 'foreign_key' });
  });
});

describe('templates', () => {
  const tex = (exerciseId: number, extra = {}) => ({ exerciseId, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSec: 60, ...extra });
  async function twoExercises() {
    return [unwrap(await env.repos.exercises.create(ex)).id, unwrap(await env.repos.exercises.create({ ...ex, name: 'Row', primaryMuscle: 'back' })).id];
  }
  it('creates a template with ordered exercises atomically', async () => {
    const [a, b] = await twoExercises();
    const t = unwrap(await env.repos.templates.create({ name: 'Push', notes: 'Heavy', exercises: [tex(b), tex(a, { targetRepsMin: undefined, targetRepsMax: undefined, targetDurationSec: 45 })] }));
    expect(t).toMatchObject({ name: 'Push', notes: 'Heavy', createdAt: T0 });
    expect(t.exercises.map((e) => [e.position, e.exerciseId])).toEqual([[1, b], [2, a]]);
    expect(t.exercises[1]).toMatchObject({ targetRepsMin: null, targetDurationSec: 45 });
  });
  it('is all-or-nothing: an unknown exercise fails the whole create', async () => {
    const [a] = await twoExercises();
    expect(errorOf(await env.repos.templates.create({ name: 'Bad', exercises: [tex(a), tex(9999)] }))).toMatchObject({ kind: 'constraint', constraint: 'foreign_key' });
    expect(unwrap(await env.repos.templates.list())).toEqual([]);
    expect(Number((await env.db.first<{ c: number }>('SELECT count(*) c FROM template_exercises'))!.c)).toBe(0);
  });
  it('update replaces the exercises atomically and bumps updatedAt; a failed update changes nothing', async () => {
    const [a, b] = await twoExercises();
    const t = unwrap(await env.repos.templates.create({ name: 'Push', exercises: [tex(a), tex(b)] }));
    env.clock.advance(H);
    const u = unwrap(await env.repos.templates.update(t.id, { name: 'Push v2', exercises: [tex(b)] }));
    expect(u).toMatchObject({ name: 'Push v2', updatedAt: T0 + H, createdAt: T0 });
    expect(u.exercises).toHaveLength(1);
    expect(errorOf(await env.repos.templates.update(t.id, { name: 'Broken', exercises: [tex(b), tex(9999)] })).kind).toBe('constraint');
    expect(unwrap(await env.repos.templates.get(t.id))).toMatchObject({ name: 'Push v2' });
    expect(unwrap(await env.repos.templates.get(t.id)).exercises).toHaveLength(1);
    expect(errorOf(await env.repos.templates.update(999, { name: 'x', exercises: [tex(a)] }))).toEqual({ kind: 'not_found', entity: 'template' });
  });
  it('list is most-recently-updated first; duplicate copies everything under a new name; delete removes it', async () => {
    const [a, b] = await twoExercises();
    const t1 = unwrap(await env.repos.templates.create({ name: 'One', exercises: [tex(a)] }));
    env.clock.advance(H);
    const t2 = unwrap(await env.repos.templates.create({ name: 'Two', exercises: [tex(b)] }));
    expect(unwrap(await env.repos.templates.list()).map((t) => t.name)).toEqual(['Two', 'One']);
    const copy = unwrap(await env.repos.templates.duplicate(t1.id, 'One (copy)'));
    expect(copy).toMatchObject({ name: 'One (copy)' });
    expect(copy.id).not.toBe(t1.id);
    expect(copy.exercises.map((e) => e.exerciseId)).toEqual([a]);
    unwrap(await env.repos.templates.delete(t2.id));
    expect(errorOf(await env.repos.templates.get(t2.id)).kind).toBe('not_found');
    expect(errorOf(await env.repos.templates.duplicate(999, 'x')).kind).toBe('not_found');
    expect(errorOf(await env.repos.templates.duplicate(t1.id, '')).kind).toBe('validation');
  });
  it('validation: needs a name and at least one exercise with a target', async () => {
    const [a] = await twoExercises();
    expect(errorOf(await env.repos.templates.create({ name: '', exercises: [] }))).toMatchObject({ kind: 'validation', issues: { name: 'validation.required', exercises: 'validation.outOfRange' } });
    expect(errorOf(await env.repos.templates.create({ name: 'x', exercises: [{ exerciseId: a, targetSets: 3, restSec: 60 }] }))).toMatchObject({ kind: 'validation' });
  });
});
