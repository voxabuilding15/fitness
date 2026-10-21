import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../db/database';
import { BACKUPS_META_KEY, backupName, type BackupStrategy } from '../../db/backup';
import { LATEST_VERSION, MIGRATIONS, type Migration } from '../../db/migrations';
import { runMigrations, validateMigrationList } from '../../db/migrations/runner';
import { NodeFileBackupStrategy } from '../../db/testing/nodeFileBackup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { ManualClock } from '../../domain/clock';
import { errorOf } from '../../db/testing/repoEnv';

const version = async (db: Database) => Number((await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version);
const tableNames = async (db: Database) => (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name);
const fresh = () => Database.open(new NodeSqliteDriver());
const upTo = (n: number): Migration[] => MIGRATIONS.slice(0, n) as Migration[];

const oldBackup = (n: number) => `fitness-premigrate-v1-to-v2-${1_000 + n}.db`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fitness-mig-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migrations from an empty database', () => {
  it('creates the full schema and sets user_version to the latest version', async () => {
    const db = await fresh();
    const r = await runMigrations(db);
    expect(r.ok && r.value).toMatchObject({ fromVersion: 0, toVersion: LATEST_VERSION, applied: [1, 2, 3, 4, 5, 6], backup: null });
    expect(await version(db)).toBe(6);
    expect(await tableNames(db)).toEqual([
      'app_meta', 'exercises', 'foods', 'goals', 'habit_logs', 'habits', 'meal_entries', 'profile',
      'session_exercises', 'session_sets', 'template_exercises', 'water_entries', 'weight_entries', 'workout_sessions', 'workout_templates',
    ]);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
  });
  it('a fresh database needs no backup (nothing to protect)', async () => {
    const db = await fresh();
    const calls: string[] = [];
    const spy: BackupStrategy = { create: async () => (calls.push('create'), { name: 'x' }), validate: async () => undefined, prune: async () => ({ removed: [], failed: [] }) };
    const r = await runMigrations(db, { backup: spy });
    expect(r.ok).toBe(true);
    expect(calls).toEqual([]);
  });
  it('is idempotent: running again changes nothing', async () => {
    const db = await fresh();
    await runMigrations(db);
    await db.run("INSERT INTO app_meta(key,value) VALUES ('k','v')");
    const again = await runMigrations(db);
    expect(again.ok && again.value).toMatchObject({ fromVersion: 6, toVersion: 6, applied: [] });
    expect((await db.first<{ value: string }>("SELECT value FROM app_meta WHERE key='k'"))?.value).toBe('v');
  });
  it('the shipped migration list is valid and ordered', () => {
    expect(validateMigrationList(MIGRATIONS)).toBeNull();
    expect(MIGRATIONS.map((m) => m.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(validateMigrationList([{ version: 2, name: 'x', sql: '' }])).toMatch(/without gaps/);
    expect(validateMigrationList([MIGRATIONS[0], MIGRATIONS[2]])).toMatch(/without gaps/);
  });
  it('rejects an invalid migration list without touching the database', async () => {
    const db = await fresh();
    const r = await runMigrations(db, { migrations: [MIGRATIONS[1]] });
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ kind: 'migration', version: 0 }) });
    expect(await tableNames(db)).toEqual([]);
  });
});

describe('failure behaviour', () => {
  const broken = (at: number): Migration[] => [...upTo(at - 1), { version: at, name: 'broken', sql: 'CREATE TABLE ok_table(id INTEGER); THIS IS NOT SQL;' }];

  it('rolls back EVERYTHING (earlier migrations and user_version too) when one migration fails', async () => {
    const db = await fresh();
    const r = await runMigrations(db, { migrations: broken(3) });
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ kind: 'migration', version: 3 }) });
    expect(await version(db)).toBe(0);
    expect(await tableNames(db)).toEqual([]); // no half-built schema
  });
  it('a failed upgrade of a populated database leaves its data and version untouched', async () => {
    const path = join(dir, 'app.db');
    const db = await Database.open(new NodeSqliteDriver(path));
    expect((await runMigrations(db, { migrations: upTo(3) })).ok).toBe(true);
    await db.run("INSERT INTO profile(id,display_name,updated_at) VALUES (1,'Sara',1700000000000)");
    const r = await runMigrations(db, { migrations: [...upTo(3), { version: 4, name: 'broken', sql: 'CREATE TABLE t(a); NOPE;' }], backup: new NodeFileBackupStrategy(dir) });
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ kind: 'migration', version: 4 }) });
    expect(await version(db)).toBe(3);
    expect((await db.first<{ display_name: string }>('SELECT display_name FROM profile'))?.display_name).toBe('Sara');
    expect(await tableNames(db)).not.toContain('t');
    expect(readdirSync(dir).some((f) => f.startsWith('fitness-premigrate-'))).toBe(true); // the safety copy was taken before the attempt
  });
  it('rolls back when the final foreign_key_check finds violations', async () => {
    const db = await fresh();
    const sneaky: Migration[] = [
      { version: 1, name: 'orphans', sql: 'PRAGMA defer_foreign_keys=ON; CREATE TABLE p(id INTEGER PRIMARY KEY); CREATE TABLE c(pid INTEGER REFERENCES p(id)); INSERT INTO c VALUES (7);' },
    ];
    const r = await runMigrations(db, { migrations: sneaky });
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ kind: 'migration', message: expect.stringMatching(/foreign_key_check|FOREIGN KEY/) }) });
    expect(await version(db)).toBe(0);
    expect(await tableNames(db)).toEqual([]);
  });
  it('refuses a database created by a NEWER app (db_too_new) and changes nothing', async () => {
    const db = await fresh();
    await db.exec('CREATE TABLE precious(x TEXT); INSERT INTO precious VALUES (\'keep\'); PRAGMA user_version = 99;');
    const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir) });
    expect(r).toEqual({ ok: false, error: { kind: 'db_too_new', found: 99, supported: 6 } });
    expect(await version(db)).toBe(99);
    expect(await db.all('SELECT x FROM precious')).toEqual([{ x: 'keep' }]);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('backups before upgrading a populated database', () => {
  async function populatedV3(path = join(dir, 'app.db')) {
    const db = await Database.open(new NodeSqliteDriver(path));
    await runMigrations(db, { migrations: upTo(3) });
    await db.run("INSERT INTO profile(id,display_name,updated_at) VALUES (1,'Sara',1700000000000)");
    return db;
  }

  it('creates a validated backup of the OLD schema/data, then upgrades and records it', async () => {
    const db = await populatedV3();
    const clock = new ManualClock(1_800_000_000_000);
    const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir), clock });
    expect(r.ok && r.value).toMatchObject({ fromVersion: 3, toVersion: 6, applied: [4, 5, 6], backup: backupName({ fromVersion: 3, toVersion: 6, timestamp: clock.now() }) });
    expect(await version(db)).toBe(6);
    // the backup is a real, separate database frozen at v3 with the user's data
    const copy = new NodeSqliteDriver(join(dir, (r as any).value.backup));
    expect((await copy.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version).toBe(3);
    expect(await copy.all('SELECT display_name FROM profile')).toEqual([{ display_name: 'Sara' }]);
    await copy.close();
    expect(JSON.parse((await db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [BACKUPS_META_KEY]))!.value)).toEqual([(r as any).value.backup]);
  });
  it('never overwrites an existing backup: a taken name is skipped and its content is left byte-for-byte', async () => {
    const db = await populatedV3();
    const clock = new ManualClock(1_800_000_000_000);
    const taken = join(dir, backupName({ fromVersion: 3, toVersion: 6, timestamp: clock.now() }));
    writeFileSync(taken, 'SOMEONE ELSES BACKUP');
    const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir), clock });
    expect(r.ok && r.value.backup).toMatch(/-1\.db$/);
    expect(readFileSync(taken).toString()).toBe('SOMEONE ELSES BACKUP');
    expect(await version(db)).toBe(6);
  });
  it('REFUSES to migrate a populated database when no backup strategy is available', async () => {
    const db = await populatedV3();
    const r = await runMigrations(db);
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ kind: 'backup_failed' }) });
    expect(await version(db)).toBe(3);
    expect(await db.all('SELECT display_name FROM profile')).toEqual([{ display_name: 'Sara' }]);
  });
  it('stops (nothing changed, data intact) if creating the backup fails', async () => {
    const db = await populatedV3();
    const failing: BackupStrategy = { create: async () => { throw new Error('disk full'); }, validate: async () => undefined, prune: async () => ({ removed: [], failed: [] }) };
    const r = await runMigrations(db, { backup: failing });
    expect(r).toEqual({ ok: false, error: { kind: 'backup_failed', message: 'disk full' } });
    expect(await version(db)).toBe(3);
    expect(await tableNames(db)).not.toContain('foods');
    expect(await db.all('SELECT display_name FROM profile')).toEqual([{ display_name: 'Sara' }]);
  });
  it('stops if the new backup fails validation, and discards only that unusable copy', async () => {
    const db = await populatedV3();
    const real = new NodeFileBackupStrategy(dir);
    const log: string[] = [];
    const corrupting: BackupStrategy = {
      create: async (s, c) => { const rec = await real.create(s, c); writeFileSync(join(dir, rec.name), 'garbage, not sqlite'); log.push('create'); return rec; },
      validate: (rec, e) => { log.push('validate'); return real.validate(rec, e); },
      prune: (names) => { log.push(`prune:${names.length}`); return real.prune(names); },
    };
    const r = await runMigrations(db, { backup: corrupting });
    expect(r).toEqual({ ok: false, error: expect.objectContaining({ kind: 'backup_failed' }) });
    expect(await version(db)).toBe(3);
    expect(log).toEqual(['create', 'validate', 'prune:1']);
    expect(readdirSync(dir).filter((f) => f.startsWith('fitness-premigrate-'))).toEqual([]);
  });
  it('validates the new backup BEFORE migrating, and trims old copies only AFTER the new one is validated', async () => {
    const db = await populatedV3();
    const real = new NodeFileBackupStrategy(dir);
    const log: string[] = [];
    const spy: BackupStrategy = {
      create: (s, c) => (log.push('create'), real.create(s, c)),
      validate: (r, e) => (log.push('validate'), real.validate(r, e)),
      prune: (n) => (log.push(`prune:${n.length}`), real.prune(n)),
    };
    for (const n of [1, 2, 3]) writeFileSync(join(dir, oldBackup(n)), 'x');
    await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, JSON.stringify([1, 2, 3].map(oldBackup))]);
    const r = await runMigrations(db, { backup: spy, keepBackups: 3 });
    expect(r.ok).toBe(true);
    expect(log).toEqual(['create', 'validate', 'prune:1']);
    expect(existsSync(join(dir, oldBackup(1)))).toBe(false); // oldest removed, but only once the replacement was proven valid
    expect(existsSync(join(dir, oldBackup(2))) && existsSync(join(dir, oldBackup(3)))).toBe(true);
    const list = JSON.parse((await db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [BACKUPS_META_KEY]))!.value);
    expect(list).toHaveLength(3);
    expect(list.slice(0, 2)).toEqual([oldBackup(2), oldBackup(3)]);
  });
  it('when the migration fails, the NEW backup is already validated and kept; old ones are trimmed only after that validation', async () => {
    const db = await populatedV3();
    const real = new NodeFileBackupStrategy(dir);
    const log: string[] = [];
    for (const n of [1, 2, 3]) writeFileSync(join(dir, oldBackup(n)), 'x');
    await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, JSON.stringify([1, 2, 3].map(oldBackup))]);
    const spy: BackupStrategy = { create: (s, c) => (log.push('create'), real.create(s, c)), validate: (r, e) => (log.push('validate'), real.validate(r, e)), prune: (n) => (log.push(`prune:${n.length}`), real.prune(n)) };
    const r = await runMigrations(db, { migrations: [...upTo(3), { version: 4, name: 'bad', sql: 'NOPE' }], backup: spy, keepBackups: 3 });
    expect(r.ok).toBe(false);
    expect(log).toEqual(['create', 'validate', 'prune:1']);
    expect(await version(db)).toBe(3);
    expect(await db.all('SELECT display_name FROM profile')).toEqual([{ display_name: 'Sara' }]);
    const newest = readdirSync(dir).filter((f) => f.startsWith('fitness-premigrate-v3-to-v4-'));
    expect(newest).toHaveLength(1);
    await real.validate({ name: newest[0] }, { userVersion: 3 }); // the replacement is a valid, readable recovery copy
  });
  it('a failed attempt whose NEW backup cannot be created leaves every older recovery backup untouched', async () => {
    const db = await populatedV3();
    for (const n of [1, 2, 3]) writeFileSync(join(dir, oldBackup(n)), 'x');
    await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, JSON.stringify([1, 2, 3].map(oldBackup))]);
    const pruned: string[][] = [];
    const failing: BackupStrategy = { create: async () => { throw new Error('disk full'); }, validate: async () => undefined, prune: async (n) => (pruned.push(n), { removed: [], failed: [] }) };
    expect(errorOf(await runMigrations(db, { backup: failing, keepBackups: 3 }))).toMatchObject({ kind: 'backup_failed' });
    expect(pruned).toEqual([]);
    for (const n of [1, 2, 3]) expect(existsSync(join(dir, oldBackup(n)))).toBe(true);
  });
  it('a cleanup (prune) failure is only a warning: the upgrade and the new backup stay valid', async () => {
    const db = await populatedV3();
    const real = new NodeFileBackupStrategy(dir);
    for (const n of [1, 2]) writeFileSync(join(dir, oldBackup(n)), 'x');
    await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, JSON.stringify([1, 2].map(oldBackup))]);
    const flaky: BackupStrategy = { create: (s, c) => real.create(s, c), validate: (r, e) => real.validate(r, e), prune: async (n) => ({ removed: [], failed: n.map((name) => ({ name, message: 'EBUSY' })) }) };
    const r = await runMigrations(db, { backup: flaky, keepBackups: 2 });
    expect(r.ok && r.value.warnings).toEqual([expect.stringContaining('EBUSY')]);
    expect(await version(db)).toBe(6);
    expect(existsSync(join(dir, oldBackup(1)))).toBe(true); // retained, and still tracked for a later retry
    const list = JSON.parse((await db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [BACKUPS_META_KEY]))!.value);
    expect(list).toContain(oldBackup(1));
    expect(await db.all('SELECT display_name FROM profile')).toEqual([{ display_name: 'Sara' }]);
    expect(await db.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    await real.validate({ name: (r as any).value.backup }, { userVersion: 3 }); // the new backup is untouched and valid
  });
  it('a prune that throws outright is also contained: the upgrade still succeeds and the new backup stays', async () => {
    const db = await populatedV3();
    const real = new NodeFileBackupStrategy(dir);
    await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, JSON.stringify([1, 2].map(oldBackup))]);
    const throwing: BackupStrategy = { create: (s, c) => real.create(s, c), validate: (r, e) => real.validate(r, e), prune: async () => { throw new Error('kaboom'); } };
    const r = await runMigrations(db, { backup: throwing, keepBackups: 2 });
    expect(r.ok && r.value.warnings.join(' ')).toMatch(/bookkeeping failed: kaboom/);
    expect(await version(db)).toBe(6);
    expect(readdirSync(dir).filter((f) => f.startsWith('fitness-premigrate-v3-to-v6-'))).toHaveLength(1);
  });
  it('tolerates corrupt bookkeeping JSON', async () => {
    const db = await populatedV3();
    await db.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [BACKUPS_META_KEY, '{not json']);
    const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir) });
    expect(r.ok).toBe(true);
    expect(await version(db)).toBe(6);
  });
});
