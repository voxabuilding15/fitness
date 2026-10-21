import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { Database } from '../../db/database';
import { MIGRATIONS, LATEST_VERSION } from '../../db/migrations';
import { runMigrations } from '../../db/migrations/runner';
import { createRepositories } from '../../db/repositories';
import { runSeed } from '../../db/seedRunner';
import { NodeFileBackupStrategy } from '../../db/testing/nodeFileBackup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { ManualClock } from '../../domain/clock';
import { T0, createRepoEnv, errorOf, unwrap, type RepoEnv } from '../../db/testing/repoEnv';

let env: RepoEnv;
beforeEach(async () => {
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
});

const idOf = async (slug: string) => unwrap(await env.repos.exercises.list()).find((e) => e.slug === slug)!.id;
const count = async (table: string) => (await env.db.first<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`))!.n;
const fiveTemplate = async () => {
  const slugs = ['bench_press', 'pull_up', 'back_squat', 'plank', 'running'];
  return unwrap(await env.repos.templates.create({
    name: 'Full body',
    exercises: [
      { exerciseId: await idOf(slugs[0]), targetSets: 4, targetRepsMin: 6, targetRepsMax: 8, restSec: 120 },
      { exerciseId: await idOf(slugs[1]), targetSets: 3, targetRepsMin: 10, restSec: 90 },
      { exerciseId: await idOf(slugs[2]), targetSets: 5, targetRepsMin: 5, targetRepsMax: 5, restSec: 180 },
      { exerciseId: await idOf(slugs[3]), targetSets: 2, targetDurationSec: 45, restSec: 30 },
      { exerciseId: await idOf(slugs[4]), targetSets: 1, targetDurationSec: 1200, restSec: 0 },
    ],
  }));
};
const plans = (s: { exercises: { plan: unknown }[] }) => s.exercises.map((e) => e.plan);

describe('the plan recorded when a session starts', () => {
  it('copies every target of every template row, in order', async () => {
    const t = await fiveTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    expect(s.exercises.map((e) => e.position)).toEqual([1, 2, 3, 4, 5]);
    expect(s.exercises.map((e) => e.exerciseId)).toEqual(t.exercises.map((e) => e.exerciseId));
    expect(plans(s)).toEqual([
      { sets: 4, repsMin: 6, repsMax: 8, durationSec: null, restSec: 120 },
      { sets: 3, repsMin: 10, repsMax: null, durationSec: null, restSec: 90 },
      { sets: 5, repsMin: 5, repsMax: 5, durationSec: null, restSec: 180 },
      { sets: 2, repsMin: null, repsMax: null, durationSec: 45, restSec: 30 },
      { sets: 1, repsMin: null, repsMax: null, durationSec: 1200, restSec: 0 },
    ]);
    expect(unwrap(await env.repos.sessions.get(s.id))).toEqual(s); // stored, not just returned
  });

  it('is not changed by editing the template afterwards', async () => {
    const t = await fiveTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    unwrap(await env.repos.templates.update(t.id, { name: 'Renamed', exercises: [{ exerciseId: await idOf('plank'), targetSets: 9, targetDurationSec: 10, restSec: 5 }] }));
    const after = unwrap(await env.repos.sessions.get(s.id));
    expect(plans(after)).toEqual(plans(s));
    expect(after.exercises.map((e) => e.exerciseId)).toEqual(s.exercises.map((e) => e.exerciseId));
    expect(after.name).toBe('Full body');
  });

  it('survives deleting the template', async () => {
    const t = await fiveTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    unwrap(await env.repos.templates.delete(t.id));
    const after = unwrap(await env.repos.sessions.get(s.id));
    expect(after.templateId).toBeNull();
    expect(plans(after)).toEqual(plans(s));
  });

  it('keeps a custom exercise\'s name as it was, while built-in exercises keep none (they are named by translation)', async () => {
    const mine = unwrap(await env.repos.exercises.create({ name: 'Cable woodchop', category: 'strength', primaryMuscle: 'core', equipment: 'cable', trackingType: 'reps_only' }));
    const t = unwrap(await env.repos.templates.create({ name: 'Core', exercises: [
      { exerciseId: mine.id, targetSets: 3, targetRepsMin: 10, restSec: 45 }, { exerciseId: await idOf('plank'), targetSets: 2, targetDurationSec: 30, restSec: 30 },
    ] }));
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    unwrap(await env.repos.exercises.update(mine.id, { name: 'Renamed later' }));
    const after = unwrap(await env.repos.sessions.get(s.id));
    expect(after.exercises.map((e) => e.exerciseName)).toEqual(['Cable woodchop', null]);
  });

  it('a session started without a template, or an exercise added by hand, records no plan', async () => {
    const s = unwrap(await env.repos.sessions.start({ name: 'Ad hoc', exerciseIds: [await idOf('pull_up')] }));
    expect(plans(s)).toEqual([null]);
    const added = unwrap(await env.repos.sessions.addExercise(s.id, await idOf('plank')));
    expect(added).toMatchObject({ plan: null, exerciseName: null });
    expect(plans(unwrap(await env.repos.sessions.get(s.id)))).toEqual([null, null]);
  });

  it('rolls back the whole start - session and every exercise row - if one row cannot be written', async () => {
    const t = await fiveTemplate();
    await env.db.exec("CREATE TRIGGER fail_third BEFORE INSERT ON session_exercises WHEN NEW.position=3 BEGIN SELECT RAISE(ABORT,'disk full'); END;");
    const r = await env.repos.sessions.start({ templateId: t.id });
    expect(r.ok).toBe(false);
    expect(await count('workout_sessions')).toBe(0);
    expect(await count('session_exercises')).toBe(0);
    expect(unwrap(await env.repos.sessions.getActive())).toBeNull();
    await env.db.exec('DROP TRIGGER fail_third');
    expect(unwrap(await env.repos.sessions.start({ templateId: t.id })).exercises).toHaveLength(5); // and a retry works
  });
});

describe('the database refuses a partial or altered plan', () => {
  const insert = (cols: string, vals: string) => env.db.exec(`INSERT INTO session_exercises(session_id,exercise_id,position,${cols}) VALUES ((SELECT id FROM workout_sessions),(SELECT id FROM exercises LIMIT 1),9,${vals})`);
  beforeEach(async () => {
    unwrap(await env.repos.sessions.start({ name: 'x', exerciseIds: [await idOf('pull_up')] }));
  });

  it.each([
    ['captured but no sets', 'plan_captured,plan_rest_sec,plan_reps_min', '1,60,8'],
    ['captured but no rest', 'plan_captured,plan_sets,plan_reps_min', '1,3,8'],
    ['captured with no reps and no duration', 'plan_captured,plan_sets,plan_rest_sec', '1,3,60'],
    ['a plan value without the captured flag', 'plan_sets', '3'],
    ['reps from above reps to', 'plan_captured,plan_sets,plan_rest_sec,plan_reps_min,plan_reps_max', '1,3,60,10,5'],
    ['sets out of range', 'plan_captured,plan_sets,plan_rest_sec,plan_reps_min', '1,21,60,8'],
    ['an empty name', 'exercise_name', "'  '"],
  ])('rejects %s', async (_label, cols, vals) => {
    await expect(insert(cols, vals)).rejects.toMatchObject({ appError: { kind: 'constraint', constraint: 'check' } });
  });

  it('rejects any later change to a recorded plan or name, and the plan stays as it was', async () => {
    const t = await fiveTemplate();
    unwrap(await env.repos.sessions.discard(unwrap(await env.repos.sessions.getActive())!.id));
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    await expect(env.db.exec(`UPDATE session_exercises SET plan_sets=2 WHERE session_id=${s.id}`)).rejects.toMatchObject({ appError: { kind: 'immutable', reason: 'session_plan' } });
    await expect(env.db.exec(`UPDATE session_exercises SET plan_captured=0, plan_sets=NULL, plan_rest_sec=NULL, plan_reps_min=NULL, plan_reps_max=NULL, plan_duration_sec=NULL WHERE session_id=${s.id}`)).rejects.toMatchObject({ appError: { kind: 'immutable' } });
    await expect(env.db.exec(`UPDATE session_exercises SET exercise_name='x' WHERE session_id=${s.id}`)).rejects.toMatchObject({ appError: { kind: 'immutable' } });
    expect(plans(unwrap(await env.repos.sessions.get(s.id)))).toEqual(plans(s));
    // other changes to the row (renumbering on removal) are still allowed
    unwrap(await env.repos.sessions.removeExercise(s.exercises[0].id));
    expect(unwrap(await env.repos.sessions.get(s.id)).exercises).toHaveLength(4);
  });
});

describe('upgrading a database that already holds sessions (v7 -> v8)', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-m8-')); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function v7() {
    const db = await Database.open(new NodeSqliteDriver(join(dir, 'fitness.db')));
    expect((await runMigrations(db, { migrations: MIGRATIONS.slice(0, 7) as never })).ok).toBe(true);
    const clock = new ManualClock(T0);
    unwrap(await runSeed(db, SEED_PACK, clock));
    const ex = (await db.all<{ id: number }>('SELECT id FROM exercises ORDER BY id LIMIT 3')).map((r) => r.id);
    await db.run("INSERT INTO workout_templates(name,created_at,updated_at) VALUES ('Old',?,?)", [T0, T0]);
    await db.run('INSERT INTO template_exercises(template_id,exercise_id,position,target_sets,target_reps_min,rest_sec) VALUES (1,?,1,3,8,60),(1,?,2,3,8,60)', [ex[0], ex[1]]);
    // an old in-progress session and an old completed one, both made before targets were recorded
    await db.run("INSERT INTO workout_sessions(template_id,name,status,started_at,local_date) VALUES (1,'Done','in_progress',?,'2026-10-20')", [T0 - 90_000_000]);
    await db.run('INSERT INTO session_exercises(session_id,exercise_id,position) VALUES (1,?,1),(1,?,2)', [ex[0], ex[1]]);
    await db.run('INSERT INTO session_sets(session_exercise_id,set_number,reps,weight_kg,is_completed,completed_at) VALUES (1,1,8,40,1,?)', [T0 - 88_000_000]);
    await db.run("UPDATE workout_sessions SET status='completed', ended_at=? WHERE id=1", [T0 - 86_000_000]);
    await db.run("INSERT INTO workout_sessions(template_id,name,status,started_at,local_date) VALUES (1,'Running','in_progress',?,'2026-10-21')", [T0]);
    await db.run('INSERT INTO session_exercises(session_id,exercise_id,position) VALUES (2,?,1)', [ex[2]]);
    return db;
  }

  it('keeps every existing session, exercise and set unchanged, and marks their plans as not recorded', async () => {
    const db = await v7();
    const before = {
      sessions: await db.all('SELECT * FROM workout_sessions ORDER BY id'),
      exercises: await db.all('SELECT id,session_id,exercise_id,position FROM session_exercises ORDER BY id'),
      sets: await db.all('SELECT * FROM session_sets ORDER BY id'),
    };
    const r = await runMigrations(db, { backup: new NodeFileBackupStrategy(dir), clock: new ManualClock(T0) });
    expect(r.ok && r.value).toMatchObject({ fromVersion: 7, toVersion: LATEST_VERSION, applied: [8, 9] });
    expect(await db.all('SELECT * FROM workout_sessions ORDER BY id')).toEqual(before.sessions);
    expect(await db.all('SELECT id,session_id,exercise_id,position FROM session_exercises ORDER BY id')).toEqual(before.exercises);
    expect(await db.all('SELECT * FROM session_sets ORDER BY id')).toEqual(before.sets);
    expect(await db.all('SELECT exercise_name,plan_sets,plan_reps_min,plan_reps_max,plan_duration_sec,plan_rest_sec,plan_captured FROM session_exercises')).toEqual(
      Array(3).fill({ exercise_name: null, plan_sets: null, plan_reps_min: null, plan_reps_max: null, plan_duration_sec: null, plan_rest_sec: null, plan_captured: 0 }));
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);

    // old sessions read back with no plan (never the template's current targets), even though their template still exists
    const repos = createRepositories({ db, clock: new ManualClock(T0), utcOffsetMinutes: () => 0 });
    const old = unwrap(await repos.sessions.get(2));
    expect(old).toMatchObject({ status: 'in_progress', templateId: 1 });
    expect(plans(old)).toEqual([null]);
    expect(plans(unwrap(await repos.sessions.get(1)))).toEqual([null, null]);
    expect(unwrap(await repos.sessions.get(1)).exercises[0].sets).toHaveLength(1);

    // new behaviour applies to sessions started from now on, next to the old ones
    unwrap(await repos.sessions.discard(2)); // frees the single in-progress slot
    const started = unwrap(await repos.sessions.start({ templateId: 1 }));
    expect(plans(started)).toEqual([{ sets: 3, repsMin: 8, repsMax: null, durationSec: null, restSec: 60 }, { sets: 3, repsMin: 8, repsMax: null, durationSec: null, restSec: 60 }]);
    expect(plans(unwrap(await repos.sessions.get(1)))).toEqual([null, null]);
    await db.close();
  });

  it('a failing step leaves the database at v7 with all its data (the upgrade is all-or-nothing)', async () => {
    const db = await v7();
    const broken = [...MIGRATIONS.slice(0, 7), { ...MIGRATIONS[7], sql: `${MIGRATIONS[7].sql}\nSELECT * FROM table_that_does_not_exist;` }];
    const r = await runMigrations(db, { migrations: broken as never, backup: new NodeFileBackupStrategy(dir) });
    expect(errorOf(r)).toMatchObject({ kind: 'migration', version: 8 });
    expect(Number((await db.first<{ user_version: number }>('PRAGMA user_version'))!.user_version)).toBe(7);
    expect((await db.all<{ name: string }>('PRAGMA table_info(session_exercises)')).map((c) => c.name)).toEqual(['id', 'session_id', 'exercise_id', 'position']);
    expect(Number((await db.first<{ n: number }>('SELECT COUNT(*) n FROM session_exercises'))!.n)).toBe(3);
    await db.close();
  });
});
