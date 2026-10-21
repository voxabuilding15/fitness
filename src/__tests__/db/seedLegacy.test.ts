import { SEED_VERSION_KEY, runSeed, type SeedPack } from '../../db/seedRunner';
import { createRepoEnv, errorOf, T0, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import { ManualClock } from '../../domain/clock';

let env: RepoEnv;
beforeEach(async () => { env = await createRepoEnv(); });
const count = async (sql: string) => Number((await env.db.first<{ c: number }>(sql))!.c);

describe('seed mechanism (no seed content ships in Phase 1)', () => {
  type Ex = NonNullable<SeedPack['exercises']>[number];
  type Fd = NonNullable<SeedPack['foods']>[number];
  const ex0: Ex = { slug: 'bench_press', category: 'strength', primaryMuscle: 'chest', equipment: 'barbell', trackingType: 'weight_reps', secondaryMuscles: ['triceps'] };
  const food0: Fd = { slug: 'oats', unit: 'g', kcalPer100: 380, proteinPer100: 13, carbsPer100: 60, fatPer100: 7, defaultServing: 40 };
  const pack: SeedPack = { version: 1, exercises: [ex0], foods: [food0], habits: [{ slug: 'walk', kind: 'boolean' }] };

  it('starts empty: a fresh database contains no exercises, foods or habits', async () => {
    expect(await count('SELECT (SELECT count(*) FROM exercises)+(SELECT count(*) FROM foods)+(SELECT count(*) FROM habits) c')).toBe(0);
  });
  it('applies a pack once; the same or an older version is a no-op', async () => {
    expect(unwrap(await runSeed(env.db, pack, env.clock))).toEqual({ applied: true, version: 1 });
    expect(unwrap(await runSeed(env.db, pack, env.clock))).toEqual({ applied: false, version: 1 });
    expect(unwrap(await runSeed(env.db, { ...pack, version: 1 }, env.clock)).applied).toBe(false);
    expect(await count('SELECT count(*) c FROM exercises')).toBe(1);
    expect((await env.db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [SEED_VERSION_KEY]))!.value).toBe('1');
    expect(await env.db.all('SELECT source, slug, custom_name FROM foods')).toEqual([{ source: 'seed', slug: 'oats', custom_name: null }]);
    expect((await env.db.first<{ data_label: string }>('SELECT data_label FROM foods'))!.data_label).toBe('approximate');
  });
  it('a newer version updates rows by slug, keeping their ids, archive/favourite flags and history', async () => {
    await runSeed(env.db, pack, env.clock);
    const ex = unwrap(await env.repos.exercises.list())[0];
    unwrap(await env.repos.exercises.setArchived(ex.id, true));
    unwrap(await env.repos.nutrition.setFoodFavorite(1, true));
    unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: 1, amount: 40, mealType: 'breakfast' }));
    const next: SeedPack = { ...pack, version: 2, exercises: [{ ...ex0, primaryMuscle: 'shoulders' }], foods: [{ ...food0, kcalPer100: 390 }] };
    expect(unwrap(await runSeed(env.db, next, env.clock))).toEqual({ applied: true, version: 2 });
    const after = unwrap(await env.repos.exercises.get(ex.id));
    expect(after).toMatchObject({ id: ex.id, primaryMuscle: 'shoulders', isArchived: true, slug: 'bench_press' });
    expect(unwrap(await env.repos.nutrition.getFood(1))).toMatchObject({ kcalPer100: 390, isFavorite: true });
    expect(unwrap(await env.repos.nutrition.listMeals('2026-10-21'))[0].kcal).toBe(152); // the logged meal keeps its snapshot
  });
  it('rejects malformed packs before touching the database', async () => {
    expect(errorOf(await runSeed(env.db, { version: 1, exercises: [{ ...ex0, slug: 'Bad Slug!' }] } as any, env.clock)).kind).toBe('validation');
    expect(errorOf(await runSeed(env.db, { version: 1, foods: [{ ...food0, kcalPer100: 5000 }] } as any, env.clock)).kind).toBe('validation');
    expect(errorOf(await runSeed(env.db, { version: 1, extra: true } as any, env.clock)).kind).toBe('validation');
    expect(await count('SELECT count(*) c FROM app_meta')).toBe(0);
  });
  it('is all-or-nothing: if the version marker cannot be written, nothing is seeded', async () => {
    const failing = { ...env.db, first: env.db.first.bind(env.db), transaction: (fn: any) => env.db.transaction((tx: any) => fn({ ...tx, run: (sql: string, p?: any) => (sql.includes('app_meta') ? Promise.reject(new Error('disk full')) : tx.run(sql, p)), all: tx.all.bind(tx), first: tx.first.bind(tx), exec: tx.exec.bind(tx) })) } as any;
    expect(errorOf(await runSeed(failing, pack, env.clock)).kind).toBe('unknown');
    expect(await count('SELECT (SELECT count(*) FROM exercises)+(SELECT count(*) FROM foods)+(SELECT count(*) FROM habits) c')).toBe(0);
  });
  it('seeded rows are protected from deletion and edits through the repositories', async () => {
    await runSeed(env.db, pack, env.clock);
    expect(errorOf(await env.repos.exercises.delete(1)).kind).toBe('immutable');
    expect(errorOf(await env.repos.exercises.update(1, { name: 'x' })).kind).toBe('immutable');
  });
});

describe('ManualClock sanity for these suites', () => {
  it('T0 is the fixed start', () => expect(new ManualClock(T0).now()).toBe(T0));
});
