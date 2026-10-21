import AsyncStorage from '@react-native-async-storage/async-storage';
import { LEGACY_IMPORT_META_KEY, LEGACY_PROFILE_KEY, importLegacyProfile, type ReadOnlyKeyValueStore } from '../../db/legacyImport';
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

describe('importLegacyProfile (copies AsyncStorage data into SQLite; never writes to AsyncStorage)', () => {
  const key = LEGACY_PROFILE_KEY;
  const legacy = { name: 'Jacob Donald', location: 'London, United Kingdom', age: 27, heightCm: 170, weightKg: 52 };
  const storeOf = (raw: string | null): ReadOnlyKeyValueStore => ({ getItem: async (k) => (k === key ? raw : null) });
  const run = (raw: string | null, e = env) => importLegacyProfile(storeOf(raw), e.db, { clock: e.clock, utcOffsetMinutes: () => 0 });

  it('imports a valid legacy profile: profile row + first weight entry labelled as legacy', async () => {
    expect(unwrap(await run(JSON.stringify(legacy)))).toEqual({ status: 'imported', profileImported: true, weightImported: true });
    expect(unwrap(await env.repos.profile.get())).toMatchObject({ displayName: 'Jacob Donald', location: 'London, United Kingdom', ageYears: 27, ageSetOn: '2026-10-21', heightCm: 170, sex: null, activityLevel: null });
    expect(unwrap(await env.repos.weight.latest())).toMatchObject({ weightKg: 52, source: 'legacy_profile', localDate: '2026-10-21' });
  });
  it('a missing key means nothing to import; the demo profile is never persisted or imported', async () => {
    expect(unwrap(await run(null))).toEqual({ status: 'nothing_to_import' });
    expect(unwrap(await env.repos.profile.get())).toBeNull();
    expect(unwrap(await env.repos.weight.latest())).toBeNull();
    expect(await count("SELECT count(*) c FROM app_meta WHERE key='legacy_import_v1'")).toBe(0); // no marker: it can still import later
  });
  it.each([
    ['malformed JSON', '{not json'],
    ['a JSON array', '[1,2,3]'],
    ['a JSON string', '"hello"'],
    ['null', 'null'],
    ['missing name', JSON.stringify({ ...legacy, name: undefined })],
    ['blank name', JSON.stringify({ ...legacy, name: '  ' })],
    ['age out of range', JSON.stringify({ ...legacy, age: 7 })],
    ['age as text', JSON.stringify({ ...legacy, age: '27' })],
    ['height out of range', JSON.stringify({ ...legacy, heightCm: 20 })],
    ['weight out of range', JSON.stringify({ ...legacy, weightKg: 5 })],
    ['missing weight', JSON.stringify({ ...legacy, weightKg: undefined })],
  ])('rejects %s as a whole and writes nothing', async (_l, raw) => {
    expect(errorOf(await run(raw))).toEqual({ kind: 'legacy_data_invalid', key });
    expect(unwrap(await env.repos.profile.get())).toBeNull();
    expect(unwrap(await env.repos.weight.latest())).toBeNull();
    expect(await count('SELECT count(*) c FROM app_meta')).toBe(0);
  });
  it('is idempotent: a second run (even with different data) changes nothing', async () => {
    unwrap(await run(JSON.stringify(legacy)));
    expect(unwrap(await run(JSON.stringify({ ...legacy, name: 'Someone Else', weightKg: 99 })))).toEqual({ status: 'already_imported' });
    expect(unwrap(await env.repos.profile.get())!.displayName).toBe('Jacob Donald');
    expect(await count('SELECT count(*) c FROM weight_entries')).toBe(1);
    expect(await count('SELECT count(*) c FROM profile')).toBe(1);
  });
  it('never overwrites data already in the database (existing profile / same-day weight)', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Existing User', heightCm: 180 }));
    unwrap(await env.repos.weight.save({ weightKg: 80 }));
    expect(unwrap(await run(JSON.stringify(legacy)))).toEqual({ status: 'imported', profileImported: false, weightImported: false });
    expect(unwrap(await env.repos.profile.get())).toMatchObject({ displayName: 'Existing User', heightCm: 180 });
    expect(unwrap(await env.repos.weight.latest())).toMatchObject({ weightKg: 80, source: 'manual' });
  });
  it('is atomic: if the marker cannot be written, no profile or weight remains', async () => {
    const failing = { ...env.db, first: env.db.first.bind(env.db), transaction: (fn: any) => env.db.transaction((tx: any) => fn({ ...tx, run: (sql: string, p?: any) => (sql.includes('legacy_import') || (sql.includes('app_meta') && p?.[0] === LEGACY_IMPORT_META_KEY) ? Promise.reject(new Error('boom')) : tx.run(sql, p)), all: tx.all.bind(tx), first: tx.first.bind(tx), exec: tx.exec.bind(tx) })) } as any;
    expect(errorOf(await importLegacyProfile(storeOf(JSON.stringify(legacy)), failing, { clock: env.clock, utcOffsetMinutes: () => 0 })).kind).toBe('unknown');
    expect(unwrap(await env.repos.profile.get())).toBeNull();
    expect(unwrap(await env.repos.weight.latest())).toBeNull();
  });
  it('uses the device-local day for the weight entry and the age date', async () => {
    const e = await createRepoEnv(120);
    e.clock.set(Date.UTC(2026, 9, 21, 23, 30));
    unwrap(await importLegacyProfile(storeOf(JSON.stringify(legacy)), e.db, { clock: e.clock, utcOffsetMinutes: () => 120 }));
    expect(unwrap(await e.repos.weight.latest())!.localDate).toBe('2026-10-22');
    expect(unwrap(await e.repos.profile.get())!.ageSetOn).toBe('2026-10-22');
  });

  describe('against the real AsyncStorage module (jest mock)', () => {
    const SETTINGS_KEY = 'fitness.settings.v1';
    const settingsRaw = JSON.stringify({ language: 'ar', soundEnabled: false, experience: 'advanced', cautionAreas: ['knees'], reminders: { enabled: true, hour: 7, minute: 30, days: [0, 6] } });
    beforeEach(async () => {
      await AsyncStorage.clear();
      await AsyncStorage.setItem(LEGACY_PROFILE_KEY, JSON.stringify(legacy));
      await AsyncStorage.setItem(SETTINGS_KEY, settingsRaw);
      jest.clearAllMocks(); // forget the seeding calls: from here on, ANY write would be a failure
    });
    const expectUntouched = async () => {
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
      expect(AsyncStorage.multiSet).not.toHaveBeenCalled();
      expect(AsyncStorage.multiRemove).not.toHaveBeenCalled();
      expect(AsyncStorage.mergeItem).not.toHaveBeenCalled();
      expect(AsyncStorage.clear).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(LEGACY_PROFILE_KEY)).toBe(JSON.stringify(legacy));
      expect(await AsyncStorage.getItem(SETTINGS_KEY)).toBe(settingsRaw);
    };
    it('a successful import, a repeated import and a failed import never write to or delete AsyncStorage data', async () => {
      const store: ReadOnlyKeyValueStore = AsyncStorage;
      expect(unwrap(await importLegacyProfile(store, env.db, { clock: env.clock })).status).toBe('imported');
      expect(unwrap(await importLegacyProfile(store, env.db, { clock: env.clock })).status).toBe('already_imported');
      await expectUntouched();
      const e2 = await createRepoEnv();
      await AsyncStorage.setItem(LEGACY_PROFILE_KEY, '{broken'); // simulate corruption, then restore expectations below
      jest.clearAllMocks();
      expect(errorOf(await importLegacyProfile(store, e2.db, { clock: e2.clock })).kind).toBe('legacy_data_invalid');
      expect(AsyncStorage.setItem).not.toHaveBeenCalled();
      expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
      expect(await AsyncStorage.getItem(LEGACY_PROFILE_KEY)).toBe('{broken'); // left exactly as found
      expect(await AsyncStorage.getItem(SETTINGS_KEY)).toBe(settingsRaw);
    });
    it('only ever reads the legacy profile key (settings stay where they are)', async () => {
      await importLegacyProfile(AsyncStorage, env.db, { clock: env.clock });
      expect((AsyncStorage.getItem as jest.Mock).mock.calls.map((c) => c[0])).toEqual([LEGACY_PROFILE_KEY]);
    });
  });
});

describe('ManualClock sanity for these suites', () => {
  it('T0 is the fixed start', () => expect(new ManualClock(T0).now()).toBe(T0));
});
