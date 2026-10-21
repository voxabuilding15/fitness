import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../db/database';
import { importLegacyProfile } from '../../db/legacyImport';
import { MIGRATIONS, type Migration, LATEST_VERSION } from '../../db/migrations';
import { createRepositories } from '../../db/repositories';
import { runMigrations } from '../../db/migrations/runner';
import { NodeFileBackupStrategy } from '../../db/testing/nodeFileBackup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { createRepoEnv, errorOf, T0, unwrap } from '../../db/testing/repoEnv';
import { ManualClock } from '../../domain/clock';

const upTo = (n: number): Migration[] => MIGRATIONS.slice(0, n) as Migration[];
const version = async (db: Database) => Number((await db.first<{ user_version: number }>('PRAGMA user_version'))!.user_version);
const schemaOf = (db: Database) => db.all<{ type: string; name: string; sql: string | null }>("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name");

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-upg-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Rows that are valid at the given schema version, so each upgrade starts from a realistic populated database. */
async function populate(db: Database, v: number) {
  const T = 1_700_000_000_000;
  if (v >= 1) await db.run("INSERT INTO profile(id,display_name,updated_at) VALUES (1,'Sara',?)", [T]);
  if (v >= 2) {
    await db.run("INSERT INTO exercises(source,custom_name,category,primary_muscle,equipment,tracking_type,created_at) VALUES ('user','Row','strength','back','cable','weight_reps',?)", [T]);
    await db.run('INSERT INTO workout_templates(name,created_at,updated_at) VALUES (?,?,?)', ['Pull', T, T]);
    await db.run('INSERT INTO template_exercises(template_id,exercise_id,position,target_sets,target_reps_min,rest_sec) VALUES (1,1,1,3,8,60)');
  }
  if (v >= 3) {
    await db.run("INSERT INTO workout_sessions(template_id,name,status,started_at,ended_at,local_date) VALUES (1,'Pull','in_progress',?,NULL,'2026-10-21')", [T]);
    await db.run('INSERT INTO session_exercises(session_id,exercise_id,position) VALUES (1,1,1)');
    await db.run('INSERT INTO session_sets(session_exercise_id,set_number,reps,weight_kg,is_completed,completed_at) VALUES (1,1,8,40,1,?)', [T + 60_000]);
    await db.run("UPDATE workout_sessions SET status='completed', ended_at=? WHERE id=1", [T + 3_600_000]);
  }
  if (v >= 4) {
    await db.run("INSERT INTO foods(source,custom_name,unit,kcal_per_100,protein_per_100,carbs_per_100,fat_per_100,default_serving,data_label,created_at) VALUES ('user','Rice','g',130,2.7,28,0.3,150,'user_entered',?)", [T]);
    await db.run("INSERT INTO meal_entries(local_date,meal_type,food_id,amount,kcal,protein_g,carbs_g,fat_g,logged_at) VALUES ('2026-10-21','lunch',1,200,260,5.4,56,0.6,?)", [T]);
  }
  if (v >= 5) {
    await db.run("INSERT INTO water_entries(local_date,amount_ml,logged_at) VALUES ('2026-10-21',500,?)", [T]);
    await db.run("INSERT INTO weight_entries(local_date,weight_kg,source,logged_at) VALUES ('2026-10-21',72.5,'manual',?)", [T]);
  }
}
const TABLES_BY_VERSION: Record<number, string[]> = {
  1: ['profile'], 2: ['profile', 'exercises', 'workout_templates', 'template_exercises'],
  3: ['profile', 'exercises', 'workout_templates', 'template_exercises', 'workout_sessions', 'session_exercises', 'session_sets'],
  4: ['profile', 'exercises', 'workout_templates', 'template_exercises', 'workout_sessions', 'session_exercises', 'session_sets', 'foods', 'meal_entries'],
  5: ['profile', 'exercises', 'workout_templates', 'template_exercises', 'workout_sessions', 'session_exercises', 'session_sets', 'foods', 'meal_entries', 'water_entries', 'weight_entries'],
};

describe('upgrade matrix: every older schema version upgrades to the latest with its data intact', () => {
  it.each([1, 2, 3, 4, 5])('from v%i: data preserved, schema identical to a fresh database, backup of the OLD version taken', async (from) => {
    const path = join(dir, `v${from}.db`);
    const old = await Database.open(new NodeSqliteDriver(path));
    expect((await runMigrations(old, { migrations: upTo(from) })).ok).toBe(true);
    await populate(old, from);
    const before: Record<string, number> = {};
    for (const t of TABLES_BY_VERSION[from]) before[t] = Number((await old.first<{ c: number }>(`SELECT count(*) c FROM ${t}`))!.c);
    expect(Object.values(before).every((n) => n >= 1)).toBe(true);

    const r = await runMigrations(old, { backup: new NodeFileBackupStrategy(dir), clock: new ManualClock(T0) });
    expect(r.ok && r.value).toMatchObject({ fromVersion: from, toVersion: LATEST_VERSION, applied: MIGRATIONS.slice(from).map((m) => m.version), warnings: [] });
    expect(await version(old)).toBe(LATEST_VERSION);

    for (const t of TABLES_BY_VERSION[from]) expect(Number((await old.first<{ c: number }>(`SELECT count(*) c FROM ${t}`))!.c)).toBe(before[t]); // nothing lost
    expect(await old.first('SELECT display_name FROM profile')).toEqual({ display_name: 'Sara' });
    expect(await old.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await old.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);

    const fresh = await Database.open(new NodeSqliteDriver());
    await runMigrations(fresh);
    expect(await schemaOf(old)).toEqual(await schemaOf(fresh)); // incremental == fresh, including triggers and indexes

    const backupFiles = readdirSync(dir).filter((f) => f.startsWith('fitness-premigrate-'));
    expect(backupFiles).toHaveLength(1);
    const copy = new NodeSqliteDriver(join(dir, backupFiles[0]));
    expect((await copy.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version).toBe(from);
    await copy.close();
  });

  it('data created in an old schema works with the NEW repositories after upgrading', async () => {
    const path = join(dir, 'v5.db');
    const old = await Database.open(new NodeSqliteDriver(path));
    await runMigrations(old, { migrations: upTo(5) });
    await populate(old, 5);
    expect((await runMigrations(old, { backup: new NodeFileBackupStrategy(dir) })).ok).toBe(true);
    const repos = createRepositories({ db: old, clock: new ManualClock(T0), utcOffsetMinutes: () => 0 });
    expect(unwrap(await repos.weight.latest())).toMatchObject({ weightKg: 72.5 });
    expect(unwrap(await repos.nutrition.dailyTotals('2026-10-21'))).toMatchObject({ kcal: 260 });
    const habit = unwrap(await repos.habits.create({ name: 'Walk', kind: 'boolean' })); // the new v6 tables work
    expect(habit.id).toBe(1);
  });
});

describe('migration ordering', () => {
  const logging = (n: number): Migration[] =>
    Array.from({ length: n }, (_, i) => ({
      version: i + 1, name: `m${i + 1}`,
      sql: i === 0 ? "CREATE TABLE order_log(id INTEGER PRIMARY KEY, m TEXT NOT NULL); INSERT INTO order_log(m) VALUES ('m1');" : `INSERT INTO order_log(m) VALUES ('m${i + 1}');`,
    }));
  it('runs pending migrations strictly in version order, once each', async () => {
    const db = await Database.open(new NodeSqliteDriver());
    expect((await runMigrations(db, { migrations: logging(4) })).ok).toBe(true);
    expect((await db.all<{ m: string }>('SELECT m FROM order_log ORDER BY id')).map((r) => r.m)).toEqual(['m1', 'm2', 'm3', 'm4']);
    await runMigrations(db, { migrations: logging(4) });
    expect(Number((await db.first<{ c: number }>('SELECT count(*) c FROM order_log'))!.c)).toBe(4); // re-running changes nothing
  });
  it('from an intermediate version only the missing migrations run, in order', async () => {
    const path = join(dir, 'mid.db');
    const db = await Database.open(new NodeSqliteDriver(path));
    await runMigrations(db, { migrations: logging(2) });
    const r = await runMigrations(db, { migrations: logging(5), backup: new NodeFileBackupStrategy(dir) });
    expect(r.ok && r.value.applied).toEqual([3, 4, 5]);
    expect((await db.all<{ m: string }>('SELECT m FROM order_log ORDER BY id')).map((r2) => r2.m)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
    expect(await version(db)).toBe(5);
  });
  it('an out-of-order or gapped list is rejected before anything runs', async () => {
    const db = await Database.open(new NodeSqliteDriver());
    const [a, b, c] = logging(3);
    for (const list of [[a, c], [b, a], [b]]) {
      expect(errorOf(await runMigrations(db, { migrations: list }))).toMatchObject({ kind: 'migration', version: 0 });
    }
    expect(await version(db)).toBe(0);
    expect(await db.all("SELECT name FROM sqlite_master WHERE name='order_log'")).toEqual([]);
  });
});

describe('populated-database detection', () => {
  it('a database with tables but user_version 0 is treated as populated: it needs a backup before anything changes', async () => {
    const path = join(dir, 'foreign.db');
    const db = await Database.open(new NodeSqliteDriver(path));
    await db.exec("CREATE TABLE somebody_elses_data(x TEXT); INSERT INTO somebody_elses_data VALUES ('keep me')");
    expect(errorOf(await runMigrations(db))).toMatchObject({ kind: 'backup_failed' });
    expect(await version(db)).toBe(0);
    expect(await db.all("SELECT name FROM sqlite_master WHERE name='profile'")).toEqual([]);
    expect((await runMigrations(db, { backup: new NodeFileBackupStrategy(dir) })).ok).toBe(true); // with a backup it proceeds
    expect(await db.all('SELECT x FROM somebody_elses_data')).toEqual([{ x: 'keep me' }]);
  });
});

describe('numeric binding assumptions (what the device driver may do)', () => {
  it('the Node driver binds every JS number as REAL, so tests already cover REAL-into-INTEGER on STRICT columns', async () => {
    const db = await Database.open(new NodeSqliteDriver());
    expect((await db.first<{ t: string }>('SELECT typeof(?) t', [250]))!.t).toBe('real');
    await db.exec('CREATE TABLE s(n INTEGER NOT NULL CHECK(n BETWEEN 1 AND 5000), f INTEGER NOT NULL CHECK(f IN(0,1))) STRICT');
    await db.run('INSERT INTO s(n,f) VALUES (?,?)', [250, 1]);
    expect(await db.first('SELECT typeof(n) AS n_type, typeof(f) AS f_type, n, f FROM s')).toEqual({ n_type: 'integer', f_type: 'integer', n: 250, f: 1 });
  });
  it('a fractional value can never reach an INTEGER column silently (and IDs bound as REAL still match)', async () => {
    const db = await Database.open(new NodeSqliteDriver());
    await db.exec('CREATE TABLE s(id INTEGER PRIMARY KEY NOT NULL, n INTEGER NOT NULL) STRICT; INSERT INTO s(n) VALUES (7)');
    await expect(db.run('INSERT INTO s(n) VALUES (?)', [2.5])).rejects.toMatchObject({ appError: { kind: 'unknown' } });
    expect(await db.all('SELECT n FROM s WHERE id=?', [1])).toEqual([{ n: 7 }]); // WHERE id = 1.0 matches integer id 1
  });
});

describe('concurrent repository use', () => {
  it('20 concurrent water additions all land and total exactly', async () => {
    const env = await createRepoEnv();
    await Promise.all(Array.from({ length: 20 }, () => env.repos.water.add({ amountMl: 100 })));
    expect(unwrap(await env.repos.water.day('2026-10-21'))).toEqual({ entryCount: 20, totalMl: 2000 });
  });
  it('15 concurrent sets on one exercise get unique, gap-free numbers 1..15', async () => {
    const env = await createRepoEnv();
    const ex = unwrap(await env.repos.exercises.create({ name: 'Bench', category: 'strength', primaryMuscle: 'chest', equipment: 'barbell', trackingType: 'weight_reps' }));
    const s = unwrap(await env.repos.sessions.start({ name: 'P', exerciseIds: [ex.id] }));
    const results = await Promise.all(Array.from({ length: 15 }, (_, i) => env.repos.sessions.addSet(s.exercises[0].id, { reps: i + 1 })));
    expect(results.every((r) => r.ok)).toBe(true);
    const sets = unwrap(await env.repos.sessions.get(s.id)).exercises[0].sets;
    expect(sets.map((x) => x.setNumber)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
  it('concurrent saves for the same weight day leave exactly one entry', async () => {
    const env = await createRepoEnv();
    const results = await Promise.all([70, 71, 72, 73, 74].map((w) => env.repos.weight.save({ weightKg: w })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(Number((await env.db.first<{ c: number }>('SELECT count(*) c FROM weight_entries'))!.c)).toBe(1);
  });
  it('a failing operation in the middle of concurrent work does not corrupt the others', async () => {
    const env = await createRepoEnv();
    const ex = unwrap(await env.repos.exercises.create({ name: 'Bench', category: 'strength', primaryMuscle: 'chest', equipment: 'barbell', trackingType: 'weight_reps' }));
    const results = await Promise.all([
      env.repos.water.add({ amountMl: 250 }),
      env.repos.templates.create({ name: 'Bad', exercises: [{ exerciseId: 9999, targetSets: 3, targetRepsMin: 5, restSec: 30 }] }),
      env.repos.water.add({ amountMl: 250 }),
      env.repos.templates.create({ name: 'Good', exercises: [{ exerciseId: ex.id, targetSets: 3, targetRepsMin: 5, restSec: 30 }] }),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, false, true, true]);
    expect(unwrap(await env.repos.water.day('2026-10-21'))).toEqual({ entryCount: 2, totalMl: 500 });
    expect(unwrap(await env.repos.templates.list()).map((t) => t.name)).toEqual(['Good']);
  });
});

describe('legacyImport on an unusable database', () => {
  it('returns an error result (never throws) and writes nothing to the store', async () => {
    const env = await createRepoEnv();
    await env.db.close();
    const calls: string[] = [];
    const store = { getItem: async (k: string) => (calls.push(k), JSON.stringify({ name: 'A', age: 30, heightCm: 170, weightKg: 60 })) };
    expect(errorOf(await importLegacyProfile(store, env.db, { clock: env.clock }))).toMatchObject({ kind: 'unavailable', reason: 'database_closed' });
    expect(calls).toEqual([]); // it did not even read before discovering the database was unusable
  });
});
