import AsyncStorage from '@react-native-async-storage/async-storage';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../db/database';
import { LEGACY_IMPORT_META_KEY, LEGACY_PROFILE_KEY, importLegacyProfile, type ReadOnlyKeyValueStore } from '../../db/legacyImport';
import { LATEST_VERSION, MIGRATIONS } from '../../db/migrations';
import { runMigrations } from '../../db/migrations/runner';
import { NodeFileBackupStrategy } from '../../db/testing/nodeFileBackup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { createRepoEnv, errorOf, T0, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import { draftFromSaved } from '../../domain/goalsDraft';

let env: RepoEnv;
beforeEach(async () => { env = await createRepoEnv(); });
const count = async (sql: string, e = env) => Number((await e.db.first<{ c: number }>(sql))!.c);
const key = LEGACY_PROFILE_KEY;
const legacy = { name: 'Jacob Donald', location: 'London, United Kingdom', age: 27, heightCm: 170, weightKg: 52 };
const storeOf = (raw: string | null): ReadOnlyKeyValueStore => ({ getItem: async (k) => (k === key ? raw : null) });
const run = (raw: string | null, e = env) => importLegacyProfile(storeOf(raw), e.db, { clock: e.clock });
const profileOf = async (e = env) => unwrap(await e.repos.profile.get());

/** A Db whose transactions fail when a statement matches (to simulate a crash / disk error part-way through the import). */
const failing = (db: RepoEnv['db'], when: (sql: string, params?: unknown[]) => boolean) =>
  ({
    first: db.first.bind(db),
    transaction: (fn: any) =>
      db.transaction((tx: any) =>
        fn({ ...tx, run: (sql: string, p?: unknown[]) => (when(sql, p) ? Promise.reject(new Error('disk full')) : tx.run(sql, p)), all: tx.all.bind(tx), first: tx.first.bind(tx), exec: tx.exec.bind(tx) })),
  }) as unknown as RepoEnv['db'];

describe('dates: old values never pass for current ones', () => {
  it('the imported age has NO date (not the import day) and the weight is not a dated weight entry', async () => {
    const r = unwrap(await run(JSON.stringify(legacy)));
    expect(r).toMatchObject({ status: 'imported', profileCreated: true });
    expect(await profileOf()).toMatchObject({ displayName: 'Jacob Donald', location: 'London, United Kingdom', ageYears: 27, ageSetOn: null, heightCm: 170, undatedWeightKg: 52, sex: null, activityLevel: null });
    expect(unwrap(await env.repos.weight.latest())).toBeNull(); // no entry claims a day
    expect(await count('SELECT count(*) c FROM weight_entries')).toBe(0);
  });
  it('whatever the clock or time zone says, nothing is dated "today"', async () => {
    for (const offset of [-720, 0, 120, 840]) {
      const e = await createRepoEnv(offset);
      e.clock.set(Date.UTC(2026, 9, 21, 23, 30));
      unwrap(await run(JSON.stringify(legacy), e));
      expect((await profileOf(e))!.ageSetOn).toBeNull();
      expect(await count('SELECT count(*) c FROM weight_entries', e)).toBe(0);
    }
  });
  it('the Goals screen therefore does NOT use the imported age or weight as current: it reports them as having no date', async () => {
    unwrap(await run(JSON.stringify(legacy)));
    const profile = (await profileOf())!;
    const latest = unwrap(await env.repos.weight.latest());
    const d = draftFromSaved({ goals: null, profile, latestWeight: latest, today: '2026-10-21' });
    expect(d.age).toBe('');
    expect(d.weightKg).toBe('');
    expect(d.savedHints.age).toEqual({ value: '27', on: null, reason: 'unknown_date' });
    expect(d.savedHints.weightKg).toEqual({ value: '52', on: null, reason: 'unknown_date' });
    expect(d.heightCm).toBe('170'); // height is not date-limited
  });
  it('an age entered later by the person IS dated, and replaces the undated one', async () => {
    unwrap(await run(JSON.stringify(legacy)));
    unwrap(await env.repos.profile.save({ displayName: 'Jacob Donald', ageYears: 28, heightCm: 170 }));
    expect(await profileOf()).toMatchObject({ ageYears: 28, ageSetOn: '2026-10-21', undatedWeightKg: 52 }); // saving the profile never drops the carried-over weight
  });
  it('the marker records what was imported, without values', async () => {
    unwrap(await run(JSON.stringify(legacy)));
    const marker = JSON.parse((await env.db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [LEGACY_IMPORT_META_KEY]))!.value);
    expect(marker).toMatchObject({ from: key, imported: ['displayName', 'location', 'age', 'heightCm', 'weightKg'], skipped: [] });
    expect(JSON.stringify(marker)).not.toContain('Jacob');
  });
});

describe('what is imported', () => {
  it('a missing key means nothing to import; no marker, so it can still import later', async () => {
    expect(unwrap(await run(null))).toEqual({ status: 'nothing_to_import' });
    expect(await profileOf()).toBeNull();
    expect(await count("SELECT count(*) c FROM app_meta WHERE key='legacy_import_v1'")).toBe(0);
    expect(unwrap(await run(JSON.stringify(legacy))).status).toBe('imported');
  });
  it('never invents a display name: a blob without a usable name imports nothing and writes no marker', async () => {
    for (const raw of [{ ...legacy, name: undefined }, { ...legacy, name: '   ' }, { ...legacy, name: 7 }, { ...legacy, name: 'x'.repeat(41) }, { age: 30 }]) {
      expect(errorOf(await run(JSON.stringify(raw)))).toEqual({ kind: 'legacy_data_invalid', key });
    }
    expect(await profileOf()).toBeNull();
    expect(await count('SELECT count(*) c FROM app_meta')).toBe(0);
  });
  it.each([
    ['malformed JSON', '{not json'], ['a JSON array', '[1,2,3]'], ['a JSON string', '"hello"'], ['null', 'null'], ['a number', '42'],
  ])('%s is rejected as a whole and writes nothing', async (_l, raw) => {
    expect(errorOf(await run(raw))).toEqual({ kind: 'legacy_data_invalid', key });
    expect(await profileOf()).toBeNull();
    expect(await count('SELECT count(*) c FROM app_meta')).toBe(0);
  });
  it('partial data: the valid fields arrive, invalid ones are skipped and reported, nothing is made up for the missing ones', async () => {
    const r = unwrap(await run(JSON.stringify({ name: 'Sam', age: 7, heightCm: 'tall', weightKg: 5 })));
    expect(r).toMatchObject({ status: 'imported', profileCreated: true, imported: ['displayName'] });
    expect((r as any).skipped).toEqual([{ field: 'age', reason: 'invalid' }, { field: 'heightCm', reason: 'invalid' }, { field: 'weightKg', reason: 'invalid' }]);
    expect(await profileOf()).toMatchObject({ displayName: 'Sam', ageYears: null, ageSetOn: null, heightCm: null, undatedWeightKg: null, location: null });
  });
  it('only a name, or a name and a weight, are fine', async () => {
    expect(unwrap(await run(JSON.stringify({ name: 'Sam' })))).toMatchObject({ status: 'imported', imported: ['displayName'], skipped: [] });
    const e = await createRepoEnv();
    unwrap(await run(JSON.stringify({ name: 'Sam', weightKg: 61.26 }), e));
    expect(await profileOf(e)).toMatchObject({ undatedWeightKg: 61.3, ageYears: null });
  });
  it('a blank location is simply absent; a too-long one is skipped; unknown extra keys are ignored', async () => {
    unwrap(await run(JSON.stringify({ name: 'Sam', location: '  ', extra: { a: 1 } })));
    expect((await profileOf())!.location).toBeNull();
    const e = await createRepoEnv();
    const r = unwrap(await run(JSON.stringify({ name: 'Sam', location: 'x'.repeat(61) }), e));
    expect((r as any).skipped).toEqual([{ field: 'location', reason: 'invalid' }]);
  });
  it('the demo profile is never persisted by the old app, so a missing key stays "nothing to import"', async () => {
    expect(unwrap(await run(null))).toEqual({ status: 'nothing_to_import' });
  });
});

describe('idempotency and retries', () => {
  it('a second run (even with different data) changes nothing', async () => {
    unwrap(await run(JSON.stringify(legacy)));
    expect(unwrap(await run(JSON.stringify({ ...legacy, name: 'Someone Else', weightKg: 99 })))).toEqual({ status: 'already_imported' });
    expect(await profileOf()).toMatchObject({ displayName: 'Jacob Donald', undatedWeightKg: 52 });
    expect(await count('SELECT count(*) c FROM profile')).toBe(1);
    expect(await count('SELECT count(*) c FROM app_meta WHERE key=?'.replace('?', `'${LEGACY_IMPORT_META_KEY}'`))).toBe(1);
  });
  it('overlapping runs (two launches, a double effect) import exactly once', async () => {
    const results = await Promise.all([run(JSON.stringify(legacy)), run(JSON.stringify(legacy)), run(JSON.stringify(legacy)), run(JSON.stringify(legacy))]);
    const statuses = results.map((r) => unwrap(r).status).sort();
    expect(statuses.filter((s) => s === 'imported')).toHaveLength(1);
    expect(statuses.filter((s) => s === 'already_imported')).toHaveLength(3);
    expect(await count('SELECT count(*) c FROM profile')).toBe(1);
    expect(await count("SELECT count(*) c FROM app_meta WHERE key='legacy_import_v1'")).toBe(1);
  });
  it.each([
    ['the profile row cannot be written', (sql: string) => sql.startsWith('INSERT INTO profile')],
    ['the marker cannot be written', (_sql: string, p?: unknown[]) => p?.[0] === LEGACY_IMPORT_META_KEY],
  ])('an interrupted import (%s) leaves nothing behind and the next run imports everything', async (_l, when) => {
    const broken = failing(env.db, when);
    expect(errorOf(await importLegacyProfile(storeOf(JSON.stringify(legacy)), broken, { clock: env.clock })).kind).toBe('unknown');
    expect(await profileOf()).toBeNull();
    expect(await count('SELECT count(*) c FROM app_meta')).toBe(0);
    const retry = unwrap(await run(JSON.stringify(legacy)));
    expect(retry).toMatchObject({ status: 'imported', profileCreated: true });
    expect(await profileOf()).toMatchObject({ displayName: 'Jacob Donald', undatedWeightKg: 52, ageSetOn: null });
  });
  it('an interrupted import into an EXISTING profile changes none of it', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Existing' }));
    const before = await profileOf();
    const broken = failing(env.db, (sql) => sql.startsWith('UPDATE profile'));
    expect(errorOf(await importLegacyProfile(storeOf(JSON.stringify(legacy)), broken, { clock: env.clock })).kind).toBe('unknown');
    expect(await profileOf()).toEqual(before);
    expect(await count('SELECT count(*) c FROM app_meta')).toBe(0);
  });
  it('an unreadable blob is retried on the next run and imports once it is readable', async () => {
    expect(errorOf(await run('{broken')).kind).toBe('legacy_data_invalid');
    expect(unwrap(await run(JSON.stringify(legacy))).status).toBe('imported');
  });
  it('a closed or failing database is an error result, never a throw, and writes no marker', async () => {
    const dead = failing(env.db, () => true);
    const r = await importLegacyProfile(storeOf(JSON.stringify(legacy)), dead, { clock: env.clock });
    expect(r.ok).toBe(false);
    expect(await count('SELECT count(*) c FROM app_meta')).toBe(0);
  });
});

describe('newer data in the database always wins', () => {
  it('an existing profile keeps its name and every value it has; only the empty weight slot is filled', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Existing User', location: 'Rabat', ageYears: 40, heightCm: 180, sex: 'female', activityLevel: 'active' }));
    const r = unwrap(await run(JSON.stringify(legacy)));
    expect(r).toEqual({
      status: 'imported', profileCreated: false, imported: ['weightKg'],
      skipped: [{ field: 'displayName', reason: 'existing_data' }, { field: 'location', reason: 'existing_data' }, { field: 'age', reason: 'existing_data' }, { field: 'heightCm', reason: 'existing_data' }],
    });
    expect(await profileOf()).toMatchObject({ displayName: 'Existing User', location: 'Rabat', ageYears: 40, ageSetOn: '2026-10-21', heightCm: 180, sex: 'female', activityLevel: 'active', undatedWeightKg: 52 });
  });
  it('a dated weight the person already logged outranks the legacy weight, which is then not stored at all', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Existing User' }));
    unwrap(await env.repos.weight.save({ weightKg: 80 }));
    const r = unwrap(await run(JSON.stringify(legacy)));
    expect((r as any).skipped).toContainEqual({ field: 'weightKg', reason: 'existing_data' });
    expect((await profileOf())!.undatedWeightKg).toBeNull();
    expect(unwrap(await env.repos.weight.latest())).toMatchObject({ weightKg: 80, source: 'manual' });
    expect(await count('SELECT count(*) c FROM weight_entries')).toBe(1);
  });
  it('an existing undated weight is not replaced', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Existing User' }));
    await env.db.run('UPDATE profile SET undated_weight_kg=66 WHERE id=1');
    unwrap(await run(JSON.stringify(legacy)));
    expect((await profileOf())!.undatedWeightKg).toBe(66);
  });
  it('EMPTY fields are filled from the old profile, and a filled-in age is undated (never today)', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Existing User' })); // no location / age / height
    const r = unwrap(await run(JSON.stringify(legacy)));
    expect((r as any).imported).toEqual(['location', 'age', 'heightCm', 'weightKg']);
    expect(await profileOf()).toMatchObject({ displayName: 'Existing User', location: 'London, United Kingdom', ageYears: 27, ageSetOn: null, heightCm: 170, undatedWeightKg: 52 });
  });
  it('an age the person entered today is not touched by an older age from the old profile', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Existing User', ageYears: 41 }));
    unwrap(await run(JSON.stringify(legacy)));
    expect(await profileOf()).toMatchObject({ ageYears: 41, ageSetOn: '2026-10-21' });
  });
  it('the import never makes a stale or undated database value look fresher', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Existing User', ageYears: 41 }));
    await env.db.run("UPDATE profile SET age_set_on='2024-01-01' WHERE id=1");
    unwrap(await run(JSON.stringify(legacy)));
    expect((await profileOf())!.ageSetOn).toBe('2024-01-01');
  });
});

describe('AsyncStorage is only ever read (real module, jest mock)', () => {
  const SETTINGS_KEY = 'fitness.settings.v1';
  const settingsRaw = JSON.stringify({ language: 'ar', soundEnabled: false, experience: 'advanced', cautionAreas: ['knees'], reminders: { enabled: true, hour: 7, minute: 30, days: [0, 6] } });
  beforeEach(async () => {
    await AsyncStorage.clear();
    await AsyncStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(legacy));
    await AsyncStorage.setItem(SETTINGS_KEY, settingsRaw);
    jest.clearAllMocks(); // forget the seeding calls: from here on, ANY write would be a failure
  });
  const expectNoWrites = () => {
    for (const fn of [AsyncStorage.setItem, AsyncStorage.removeItem, AsyncStorage.multiSet, AsyncStorage.multiRemove, AsyncStorage.mergeItem, AsyncStorage.clear]) expect(fn).not.toHaveBeenCalled();
  };
  it('a successful, a repeated and a partial import never write to or delete AsyncStorage data', async () => {
    const store: ReadOnlyKeyValueStore = AsyncStorage;
    expect(unwrap(await importLegacyProfile(store, env.db, { clock: env.clock })).status).toBe('imported');
    expect(unwrap(await importLegacyProfile(store, env.db, { clock: env.clock })).status).toBe('already_imported');
    const e2 = await createRepoEnv();
    await AsyncStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify({ name: 'Sam', age: 3 }));
    jest.clearAllMocks();
    expect(unwrap(await importLegacyProfile(store, e2.db, { clock: e2.clock })).status).toBe('imported');
    expectNoWrites();
    expect(await AsyncStorage.getItem(LEGACY_PROFILE_KEY)).toBe(JSON.stringify({ name: 'Sam', age: 3 })); // left exactly as found
    expect(await AsyncStorage.getItem(SETTINGS_KEY)).toBe(settingsRaw);
  });
  it('a failed import leaves the legacy value exactly as found', async () => {
    await AsyncStorage.setItem(LEGACY_PROFILE_KEY, '{broken');
    jest.clearAllMocks();
    expect(errorOf(await importLegacyProfile(AsyncStorage, env.db, { clock: env.clock })).kind).toBe('legacy_data_invalid');
    expectNoWrites();
    expect(await AsyncStorage.getItem(LEGACY_PROFILE_KEY)).toBe('{broken');
  });
  it('only ever reads the legacy profile key (settings stay where they are)', async () => {
    await importLegacyProfile(AsyncStorage, env.db, { clock: env.clock });
    expect((AsyncStorage.getItem as jest.Mock).mock.calls.map((c) => c[0])).toEqual([LEGACY_PROFILE_KEY]);
  });
});

describe('migration 007 on a database that already holds data', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-m7-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('upgrades a v6 database keeping the profile exactly, with a backup of v6, and the new rules apply afterwards', async () => {
    const db = await Database.open(new NodeSqliteDriver(join(dir, 'fitness.db')));
    expect((await runMigrations(db, { migrations: MIGRATIONS.slice(0, 6) as never })).ok).toBe(true);
    await db.run("INSERT INTO profile(id,display_name,location,sex,age_years,age_set_on,height_cm,activity_level,updated_at) VALUES (1,'Sara','Rabat','female',30,'2026-01-02',171.5,'light',?)", [T0]);
    const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir) });
    expect(r.ok && r.value).toMatchObject({ fromVersion: 6, toVersion: LATEST_VERSION, applied: [7, 8, 9] });
    expect(await db.first('SELECT * FROM profile')).toEqual({
      id: 1, display_name: 'Sara', location: 'Rabat', sex: 'female', age_years: 30, age_set_on: '2026-01-02', height_cm: 171.5, activity_level: 'light', undated_weight_kg: null, updated_at: T0,
    });
    await db.run('UPDATE profile SET age_set_on=NULL WHERE id=1'); // now allowed: unknown date
    await expect(db.run("UPDATE profile SET age_years=NULL, age_set_on='2026-01-02' WHERE id=1")).rejects.toMatchObject({ appError: { kind: 'constraint' } });
    expect((await db.all('PRAGMA foreign_key_check'))).toEqual([]);
    await db.close();
  });
  it('a v6 database upgraded to v7 and a fresh install end with identical schemas', async () => {
    const a = await Database.open(new NodeSqliteDriver());
    await runMigrations(a, { migrations: MIGRATIONS.slice(0, 6) as never });
    expect((await runMigrations(a, { backup: new NodeFileBackupStrategy(dir) })).ok).toBe(true); // v6 -> v7 (the tables exist, so a backup is taken first)
    const b = await Database.open(new NodeSqliteDriver());
    expect((await runMigrations(b)).ok).toBe(true); // fresh install: 1 .. 7
    const schema = (d: Database) => d.all("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");
    expect(await schema(a)).toEqual(await schema(b));
  });
});

describe('profile repository: the age date follows the value', () => {
  it('first save dates the age today; the same age saved again keeps its date; a changed or re-confirmed age is dated today', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'A', ageYears: 30 }));
    await env.db.run("UPDATE profile SET age_set_on='2025-03-01' WHERE id=1");
    unwrap(await env.repos.profile.save({ displayName: 'A renamed', ageYears: 30 }));
    expect((await profileOf())!.ageSetOn).toBe('2025-03-01'); // editing the name never refreshes the age
    unwrap(await env.repos.profile.save({ displayName: 'A renamed', ageYears: 30, ageConfirmed: true }));
    expect((await profileOf())!.ageSetOn).toBe('2026-10-21');
    await env.db.run("UPDATE profile SET age_set_on='2025-03-01' WHERE id=1");
    unwrap(await env.repos.profile.save({ displayName: 'A renamed', ageYears: 31 }));
    expect((await profileOf())!.ageSetOn).toBe('2026-10-21');
  });
  it('an age of UNKNOWN date stays unknown when the same age is saved again, and gets a date only when the person enters/confirms it', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'A', ageYears: 30 }));
    await env.db.run('UPDATE profile SET age_set_on=NULL WHERE id=1');
    unwrap(await env.repos.profile.save({ displayName: 'B', ageYears: 30 }));
    expect((await profileOf())!.ageSetOn).toBeNull();
    unwrap(await env.repos.profile.save({ displayName: 'B', ageYears: 30, ageConfirmed: true }));
    expect((await profileOf())!.ageSetOn).toBe('2026-10-21');
  });
  it('no age means no date; removing the age removes the date', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'A', ageYears: 30 }));
    unwrap(await env.repos.profile.save({ displayName: 'A' }));
    expect(await profileOf()).toMatchObject({ ageYears: null, ageSetOn: null });
  });
  it('saving never touches the carried-over weight', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'A' }));
    await env.db.run('UPDATE profile SET undated_weight_kg=70.5 WHERE id=1');
    unwrap(await env.repos.profile.save({ displayName: 'B', heightCm: 170 }));
    expect((await profileOf())!.undatedWeightKg).toBe(70.5);
  });
});
