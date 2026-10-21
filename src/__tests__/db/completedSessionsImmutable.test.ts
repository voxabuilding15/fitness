import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { Database } from '../../db/database';
import { LATEST_VERSION, MIGRATIONS } from '../../db/migrations';
import { runMigrations } from '../../db/migrations/runner';
import { createRepositories } from '../../db/repositories';
import { runSeed } from '../../db/seedRunner';
import { NodeFileBackupStrategy } from '../../db/testing/nodeFileBackup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { ManualClock } from '../../domain/clock';
import { T0, errorOf, unwrap } from '../../db/testing/repoEnv';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-m9-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const triggers = async (db: Database) => (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='trigger'")).map((r) => r.name);

/** A v8 database that already holds one completed, one discarded and one running session. */
async function v8() {
  const db = await Database.open(new NodeSqliteDriver(join(dir, 'fitness.db')));
  expect((await runMigrations(db, { migrations: MIGRATIONS.slice(0, 8) as never })).ok).toBe(true);
  unwrap(await runSeed(db, SEED_PACK, new ManualClock(T0)));
  const ex = (await db.all<{ id: number }>('SELECT id FROM exercises ORDER BY id LIMIT 2')).map((r) => r.id);
  const sql = [
    "INSERT INTO workout_sessions(name,status,started_at,local_date) VALUES ('Done','in_progress',?,'2026-10-19')",
    'INSERT INTO session_exercises(session_id,exercise_id,position) VALUES (1,?,1)',
    'INSERT INTO session_sets(session_exercise_id,set_number,reps,weight_kg,is_completed,completed_at) VALUES (1,1,8,40,1,?)',
    "UPDATE workout_sessions SET status='completed', ended_at=? WHERE id=1",
    "INSERT INTO workout_sessions(name,status,started_at,local_date) VALUES ('Dropped','in_progress',?,'2026-10-20')",
    'INSERT INTO session_exercises(session_id,exercise_id,position) VALUES (2,?,1)',
    "UPDATE workout_sessions SET status='discarded', discarded_at=? WHERE id=2",
    "INSERT INTO workout_sessions(name,status,started_at,local_date) VALUES ('Running','in_progress',?,'2026-10-21')",
    'INSERT INTO session_exercises(session_id,exercise_id,position) VALUES (3,?,1)',
  ];
  const args = [[T0 - 9e7], [ex[0]], [T0 - 88e6], [T0 - 86e6], [T0 - 5e7], [ex[1]], [T0 - 4e7], [T0], [ex[0]]];
  for (let i = 0; i < sql.length; i++) await db.run(sql[i], args[i]);
  return db;
}

describe('migration 009 on a database that already holds sessions', () => {
  it('keeps every row, installs the new triggers, removes the three it makes unreachable, and then protects the completed session', async () => {
    const db = await v8();
    const before = {
      sessions: await db.all('SELECT * FROM workout_sessions ORDER BY id'),
      exercises: await db.all('SELECT * FROM session_exercises ORDER BY id'),
      sets: await db.all('SELECT * FROM session_sets ORDER BY id'),
    };
    const old = await triggers(db);
    expect(old).toEqual(expect.arrayContaining(['session_exercises_keep_completed_del', 'session_sets_keep_completed_upd', 'session_sets_keep_completed_del']));

    const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir), clock: new ManualClock(T0) });
    expect(r.ok && r.value).toMatchObject({ fromVersion: 8, toVersion: LATEST_VERSION, applied: [9] });
    expect(await db.all('SELECT * FROM workout_sessions ORDER BY id')).toEqual(before.sessions);
    expect(await db.all('SELECT * FROM session_exercises ORDER BY id')).toEqual(before.exercises);
    expect(await db.all('SELECT * FROM session_sets ORDER BY id')).toEqual(before.sets);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);

    const now = await triggers(db);
    for (const t of ['session_exercises_completed_ins', 'session_exercises_completed_upd', 'session_exercises_completed_del', 'session_sets_completed_ins', 'session_sets_completed_upd', 'session_sets_completed_del']) expect(now).toContain(t);
    for (const t of ['session_exercises_keep_completed_del', 'session_sets_keep_completed_upd', 'session_sets_keep_completed_del']) expect(now).not.toContain(t);
    // everything else that guarded sessions is still there
    for (const t of old.filter((n) => !n.includes('keep_completed'))) expect(now).toContain(t);

    // the history that was completed before the upgrade is protected afterwards
    const repos = createRepositories({ db, clock: new ManualClock(T0), utcOffsetMinutes: () => 0 });
    expect(errorOf(await repos.sessions.addSet(1, { reps: 5, isCompleted: true }))).toMatchObject({ kind: 'immutable', reason: 'completed_session' });
    expect(errorOf(await repos.sessions.deleteSet(1))).toMatchObject({ kind: 'immutable', reason: 'completed_session' });
    expect(errorOf(await repos.sessions.addSet(2, { reps: 5, isCompleted: true }))).toMatchObject({ kind: 'immutable', reason: 'discarded_session' });
    // the running session is untouched by it
    expect(unwrap(await repos.sessions.addSet(3, { reps: 5, weightKg: 20, isCompleted: true })).setNumber).toBe(1);
    expect(unwrap(await repos.sessions.complete(3, {})).status).toBe('completed');
    expect(errorOf(await repos.sessions.deleteSet(2))).toMatchObject({ kind: 'immutable', reason: 'completed_session' });
    await db.close();
  });

  it('a failing step leaves the database at v8 with all its triggers and data (all-or-nothing)', async () => {
    const db = await v8();
    const broken = [...MIGRATIONS.slice(0, 8), { ...MIGRATIONS[8], sql: `${MIGRATIONS[8].sql}\nSELECT * FROM table_that_does_not_exist;` }];
    const r = await runMigrations(db, { migrations: broken as never, backup: new NodeFileBackupStrategy(dir) });
    expect(errorOf(r)).toMatchObject({ kind: 'migration', version: 9 });
    expect(Number((await db.first<{ user_version: number }>('PRAGMA user_version'))!.user_version)).toBe(8);
    const names = await triggers(db);
    expect(names).toContain('session_sets_keep_completed_del'); // the dropped triggers came back with the rollback
    expect(names).not.toContain('session_sets_completed_ins');
    expect(Number((await db.first<{ n: number }>('SELECT COUNT(*) n FROM session_sets'))!.n)).toBe(1);
    await db.close();
  });
});
