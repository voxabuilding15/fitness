/**
 * Startup seeding of the built-in exercise library. Node SQLite behind a FAKE expo-sqlite module: proves ordering,
 * idempotency and failure handling - NOT the real Expo SQLite native implementation.
 */
import { createAppDatabase } from '../../db/appDatabase';
import { EXERCISE_LIBRARY, EXERCISE_LIBRARY_VERSION, SEED_PACK } from '../../data/exerciseLibrary';
import { createSeedStartup } from '../../db/seedStartup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { createRepoEnv, errorOf, T0, unwrap } from '../../db/testing/repoEnv';
import { ManualClock } from '../../domain/clock';
import { DbError } from '../../domain/errors';

const fakeModule = () => {
  const driver = new NodeSqliteDriver();
  return {
    openDatabaseAsync: async () => ({
      execAsync: (sql: string) => driver.exec(sql),
      runAsync: (sql: string, p: never[]) => driver.run(sql, p),
      getAllAsync: (sql: string, p: never[]) => driver.all(sql, p),
      closeAsync: () => driver.close(),
    }),
  } as never;
};
const emptyStore = { getItem: async () => null };

describe('the app database seeds the library before it reports ready', () => {
  it('a fresh install has the whole library when get() resolves, all built-in, none hidden', async () => {
    const app = createAppDatabase({ load: fakeModule, store: emptyStore, clock: new ManualClock(T0) });
    const r = await app.get();
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    const all = unwrap(await r.repos.exercises.list({ includeArchived: true }));
    expect(all).toHaveLength(EXERCISE_LIBRARY.length);
    expect(all.every((e) => e.source === 'seed' && !e.isArchived && e.customName === null && e.slug)).toBe(true);
    expect(app.seedResult()).toMatchObject({ ok: true, value: { applied: true, version: EXERCISE_LIBRARY_VERSION } });
  });
  it('get() and retry() any number of times seed once', async () => {
    const app = createAppDatabase({ load: fakeModule, store: emptyStore, clock: new ManualClock(T0) });
    await Promise.all([app.get(), app.get(), app.retry()]);
    const r = await app.retry();
    expect(app.seedResult()).toMatchObject({ ok: true, value: { applied: true } });
    expect(r.status === 'ready' && unwrap(await r.repos.exercises.list({ includeArchived: true }))).toHaveLength(EXERCISE_LIBRARY.length);
  });
  it('a pack that is broken does not make the database unavailable (the app works without new built-ins)', async () => {
    const bad = { version: 1, exercises: [{ slug: 'Bad Slug!', category: 'strength', primaryMuscle: 'chest', equipment: 'barbell', trackingType: 'weight_reps' }] } as never;
    const app = createAppDatabase({ load: fakeModule, store: emptyStore, clock: new ManualClock(T0), seed: bad });
    const r = await app.get();
    expect(r.status).toBe('ready');
    expect(app.seedResult()).toMatchObject({ ok: false, error: { kind: 'validation' } });
    expect(r.status === 'ready' && unwrap(await r.repos.exercises.list({ includeArchived: true }))).toEqual([]);
  });
  it('the legacy profile import still runs, and runs first', async () => {
    const store = { getItem: async () => JSON.stringify({ name: 'Sam' }) };
    const app = createAppDatabase({ load: fakeModule, store, clock: new ManualClock(T0) });
    const r = await app.get();
    expect(r.status === 'ready' && unwrap(await r.repos.profile.get())).toMatchObject({ displayName: 'Sam' });
    expect(app.legacyResult()).toMatchObject({ ok: true });
    expect(app.seedResult()).toMatchObject({ ok: true });
  });
  it('an unavailable database seeds nothing', async () => {
    const app = createAppDatabase({ load: () => { throw new DbError({ kind: 'unavailable', reason: 'native_module_missing' }); }, store: emptyStore });
    expect((await app.get()).status).toBe('unavailable');
    expect(app.seedResult()).toBeNull();
  });
});

describe('createSeedStartup', () => {
  it('shares overlapping runs, remembers a finished one, and retries a database error on the next call', async () => {
    const env = await createRepoEnv();
    const startup = createSeedStartup(SEED_PACK, { clock: env.clock });
    const [a, b] = await Promise.all([startup.run(env.db), startup.run(env.db)]);
    expect(a).toBe(b);
    expect(unwrap(a)).toEqual({ applied: true, version: EXERCISE_LIBRARY_VERSION });

    const env2 = await createRepoEnv();
    let fail = true;
    const flaky = { ...env2.db, first: env2.db.first.bind(env2.db), transaction: (fn: never) => (fail ? Promise.reject(new DbError({ kind: 'busy', message: 'locked' })) : env2.db.transaction(fn)) } as never;
    const retrying = createSeedStartup(SEED_PACK, { clock: env2.clock });
    expect(errorOf(await retrying.run(flaky)).kind).toBe('busy');
    fail = false;
    expect(unwrap(await retrying.run(flaky)).applied).toBe(true);
    expect(unwrap(await env2.repos.exercises.list())).toHaveLength(EXERCISE_LIBRARY.length);
  });
  it('last() is null before any run', () => {
    expect(createSeedStartup(SEED_PACK).last()).toBeNull();
  });
});

describe('user data survives a newer library version', () => {
  it('hidden built-ins stay hidden, custom exercises are untouched, ids are kept, and removed content is not deleted', async () => {
    const env = await createRepoEnv();
    unwrap(await createSeedStartup(SEED_PACK, { clock: env.clock }).run(env.db));
    const squat = unwrap(await env.repos.exercises.list()).find((e) => e.slug === 'squat')!;
    unwrap(await env.repos.exercises.setArchived(squat.id, true));
    const mine = unwrap(await env.repos.exercises.create({ name: 'My lift', category: 'strength', primaryMuscle: 'back', equipment: 'cable', trackingType: 'weight_reps' }));

    const next = { ...SEED_PACK, version: EXERCISE_LIBRARY_VERSION + 1, exercises: SEED_PACK.exercises!.filter((e) => e.slug !== 'plank').map((e) => (e.slug === 'squat' ? { ...e, primaryMuscle: 'glutes' as const } : e)) };
    expect(unwrap(await createSeedStartup(next, { clock: env.clock }).run(env.db)).applied).toBe(true);

    const after = unwrap(await env.repos.exercises.list({ includeArchived: true }));
    expect(after.find((e) => e.id === squat.id)).toMatchObject({ slug: 'squat', isArchived: true, primaryMuscle: 'glutes' }); // updated by slug, still hidden, same id
    expect(after.find((e) => e.id === mine.id)).toMatchObject({ customName: 'My lift', isArchived: false });
    expect(after.some((e) => e.slug === 'plank')).toBe(true); // content dropped from a pack is never deleted behind the person's back
    expect(after).toHaveLength(EXERCISE_LIBRARY.length + 1);
  });
  it('the same version again changes nothing', async () => {
    const env = await createRepoEnv();
    unwrap(await createSeedStartup(SEED_PACK, { clock: env.clock }).run(env.db));
    const before = JSON.stringify(unwrap(await env.repos.exercises.list({ includeArchived: true })));
    const again = unwrap(await createSeedStartup(SEED_PACK, { clock: env.clock }).run(env.db));
    expect(again).toEqual({ applied: false, version: EXERCISE_LIBRARY_VERSION });
    expect(JSON.stringify(unwrap(await env.repos.exercises.list({ includeArchived: true })))).toBe(before);
  });
  it('built-in exercises cannot be deleted or edited, but can be hidden', async () => {
    const env = await createRepoEnv();
    unwrap(await createSeedStartup(SEED_PACK, { clock: env.clock }).run(env.db));
    const s = unwrap(await env.repos.exercises.list())[0];
    expect(errorOf(await env.repos.exercises.delete(s.id))).toMatchObject({ kind: 'immutable' });
    expect(errorOf(await env.repos.exercises.update(s.id, { name: 'Hacked' }))).toMatchObject({ kind: 'immutable' });
    expect(unwrap(await env.repos.exercises.setArchived(s.id, true)).isArchived).toBe(true);
  });
});
