import AsyncStorage from '@react-native-async-storage/async-storage';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BackupStrategy } from '../../db/backup';
import { Database } from '../../db/database';
import { createDatabaseInitializer, type InitDeps } from '../../db/initDatabase';
import { MIGRATIONS, LATEST_VERSION } from '../../db/migrations';
import { runMigrations } from '../../db/migrations/runner';
import { NodeFileBackupStrategy } from '../../db/testing/nodeFileBackup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import type { SqlDriver } from '../../db/sqlDatabase';
import { ManualClock } from '../../domain/clock';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-init-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const clock = () => new ManualClock(Date.UTC(2026, 9, 21, 10));
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => (open = r)); return { p, open }; };

/** Deps backed by a real file; counts how often the driver was opened / closed. */
function fileDeps(path = join(dir, 'app.db'), extra: Partial<InitDeps> & { backup?: BackupStrategy; wrap?: (d: NodeSqliteDriver) => SqlDriver } = {}) {
  const stats = { opens: 0, closes: 0 };
  const deps: InitDeps = {
    clock: clock(),
    open: async () => {
      stats.opens++;
      const inner = new NodeSqliteDriver(path);
      const base: SqlDriver = extra.wrap ? extra.wrap(inner) : inner;
      const driver: SqlDriver = { exec: (s) => base.exec(s), run: (s, p) => base.run(s, p), all: (s, p) => base.all(s, p), close: async () => { stats.closes++; return base.close(); } };
      return { driver, backup: extra.backup ?? new NodeFileBackupStrategy(dir) };
    },
    ...(extra.queueTimeoutMs ? { queueTimeoutMs: extra.queueTimeoutMs } : {}),
  };
  return { deps, stats, path };
}

describe('successful initialization', () => {
  it('opens, verifies foreign keys, migrates a fresh database and returns repositories', async () => {
    const { deps } = fileDeps();
    const r = await createDatabaseInitializer(deps).get();
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.report).toMatchObject({ fromVersion: 0, toVersion: LATEST_VERSION });
    expect((await r.db.first<{ foreign_keys: number }>('PRAGMA foreign_keys'))!.foreign_keys).toBe(1);
    expect((await r.repos.profile.get())).toEqual({ ok: true, value: null });
  });
  it('duplicate / concurrent initialization returns the SAME in-flight promise and opens the database once', async () => {
    const { deps, stats } = fileDeps();
    const g = gate();
    const slowDeps: InitDeps = { ...deps, open: async () => { await g.p; return deps.open(); } };
    const slow = createDatabaseInitializer(slowDeps);
    const calls = Array.from({ length: 10 }, () => slow.get());
    expect(new Set(calls).size).toBe(1); // literally one promise object
    g.open();
    const results = await Promise.all(calls);
    expect(new Set(results).size).toBe(1);
    expect(results[0].status).toBe('ready');
    expect(stats.opens).toBe(1);
    expect(await slow.get()).toBe(results[0]); // later calls reuse the ready database
    expect(stats.opens).toBe(1);
  });
  it('a ready database is never discarded by retry()', async () => {
    const { deps, stats } = fileDeps();
    const init = createDatabaseInitializer(deps);
    const a = await init.get();
    expect(await init.retry()).toBe(a);
    expect(stats.opens).toBe(1);
  });
  it('re-opening an already migrated file is a no-op upgrade and keeps the data', async () => {
    const { deps, path } = fileDeps();
    const first = await createDatabaseInitializer(deps).get();
    if (first.status !== 'ready') throw new Error('not ready');
    await first.repos.weight.save({ weightKg: 70 });
    await first.db.close();
    const second = await createDatabaseInitializer(fileDeps(path).deps).get();
    expect(second.status === 'ready' && second.report).toMatchObject({ fromVersion: LATEST_VERSION, toVersion: LATEST_VERSION, applied: [], backup: null });
    expect(second.status === 'ready' && (await second.repos.weight.latest())).toMatchObject({ ok: true, value: { weightKg: 70 } });
  });
});

describe('failures never reject, never delete, and can be retried', () => {
  it('a failing open is reported as unavailable (never thrown), is not cached, and a retry can succeed', async () => {
    let attempt = 0;
    const { deps, stats } = fileDeps();
    const flaky: InitDeps = { ...deps, open: async () => { if (attempt++ === 0) throw new Error('storage unavailable'); return deps.open(); } };
    const init = createDatabaseInitializer(flaky);
    const first = await init.get();
    expect(first).toEqual({ status: 'unavailable', error: { kind: 'unknown', message: 'storage unavailable' } });
    const second = await init.retry();
    expect(second.status).toBe('ready');
    expect(stats.opens).toBe(1);
  });
  it('callers that arrive DURING a failing attempt share it; the next call afterwards starts a fresh attempt', async () => {
    let opens = 0;
    const g = gate();
    const init = createDatabaseInitializer({ open: async () => { opens++; await g.p; throw new Error('nope'); } });
    const a = init.get(); const b = init.get();
    expect(a).toBe(b);
    g.open();
    expect((await a).status).toBe('unavailable');
    expect(opens).toBe(1);
    await init.get();
    expect(opens).toBe(2);
  });
  it('non-Error rejections are handled too', async () => {
    const r = await createDatabaseInitializer({ open: async () => { throw 'plain string'; } }).get();
    expect(r).toEqual({ status: 'unavailable', error: { kind: 'unknown', message: 'plain string' } });
  });
  it('refuses to run if foreign keys cannot be enforced, and closes the connection', async () => {
    const { deps, stats } = fileDeps(undefined, { wrap: (d) => ({ exec: async (s) => (/PRAGMA foreign_keys\s*=\s*ON/i.test(s) ? undefined : d.exec(s)), run: (s, p) => d.run(s, p), all: (s, p) => d.all(s, p), close: () => d.close() }) });
    expect(await createDatabaseInitializer(deps).get()).toEqual({ status: 'unavailable', error: { kind: 'unavailable', reason: 'foreign_keys_not_enforced' } });
    expect(stats.closes).toBe(1);
  });
  it('a database from a NEWER app is reported as db_too_new, left untouched, and the connection is released', async () => {
    const path = join(dir, 'newer.db');
    const d = new NodeSqliteDriver(path);
    await d.exec("CREATE TABLE precious(x TEXT); INSERT INTO precious VALUES ('keep'); PRAGMA user_version = 99;");
    await d.close();
    const { deps, stats } = fileDeps(path);
    expect(await createDatabaseInitializer(deps).get()).toEqual({ status: 'unavailable', error: { kind: 'db_too_new', found: 99, supported: LATEST_VERSION } });
    expect(stats.closes).toBe(1);
    const check = new NodeSqliteDriver(path);
    expect(await check.all('SELECT x FROM precious')).toEqual([{ x: 'keep' }]);
    expect((await check.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version).toBe(99);
    await check.close();
  });
  it('BACKUP FAILURE on a populated database: migration stopped, database unavailable, ALL data and version preserved', async () => {
    const path = join(dir, 'populated.db');
    const old = await Database.open(new NodeSqliteDriver(path));
    expect((await runMigrations(old, { migrations: MIGRATIONS.slice(0, 3) })).ok).toBe(true);
    await old.run("INSERT INTO profile(id,display_name,updated_at) VALUES (1,'Sara',1700000000000)");
    await old.close();
    const failing: BackupStrategy = { create: async () => { throw new Error('disk full'); }, validate: async () => undefined, prune: async () => ({ removed: [], failed: [] }) };
    const { deps, stats } = fileDeps(path, { backup: failing });
    expect(await createDatabaseInitializer(deps).get()).toEqual({ status: 'unavailable', error: { kind: 'backup_failed', message: 'disk full' } });
    expect(stats.closes).toBe(1);
    const check = new NodeSqliteDriver(path);
    expect((await check.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version).toBe(3);
    expect(await check.all('SELECT display_name FROM profile')).toEqual([{ display_name: 'Sara' }]);
    expect(await check.all("SELECT name FROM sqlite_master WHERE name='foods'")).toEqual([]);
    await check.close();
    // once the problem is fixed, the same file upgrades normally and the data is still there
    const fixed = await createDatabaseInitializer(fileDeps(path).deps).get();
    expect(fixed.status).toBe('ready');
    expect(fixed.status === 'ready' && (await fixed.repos.profile.get())).toMatchObject({ ok: true, value: { displayName: 'Sara' } });
  });
  it('a failed initialization never touches AsyncStorage (profile and settings stay exactly as saved)', async () => {
    await AsyncStorage.clear();
    const profile = JSON.stringify({ name: 'Real User', location: 'Rabat', age: 33, heightCm: 171, weightKg: 64 });
    const settings = JSON.stringify({ language: 'ar', soundEnabled: false });
    await AsyncStorage.setItem('fitness.profile.v1', profile);
    await AsyncStorage.setItem('fitness.settings.v1', settings);
    jest.clearAllMocks();
    await createDatabaseInitializer({ open: async () => { throw new Error('boom'); } }).get();
    const path = join(dir, 'newer.db');
    const d = new NodeSqliteDriver(path); await d.exec('PRAGMA user_version = 99'); await d.close();
    await createDatabaseInitializer(fileDeps(path).deps).get();
    for (const m of ['setItem', 'removeItem', 'multiSet', 'multiRemove', 'mergeItem', 'clear'] as const) expect((AsyncStorage[m] as jest.Mock)).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('fitness.profile.v1')).toBe(profile);
    expect(await AsyncStorage.getItem('fitness.settings.v1')).toBe(settings);
  });
});
