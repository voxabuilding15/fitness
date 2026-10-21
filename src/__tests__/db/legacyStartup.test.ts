/**
 * The startup wiring of the legacy profile import. The database here is Node SQLite behind a FAKE expo-sqlite module,
 * so this proves ordering, once-only behaviour and error handling - NOT the real Expo SQLite native implementation.
 */
import { createAppDatabase } from '../../db/appDatabase';
import { LEGACY_IMPORT_META_KEY, LEGACY_PROFILE_KEY, type ReadOnlyKeyValueStore } from '../../db/legacyImport';
import { createLegacyStartup } from '../../db/legacyStartup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { createRepoEnv, T0 } from '../../db/testing/repoEnv';
import { DbError } from '../../domain/errors';
import { ManualClock } from '../../domain/clock';

const legacy = { name: 'Jacob', age: 27, heightCm: 170, weightKg: 52 };
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
const storeOf = (raw: string | null | (() => Promise<string | null>)): ReadOnlyKeyValueStore & { calls: number } => {
  const s = { calls: 0, getItem: async (k: string) => { s.calls++; expect(k).toBe(LEGACY_PROFILE_KEY); return typeof raw === 'function' ? raw() : raw; } };
  return s;
};

describe('createLegacyStartup', () => {
  it('overlapping callers share one run, and a finished run is remembered (the store is read once)', async () => {
    const env = await createRepoEnv();
    const store = storeOf(JSON.stringify(legacy));
    const startup = createLegacyStartup(store, { clock: env.clock });
    const results = await Promise.all([startup.run(env.db), startup.run(env.db), startup.run(env.db)]);
    expect(results.every((r) => r.ok && r.value.status === 'imported')).toBe(true);
    await startup.run(env.db);
    expect(store.calls).toBe(1);
    expect(startup.last()).toBe(results[0]);
  });
  it('an unreadable legacy profile is remembered too (no re-parsing on every call) and writes no marker', async () => {
    const env = await createRepoEnv();
    const store = storeOf('{broken');
    const startup = createLegacyStartup(store, { clock: env.clock });
    expect((await startup.run(env.db)).ok).toBe(false);
    await startup.run(env.db);
    expect(store.calls).toBe(1);
    expect(await env.db.first('SELECT 1 AS x FROM app_meta WHERE key=?', [LEGACY_IMPORT_META_KEY])).toBeNull();
  });
  it('a transient failure is NOT remembered: the next call tries again and succeeds', async () => {
    const env = await createRepoEnv();
    let fail = true;
    const store = storeOf(async () => { if (fail) throw new DbError({ kind: 'busy', message: 'locked' }); return JSON.stringify(legacy); });
    const startup = createLegacyStartup(store, { clock: env.clock });
    expect((await startup.run(env.db)).ok).toBe(false);
    fail = false;
    const second = await startup.run(env.db);
    expect(second.ok && second.value.status).toBe('imported');
    expect(store.calls).toBe(2);
  });
  it('last() is null before any run', async () => {
    expect(createLegacyStartup(storeOf(null)).last()).toBeNull();
  });
});

describe('createAppDatabase: the database is only reported ready after the import', () => {
  it('the imported profile is already there when get() resolves, and it is undated', async () => {
    const store = storeOf(JSON.stringify(legacy));
    const app = createAppDatabase({ load: fakeModule, store, clock: new ManualClock(T0) });
    const r = await app.get();
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    const p = await r.repos.profile.get();
    expect(p.ok && p.value).toMatchObject({ displayName: 'Jacob', ageYears: 27, ageSetOn: null, undatedWeightKg: 52 });
    expect(app.legacyResult()).toMatchObject({ ok: true, value: { status: 'imported' } });
  });
  it('get() and retry() any number of times import once', async () => {
    const store = storeOf(JSON.stringify(legacy));
    const app = createAppDatabase({ load: fakeModule, store, clock: new ManualClock(T0) });
    await Promise.all([app.get(), app.get(), app.retry()]);
    await app.retry();
    expect(store.calls).toBe(1);
  });
  it('an unreadable legacy profile does not make the database unavailable', async () => {
    const app = createAppDatabase({ load: fakeModule, store: storeOf('{broken'), clock: new ManualClock(T0) });
    const r = await app.get();
    expect(r.status).toBe('ready');
    expect(app.legacyResult()).toMatchObject({ ok: false, error: { kind: 'legacy_data_invalid' } });
  });
  it('no legacy profile (a fresh install): ready, nothing imported, no profile', async () => {
    const app = createAppDatabase({ load: fakeModule, store: storeOf(null), clock: new ManualClock(T0) });
    const r = await app.get();
    expect(r.status === 'ready' && (await r.repos.profile.get())).toEqual({ ok: true, value: null });
    expect(app.legacyResult()).toMatchObject({ ok: true, value: { status: 'nothing_to_import' } });
  });
  it('a missing native module: unavailable, and the legacy profile is neither read nor touched', async () => {
    const store = storeOf(JSON.stringify(legacy));
    const app = createAppDatabase({ load: () => { throw new DbError({ kind: 'unavailable', reason: 'native_module_missing' }); }, store });
    expect((await app.get()).status).toBe('unavailable');
    expect(store.calls).toBe(0);
    expect(app.legacyResult()).toBeNull();
  });
});
