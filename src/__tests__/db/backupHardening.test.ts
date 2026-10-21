import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQLiteDatabase } from 'expo-sqlite';
import { BACKUPS_META_KEY, BACKUP_NAME_PATTERN, MAX_KEEP_BACKUPS, MIN_KEEP_BACKUPS, backupName, clampKeep, isBackupName, parseBackupList, type BackupStrategy } from '../../db/backup';
import { Database } from '../../db/database';
import { ExpoBackupStrategy, type ExpoSqliteApi } from '../../db/expoBackup';
import { MIGRATIONS, type Migration, LATEST_VERSION } from '../../db/migrations';
import { runMigrations } from '../../db/migrations/runner';
import { NodeFileBackupStrategy } from '../../db/testing/nodeFileBackup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { createRepoEnv, errorOf, H, T0, unwrap } from '../../db/testing/repoEnv';
import { ManualClock } from '../../domain/clock';

const upTo = (n: number): Migration[] => MIGRATIONS.slice(0, n) as Migration[];
const version = async (db: Database) => Number((await db.first<{ user_version: number }>('PRAGMA user_version'))!.user_version);
const good = (n: number) => `fitness-premigrate-v1-to-v2-${1_000 + n}.db`;

/** every shape of name that must NEVER be accepted as a backup */
const ADVERSARIAL: unknown[] = [
  'fitness.db', 'fitness.db-wal', 'fitness.db-shm', 'FITNESS.DB',
  '../fitness.db', '../../etc/passwd', '..\\fitness.db', '/etc/passwd', 'C:\\Windows\\system.db', '~/fitness.db', './fitness.db',
  'backups/fitness-premigrate-v1-to-v2-1.db', 'fitness-premigrate-v1-to-v2-1.db/../fitness.db', 'fitness-premigrate-v1-to-v2-1.db/..',
  'fitness-premigrate-v1-to-v2-1.db\n', 'fitness-premigrate-v1-to-v2-1.db ', ' fitness-premigrate-v1-to-v2-1.db', 'fitness-premigrate-v1-to-v2-1.db\0.txt',
  'fitness-premigrate-v1-to-v2-1.sqlite', 'fitness-premigrate-v1-to-v2-1.db.bak', 'fitness-premigrate-v1-to-v2-1', 'fitness-premigrate-v1-to-v2-.db',
  'FITNESS-PREMIGRATE-v1-to-v2-1.db', 'fitness-premigrate-V1-to-v2-1.db', 'fitness-premigrate-v1-to-v2-1.DB', 'fitness-premigrate-v-to-v2-1.db',
  'fitness-premigrate-v1-to-v2-1-.db', 'fitness-premigrate-v1-to-v2-1-1234.db', 'fitness-premigrate-v1-to-v2-12345678901234567.db', 'fitness-premigrate-v1234567-to-v2-1.db',
  'fitness-premigrate-v1-to-v2-１.db', // full-width digit look-alike
  'fitnеss-premigrate-v1-to-v2-1.db', // Cyrillic 'е'
  'x'.repeat(500), '', '*', '%', '.', '..', '*.db', 'fitness-premigrate-v1-to-v2-*.db', 'fitness-premigrate-v1-to-v2-1.db;rm -rf /',
  42, null, undefined, {}, [], ['fitness.db'], true, Symbol.iterator, () => 'fitness.db',
];

describe('F1: backup name allowlist', () => {
  it('accepts exactly the names this app generates, including collision suffixes', () => {
    for (const [from, to, ts, attempt] of [[0, 1, 1, 0], [3, 6, T0, 0], [12, 13, 1_800_000_000_000, 1], [999_999, 999_999, 999_999_999_999_999, 49]] as const) {
      const n = backupName({ fromVersion: from, toVersion: to, timestamp: ts }, attempt);
      expect(isBackupName(n)).toBe(true);
      expect(BACKUP_NAME_PATTERN.test(n)).toBe(true);
    }
  });
  it.each(ADVERSARIAL.map((x, i) => [i, x]))('rejects adversarial value #%i', (_i, value) => {
    expect(isBackupName(value)).toBe(false);
  });
  it('parseBackupList drops everything that is not a valid, unique name and never throws', () => {
    expect(parseBackupList(null)).toEqual({ names: [], ignored: 0 });
    expect(parseBackupList('{not json')).toEqual({ names: [], ignored: 1 });
    expect(parseBackupList('{"a":1}')).toEqual({ names: [], ignored: 1 });
    expect(parseBackupList('"fitness.db"')).toEqual({ names: [], ignored: 1 });
    expect(parseBackupList(JSON.stringify([good(1), 'fitness.db', 7, null, { x: 1 }, good(1), '../x.db', good(2)]))).toEqual({ names: [good(1), good(2)], ignored: 6 });
  });
  it('keep is always clamped to a safe range (at least the new + previous backup)', () => {
    expect([clampKeep(undefined), clampKeep(0), clampKeep(1), clampKeep(-5), clampKeep(NaN), clampKeep(3), clampKeep(999), clampKeep(Infinity)]).toEqual([3, MIN_KEEP_BACKUPS, MIN_KEEP_BACKUPS, MIN_KEEP_BACKUPS, 3, 3, MAX_KEEP_BACKUPS, 3]);
  });

  describe('both strategies refuse to delete or open anything that is not a backup', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'fitness-f1-'));
      mkdirSync(join(dir, 'backups'));
      writeFileSync(join(dir, 'fitness.db'), 'LIVE DATABASE');
      writeFileSync(join(dir, 'fitness.db-wal'), 'WAL');
      writeFileSync(join(dir, 'unrelated.db'), 'PRECIOUS');
      writeFileSync(join(dir, 'backups', good(1)), 'a legitimate old backup');
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));
    const snapshot = () => readdirSync(dir).sort().join(',') + '|' + readFileSync(join(dir, 'fitness.db')).toString();
    const names = () => ADVERSARIAL.filter((x): x is string => typeof x === 'string').map((x) => x).concat(ADVERSARIAL as string[]);

    it('NodeFileBackupStrategy.prune: nothing is deleted; every refusal is reported', async () => {
      const before = snapshot();
      const res = await new NodeFileBackupStrategy(join(dir, 'backups')).prune(names());
      expect(res.removed).toEqual([]);
      expect(res.failed).toHaveLength(names().length);
      expect(res.failed.every((f) => f.message === 'refused: not a backup file name')).toBe(true);
      expect(snapshot()).toBe(before);
      expect(existsSync(join(dir, 'backups', good(1)))).toBe(true);
    });
    it('NodeFileBackupStrategy.prune: a legitimate backup in the same call IS still removed', async () => {
      const res = await new NodeFileBackupStrategy(join(dir, 'backups')).prune(['fitness.db', good(1), '../unrelated.db']);
      expect(res.removed).toEqual([good(1)]);
      expect(res.failed.map((f) => f.name)).toEqual(['fitness.db', '../unrelated.db']);
      expect(readFileSync(join(dir, 'fitness.db')).toString()).toBe('LIVE DATABASE');
      expect(existsSync(join(dir, 'unrelated.db'))).toBe(true);
    });
    it('NodeFileBackupStrategy.validate refuses non-backup names without opening them', async () => {
      const s = new NodeFileBackupStrategy(dir);
      for (const bad of ['fitness.db', '../fitness.db', 'unrelated.db']) await expect(s.validate({ name: bad }, { userVersion: 1 })).rejects.toThrow(/not a backup name/);
      expect(readFileSync(join(dir, 'fitness.db')).toString()).toBe('LIVE DATABASE');
    });

    const fakeApi = () => {
      const deleted: string[] = [];
      const opened: string[] = [];
      const api: ExpoSqliteApi = {
        openDatabaseAsync: async (n) => { opened.push(n); throw new Error('must not be opened'); },
        backupDatabaseAsync: async () => undefined,
        deleteDatabaseAsync: async (n) => { deleted.push(n); },
      };
      return { api, deleted, opened };
    };
    it('ExpoBackupStrategy.prune never calls deleteDatabaseAsync for a non-backup name', async () => {
      const f = fakeApi();
      const res = await new ExpoBackupStrategy(f.api, {} as SQLiteDatabase).prune(names());
      expect(f.deleted).toEqual([]);
      expect(res.removed).toEqual([]);
      expect(res.failed).toHaveLength(names().length);
    });
    it('ExpoBackupStrategy.prune still deletes legitimate names', async () => {
      const f = fakeApi();
      const res = await new ExpoBackupStrategy(f.api, {} as SQLiteDatabase).prune(['fitness.db', good(2), '../x', good(3)]);
      expect(f.deleted).toEqual([good(2), good(3)]);
      expect(res.removed).toEqual([good(2), good(3)]);
    });
    it('ExpoBackupStrategy.validate refuses before opening anything', async () => {
      const f = fakeApi();
      await expect(new ExpoBackupStrategy(f.api, {} as SQLiteDatabase).validate({ name: 'fitness.db' }, { userVersion: 1 })).rejects.toThrow(/not a backup name/);
      expect(f.opened).toEqual([]);
    });
  });

  describe('through the migration runner (the original E19 scenario)', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-f1r-')); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    async function populated() {
      const main = join(dir, 'fitness.db');
      const db = await Database.open(new NodeSqliteDriver(main));
      await runMigrations(db, { migrations: upTo(3) });
      await db.run("INSERT INTO profile(id,display_name,updated_at) VALUES (1,'Sara',1700000000000)");
      writeFileSync(join(dir, 'unrelated-user-file.db'), 'precious');
      return { db, main };
    }
    it('a corrupted/tampered stored list can NOT make an upgrade delete the live database or unrelated files', async () => {
      const { db, main } = await populated();
      const poisoned = ['fitness.db', 'unrelated-user-file.db', '../fitness.db', good(1), good(2), good(3)];
      for (const n of [1, 2, 3]) writeFileSync(join(dir, good(n)), 'x');
      await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, JSON.stringify(poisoned)]);
      const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir), keepBackups: 3 });
      expect(r.ok).toBe(true);
      expect(existsSync(main)).toBe(true);
      expect(readFileSync(join(dir, 'unrelated-user-file.db')).toString()).toBe('precious');
      expect(await db.all('SELECT display_name FROM profile')).toEqual([{ display_name: 'Sara' }]);
      const stored = JSON.parse((await db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [BACKUPS_META_KEY]))!.value);
      expect(stored.every(isBackupName)).toBe(true); // the poisoned entries were dropped from the stored list
      expect(stored).not.toContain('fitness.db');
      expect(r.ok && r.value.warnings.join(' ')).toMatch(/ignored 3 invalid entries/);
    });
    it.each([
      ['not JSON', '{oops'], ['an object', '{"fitness.db":true}'], ['a string', '"fitness.db"'], ['a number', '7'],
      ['entries of the wrong type', '[1,null,{"a":1},["fitness.db"]]'], ['only traversal', '["../fitness.db","/abs/path.db","a/b.db"]'],
    ])('corrupted bookkeeping (%s) is tolerated and deletes nothing', async (_l, raw) => {
      const { db, main } = await populated();
      await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, raw]);
      const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir) });
      expect(r.ok).toBe(true);
      expect(existsSync(main) && existsSync(join(dir, 'unrelated-user-file.db'))).toBe(true);
    });
    it('a strategy that returns an invalid name is rejected before anything is pruned or opened; nothing changes', async () => {
      const { db, main } = await populated();
      const calls: string[] = [];
      const rogue: BackupStrategy = {
        create: async () => ({ name: 'fitness.db' }),
        validate: async () => { calls.push('validate'); },
        prune: async (n) => { calls.push('prune:' + n.join('|')); return { removed: n, failed: [] }; },
      };
      expect(errorOf(await runMigrations(db, { backup: rogue }))).toMatchObject({ kind: 'backup_failed', message: expect.stringMatching(/not a valid backup name/) });
      expect(calls).toEqual([]);
      expect(await version(db)).toBe(3);
      expect(existsSync(main)).toBe(true);
    });
    it('an invalid-name list cannot reach a custom strategy either: prune receives allowlisted names only', async () => {
      const { db } = await populated();
      const real = new NodeFileBackupStrategy(dir);
      const seen: string[][] = [];
      await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, JSON.stringify(['fitness.db', good(1), good(2), good(3), '../x'])]);
      await runMigrations(db, { backup: { create: (s, c) => real.create(s, c), validate: (r, e) => real.validate(r, e), prune: async (n) => (seen.push(n), { removed: [], failed: [] }) }, keepBackups: 3 });
      expect(seen.flat().every(isBackupName)).toBe(true);
    });
  });
});

describe('F4: backups cannot accumulate without bound', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-f4-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const backupsOnDisk = () => readdirSync(dir).filter((f) => f.startsWith('fitness-premigrate-')).sort();

  async function populatedV3() {
    const db = await Database.open(new NodeSqliteDriver(join(dir, 'fitness.db')));
    await runMigrations(db, { migrations: upTo(3) });
    await db.run("INSERT INTO profile(id,display_name,updated_at) VALUES (1,'Sara',1700000000000)");
    return db;
  }
  const failing: Migration[] = [...upTo(3), { version: 4, name: 'bad', sql: 'NOPE' }];

  it('many failed launches keep at most `keep` backups, tracked exactly, with the newest valid and the data untouched', async () => {
    const db = await populatedV3();
    const strategy = new NodeFileBackupStrategy(dir);
    const clock = new ManualClock(T0);
    for (let launch = 1; launch <= 12; launch++) {
      clock.advance(H);
      expect(errorOf(await runMigrations(db, { migrations: failing, backup: strategy, clock, keepBackups: 3 })).kind).toBe('migration');
      expect(backupsOnDisk().length).toBeLessThanOrEqual(3);
    }
    const tracked = JSON.parse((await db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [BACKUPS_META_KEY]))!.value) as string[];
    expect(tracked.slice().sort()).toEqual(backupsOnDisk()); // nothing orphaned, nothing phantom
    expect(tracked).toHaveLength(3);
    expect(tracked[2]).toBe(backupName({ fromVersion: 3, toVersion: 4, timestamp: T0 + 12 * H }));
    await strategy.validate({ name: tracked[2] }, { userVersion: 3 }); // the newest recovery copy is valid
    expect(await version(db)).toBe(3);
    expect(await db.all('SELECT display_name FROM profile')).toEqual([{ display_name: 'Sara' }]);
  });
  it('the retention bound holds for every allowed `keep`, and keep is never below 2 (the previous valid copy always survives)', async () => {
    for (const keep of [0, 1, 2, 5, 50]) {
      const d = mkdtempSync(join(tmpdir(), 'fitness-f4k-'));
      const db = await Database.open(new NodeSqliteDriver(join(d, 'fitness.db')));
      await runMigrations(db, { migrations: upTo(3) });
      const strategy = new NodeFileBackupStrategy(d);
      const clock = new ManualClock(T0);
      for (let i = 0; i < 14; i++) { clock.advance(H); await runMigrations(db, { migrations: failing, backup: strategy, clock, keepBackups: keep }); }
      const n = readdirSync(d).filter((f) => f.startsWith('fitness-premigrate-')).length;
      expect(n).toBe(clampKeep(keep));
      expect(n).toBeGreaterThanOrEqual(2);
      rmSync(d, { recursive: true, force: true });
    }
  });
  it('a valid recovery backup is never deleted before its replacement is validated (the replacement fails validation -> nothing is trimmed)', async () => {
    const db = await populatedV3();
    const real = new NodeFileBackupStrategy(dir);
    const clock = new ManualClock(T0);
    for (let i = 0; i < 3; i++) { clock.advance(H); await runMigrations(db, { migrations: failing, backup: real, clock, keepBackups: 3 }); }
    const before = backupsOnDisk();
    expect(before).toHaveLength(3);
    const corrupting: BackupStrategy = { create: async (s, c) => { const rec = await real.create(s, c); writeFileSync(join(dir, rec.name), 'garbage'); return rec; }, validate: (r, e) => real.validate(r, e), prune: (n) => real.prune(n) };
    clock.advance(H);
    expect(errorOf(await runMigrations(db, { migrations: failing, backup: corrupting, clock, keepBackups: 3 })).kind).toBe('backup_failed');
    expect(backupsOnDisk()).toEqual(before); // every previous valid copy is still there, the bad new one was removed
    for (const name of before) await real.validate({ name }, { userVersion: 3 });
  });
  it('failed launches followed by a successful upgrade still leave a bounded, valid set of backups', async () => {
    const db = await populatedV3();
    const strategy = new NodeFileBackupStrategy(dir);
    const clock = new ManualClock(T0);
    for (let i = 0; i < 6; i++) { clock.advance(H); await runMigrations(db, { migrations: failing, backup: strategy, clock, keepBackups: 3 }); }
    clock.advance(H);
    const ok = await runMigrations(db, { backup: strategy, clock, keepBackups: 3 });
    expect(ok.ok).toBe(true);
    expect(await version(db)).toBe(LATEST_VERSION);
    const files = backupsOnDisk();
    expect(files).toHaveLength(3);
    await strategy.validate({ name: (ok as any).value.backup }, { userVersion: 3 });
  });
  it('a populated database that has no bookkeeping table yet is tracked once it does (after the upgrade)', async () => {
    const db = await Database.open(new NodeSqliteDriver(join(dir, 'fitness.db')));
    await db.exec("CREATE TABLE somebody_elses_data(x TEXT); INSERT INTO somebody_elses_data VALUES ('keep me')");
    const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir) });
    expect(r.ok).toBe(true);
    const tracked = JSON.parse((await db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [BACKUPS_META_KEY]))!.value);
    expect(tracked).toEqual([(r as any).value.backup]);
    expect(await db.all('SELECT x FROM somebody_elses_data')).toEqual([{ x: 'keep me' }]);
  });
  it('repeated failures on a database WITHOUT bookkeeping (user_version 0 + foreign tables) remain untracked: documented residual limit', async () => {
    const db = await Database.open(new NodeSqliteDriver(join(dir, 'fitness.db')));
    await db.exec("CREATE TABLE somebody_elses_data(x TEXT); INSERT INTO somebody_elses_data VALUES ('keep me')");
    const bad: Migration[] = [{ version: 1, name: 'bad', sql: 'NOPE' }];
    const clock = new ManualClock(T0);
    for (let i = 0; i < 3; i++) { clock.advance(H); await runMigrations(db, { migrations: bad, backup: new NodeFileBackupStrategy(dir), clock }); }
    expect(backupsOnDisk()).toHaveLength(3); // cannot be trimmed: there is nowhere safe to record them. Unreachable for the app's own file.
    expect(await db.all('SELECT x FROM somebody_elses_data')).toEqual([{ x: 'keep me' }]);
  });
});

describe('F6: migrations can no longer silently lose data (row-loss guard, incl. foreign-key cascades)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-f6-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const rebuild = (extra: Partial<Migration> = {}): Migration => ({
    version: LATEST_VERSION + 1, name: 'rebuild workout_templates', ...extra,
    sql: `CREATE TABLE workout_templates_new(id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL, notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, extra TEXT) STRICT;
      INSERT INTO workout_templates_new(id,name,notes,created_at,updated_at) SELECT id,name,notes,created_at,updated_at FROM workout_templates;
      DROP TABLE workout_templates; ALTER TABLE workout_templates_new RENAME TO workout_templates;`,
  });
  async function withTemplate() {
    const env = await createRepoEnv();
    const ex = unwrap(await env.repos.exercises.create({ name: 'Bench', category: 'strength', primaryMuscle: 'chest', equipment: 'barbell', trackingType: 'weight_reps' }));
    unwrap(await env.repos.templates.create({ name: 'T', exercises: [{ exerciseId: ex.id, targetSets: 3, targetRepsMin: 5, restSec: 30 }] }));
    return env;
  }
  const count = async (db: Database, t: string) => Number((await db.first<{ c: number }>(`SELECT count(*) c FROM ${t}`))!.c);

  it('a rebuild migration that cascade-deletes child rows is rolled back as a whole (it used to report success)', async () => {
    const env = await withTemplate();
    const r = await runMigrations(env.db, { migrations: [...MIGRATIONS, rebuild()], backup: new NodeFileBackupStrategy(dir) });
    expect(errorOf(r)).toMatchObject({ kind: 'migration', version: LATEST_VERSION + 1, message: expect.stringMatching(/template_exercises.*1 -> 0/) });
    expect(await version(env.db)).toBe(LATEST_VERSION);
    expect(await count(env.db, 'template_exercises')).toBe(1);
    expect(await env.db.all("SELECT name FROM sqlite_master WHERE name='workout_templates_new'")).toEqual([]); // fully rolled back
  });
  it('the same migration is allowed when it explicitly declares allowRowLoss', async () => {
    const env = await withTemplate();
    const r = await runMigrations(env.db, { migrations: [...MIGRATIONS, rebuild({ allowRowLoss: true })], backup: new NodeFileBackupStrategy(dir) });
    expect(r.ok).toBe(true);
    expect(await version(env.db)).toBe(LATEST_VERSION + 1);
  });
  it('a plain DELETE or a DROP of a table that holds rows is caught; dropping an EMPTY table is fine', async () => {
    const env = await withTemplate();
    unwrap(await env.repos.profile.save({ displayName: 'Sara' }));
    const strategy = new NodeFileBackupStrategy(dir);
    expect(errorOf(await runMigrations(env.db, { migrations: [...MIGRATIONS, { version: LATEST_VERSION + 1, name: 'wipe', sql: 'DELETE FROM profile' }], backup: strategy }))).toMatchObject({ kind: 'migration', message: expect.stringMatching(/"profile" \(1 -> 0\)/) });
    expect(await count(env.db, 'profile')).toBe(1);
    expect(errorOf(await runMigrations(env.db, { migrations: [...MIGRATIONS, { version: LATEST_VERSION + 1, name: 'drop', sql: 'DROP TABLE template_exercises' }], backup: strategy }))).toMatchObject({ kind: 'migration', message: expect.stringMatching(/"template_exercises" \(1 -> 0\)/) });
    expect(await count(env.db, 'template_exercises')).toBe(1);
    expect(await version(env.db)).toBe(LATEST_VERSION);
    const empty = await runMigrations(env.db, { migrations: [...MIGRATIONS, { version: LATEST_VERSION + 1, name: 'drop-empty', sql: 'DROP TABLE habit_logs' }], backup: strategy });
    expect(empty.ok).toBe(true); // habit_logs held no rows, so nothing was lost
  });
  it('additive migrations (new tables, new rows, new columns) are unaffected', async () => {
    const env = await withTemplate();
    const r = await runMigrations(env.db, { migrations: [...MIGRATIONS, { version: LATEST_VERSION + 1, name: 'additive', sql: 'ALTER TABLE profile ADD COLUMN nickname TEXT; CREATE TABLE extra(id INTEGER PRIMARY KEY); INSERT INTO extra VALUES (1); INSERT INTO app_meta(key,value) VALUES (\'k\',\'v\');' }], backup: new NodeFileBackupStrategy(dir) });
    expect(r.ok).toBe(true);
    expect(await count(env.db, 'template_exercises')).toBe(1);
  });
  it('none of the shipped migrations trips the guard on a populated v1..v5 database (upgrade matrix still passes)', async () => {
    for (const from of [1, 2, 3, 4, 5]) {
      const d = mkdtempSync(join(tmpdir(), 'fitness-f6u-'));
      const db = await Database.open(new NodeSqliteDriver(join(d, 'fitness.db')));
      await runMigrations(db, { migrations: upTo(from) });
      await db.run("INSERT INTO profile(id,display_name,updated_at) VALUES (1,'Sara',1700000000000)");
      expect((await runMigrations(db, { backup: new NodeFileBackupStrategy(d) })).ok).toBe(true);
      rmSync(d, { recursive: true, force: true });
    }
  });
});
