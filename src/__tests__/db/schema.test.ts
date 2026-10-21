import type { Database } from '../../db/database';
import { createTestDb } from '../../db/testing/testDb';
import type { AppError } from '../../domain/errors';

const T = 1_700_000_000_000; // session start
const H = 3_600_000;
let db: Database;
beforeEach(async () => { db = await createTestDb(); });

const rejects = (sql: string, expected: Partial<AppError>) => expect(db.exec(sql)).rejects.toMatchObject({ appError: expected });
const accepts = (sql: string) => expect(db.exec(sql)).resolves.toBeUndefined();
const count = async (sql: string) => Number((await db.first<{ c: number }>(sql))!.c);
const CHECK = { kind: 'constraint', constraint: 'check' } as const;
const NOT_NULL = { kind: 'constraint', constraint: 'not_null' } as const;
const UNIQUE = { kind: 'constraint', constraint: 'unique' } as const;
const FK = { kind: 'constraint', constraint: 'foreign_key' } as const;

const NULLABLE: Record<string, string[]> = {
  profile: ['location', 'sex', 'age_years', 'age_set_on', 'height_cm', 'activity_level', 'undated_weight_kg'],
  goals: ['target_weight_kg', 'kcal_target', 'protein_g', 'carbs_g', 'fat_g'],
  exercises: ['slug', 'custom_name', 'met_value'],
  workout_templates: ['notes'],
  template_exercises: ['target_reps_min', 'target_reps_max', 'target_duration_sec'],
  workout_sessions: ['template_id', 'ended_at', 'discarded_at', 'rpe', 'est_kcal', 'est_method'],
  session_exercises: ['exercise_name', 'plan_sets', 'plan_reps_min', 'plan_reps_max', 'plan_duration_sec', 'plan_rest_sec'],
  session_sets: ['weight_kg', 'reps', 'duration_sec', 'distance_m', 'rpe', 'completed_at'],
  foods: ['slug', 'custom_name', 'brand', 'fiber_per_100'],
  meal_entries: ['food_id', 'quick_label'],
  weight_entries: ['note'],
  habits: ['slug', 'custom_name', 'target_count'],
};

describe('required fields: NOT NULL audit (a CHECK alone lets NULL through)', () => {
  it('every column is NOT NULL unless it is on the explicit nullable whitelist', async () => {
    const tables = (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).map((r) => r.name);
    const problems: string[] = [];
    for (const t of tables) {
      for (const c of await db.all<{ name: string; notnull: number; pk: number }>(`PRAGMA table_info(${t})`)) {
        const allowed = (NULLABLE[t] ?? []).includes(c.name);
        if (allowed && c.notnull !== 0) problems.push(`${t}.${c.name} should be nullable`);
        if (!allowed && c.notnull !== 1 && c.pk !== 1) problems.push(`${t}.${c.name} is nullable but not whitelisted`);
      }
    }
    expect(problems).toEqual([]);
    for (const t of Object.keys(NULLABLE)) expect(tables).toContain(t);
  });
  it('every table is STRICT', async () => {
    const rows = await db.all<{ name: string; strict: number }>("SELECT name, strict FROM pragma_table_list WHERE schema='main' AND type='table' AND name NOT LIKE 'sqlite_%'");
    expect(rows.filter((r) => r.strict !== 1)).toEqual([]);
  });
  it.each([
    ['exercise.source NULL', `INSERT INTO exercises(source,slug,category,primary_muscle,equipment,tracking_type,created_at) VALUES (NULL,'x','strength','chest','barbell','weight_reps',${T})`],
    ['water.amount_ml NULL', `INSERT INTO water_entries(local_date,amount_ml,logged_at) VALUES ('2026-10-21',NULL,${T})`],
    ['weight.weight_kg NULL', `INSERT INTO weight_entries(local_date,weight_kg,source,logged_at) VALUES ('2026-10-21',NULL,'manual',${T})`],
    ['session.status NULL', `INSERT INTO workout_sessions(name,status,started_at,local_date) VALUES ('x',NULL,${T},'2026-10-21')`],
    ['session.local_date NULL', `INSERT INTO workout_sessions(name,status,started_at,local_date) VALUES ('x','in_progress',${T},NULL)`],
    ['food.kcal NULL', `INSERT INTO foods(source,custom_name,unit,kcal_per_100,protein_per_100,carbs_per_100,fat_per_100,default_serving,data_label,created_at) VALUES ('user','x','g',NULL,1,1,1,1,'user_entered',${T})`],
    ['meal.kcal NULL', `INSERT INTO meal_entries(local_date,meal_type,quick_label,amount,kcal,protein_g,carbs_g,fat_g,logged_at) VALUES ('2026-10-21','lunch','q',1,NULL,1,1,1,${T})`],
    ['profile.display_name NULL', `INSERT INTO profile(id,display_name,updated_at) VALUES (1,NULL,${T})`],
    ['goals.water NULL', `INSERT INTO goals(id,goal_type,water_ml_target,weekly_workout_target,source,updated_at) VALUES (1,'maintain',NULL,3,'manual',${T})`],
  ])('rejects %s with a NOT NULL error', async (_l, sql) => rejects(sql, NOT_NULL));
});

describe('strict typing and calendar dates', () => {
  it('rejects text in an INTEGER column', () => rejects(`INSERT INTO water_entries(local_date,amount_ml,logged_at) VALUES ('2026-10-21','lots',${T})`, { kind: 'unknown' }));
  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '2026-2-3', '', '21-10-2026', '2026-10-21 ', '2026-10-21T10:00'])(
    'rejects invalid date %j (including NULL-from-date() cases)',
    (d) => rejects(`INSERT INTO water_entries(local_date,amount_ml,logged_at) VALUES ('${d}',250,${T})`, CHECK),
  );
  it.each(['2026-10-21', '2028-02-29', '2026-12-31', '2000-02-29'])('accepts real date %s', (d) => accepts(`INSERT INTO water_entries(local_date,amount_ml,logged_at) VALUES ('${d}',250,${T})`));
  it('a bound injection-shaped value is only data', async () => {
    await expect(db.run('INSERT INTO water_entries(local_date,amount_ml,logged_at) VALUES (?,?,?)', ["2026-10-21'); DROP TABLE profile;--", 250, T])).rejects.toMatchObject({ appError: CHECK });
    expect(await count("SELECT count(*) c FROM sqlite_master WHERE name='profile'")).toBe(1);
  });
  it.each([0, 5001, -1])('rejects water amount %s', (n) => rejects(`INSERT INTO water_entries(local_date,amount_ml,logged_at) VALUES ('2026-10-21',${n},${T})`, CHECK));
  it.each([5, 19.9, 500.1])('rejects weight %s kg', (n) => rejects(`INSERT INTO weight_entries(local_date,weight_kg,source,logged_at) VALUES ('2026-10-22',${n},'manual',${T})`, CHECK));
});

describe('profile & goals', () => {
  it('profile is a singleton and validates its fields', async () => {
    await accepts(`INSERT INTO profile(id,display_name,updated_at) VALUES (1,'Sara',${T})`);
    await rejects(`INSERT INTO profile(id,display_name,updated_at) VALUES (2,'X',${T})`, CHECK);
    await rejects(`UPDATE profile SET display_name='   ' WHERE id=1`, CHECK);
    await accepts(`UPDATE profile SET age_years=30 WHERE id=1`); // an age of UNKNOWN date is allowed (migration 007) ...
    await rejects(`UPDATE profile SET age_years=NULL, age_set_on='2026-10-21' WHERE id=1`, CHECK); // ... but a date without an age is not
    await accepts(`UPDATE profile SET age_years=30, age_set_on='2026-10-21' WHERE id=1`);
    await rejects(`UPDATE profile SET age_set_on='2026-02-30' WHERE id=1`, CHECK); // a date, when present, is a real calendar date
    await rejects(`UPDATE profile SET undated_weight_kg=19 WHERE id=1`, CHECK);
    await rejects(`UPDATE profile SET undated_weight_kg=501 WHERE id=1`, CHECK);
    await accepts(`UPDATE profile SET undated_weight_kg=70.5 WHERE id=1`);
    await rejects(`UPDATE profile SET age_years=9, age_set_on='2026-10-21' WHERE id=1`, CHECK);
    await rejects(`UPDATE profile SET height_cm=99 WHERE id=1`, CHECK);
    await rejects(`UPDATE profile SET sex='other' WHERE id=1`, CHECK);
  });
  it('goals validate type and ranges', async () => {
    const g = (extra: string) => `INSERT INTO goals(id,goal_type,water_ml_target,weekly_workout_target,source,updated_at${extra ? ',kcal_target' : ''}) VALUES (1,'maintain',2000,3,'manual',${T}${extra ? ',' + extra : ''})`;
    await accepts(g(''));
    await db.exec('DELETE FROM goals');
    await rejects(g('700'), CHECK);
    await rejects(`INSERT INTO goals(id,goal_type,water_ml_target,weekly_workout_target,source,updated_at) VALUES (1,'bulkzilla',2000,3,'manual',${T})`, CHECK);
  });
});

describe('exercises & templates', () => {
  const ex = (slug: string | null, name: string | null, source: string) =>
    `INSERT INTO exercises(source,slug,custom_name,category,primary_muscle,equipment,tracking_type,created_at) VALUES ('${source}',${slug ? `'${slug}'` : 'NULL'},${name ? `'${name}'` : 'NULL'},'strength','chest','barbell','weight_reps',${T})`;
  it('seed rows need a slug and no custom name; user rows the opposite', async () => {
    await accepts(ex('bench', null, 'seed'));
    await accepts(ex(null, 'My lift', 'user'));
    await rejects(ex('both', 'both', 'seed'), CHECK);
    await rejects(ex(null, null, 'user'), CHECK);
    await rejects(ex('slugged', 'named', 'user'), CHECK);
    await rejects(ex('bench', null, 'seed'), UNIQUE);
  });
  it('seed rows cannot be deleted (archive instead); unused user rows can', async () => {
    await db.exec(ex('bench', null, 'seed'));
    await db.exec(ex(null, 'Mine', 'user'));
    await rejects(`DELETE FROM exercises WHERE slug='bench'`, { kind: 'immutable' });
    await accepts(`UPDATE exercises SET is_archived=1 WHERE slug='bench'`);
    await accepts(`DELETE FROM exercises WHERE custom_name='Mine'`);
  });
  it('template exercises: unique position, FK, ranges, CASCADE and RESTRICT', async () => {
    await db.exec(ex('bench', null, 'seed'));
    await db.exec(`INSERT INTO workout_templates(name,created_at,updated_at) VALUES ('Push',${T},${T})`);
    const te = (pos: number, sets = 3, exId = 1, extra = '') => `INSERT INTO template_exercises(template_id,exercise_id,position,target_sets,rest_sec${extra ? ',' + extra.split('=')[0] : ''}) VALUES (1,${exId},${pos},${sets},60${extra ? ',' + extra.split('=')[1] : ''})`;
    await accepts(te(1));
    await rejects(te(1), UNIQUE);
    await rejects(te(0), CHECK);
    await rejects(te(2, 0), CHECK);
    await rejects(te(3, 3, 9999), FK);
    await rejects(`INSERT INTO template_exercises(template_id,exercise_id,position,target_sets,target_reps_min,target_reps_max,rest_sec) VALUES (1,1,5,3,12,8,60)`, CHECK);
    await rejects(`DELETE FROM exercises WHERE id=1`, { kind: 'immutable' });
    await db.exec(ex(null, 'Mine', 'user'));
    await db.exec(`INSERT INTO template_exercises(template_id,exercise_id,position,target_sets,rest_sec) VALUES (1,2,2,3,60)`);
    await rejects(`DELETE FROM exercises WHERE id=2`, FK); // RESTRICT: used by a template
    await db.exec(`DELETE FROM workout_templates WHERE id=1`);
    expect(await count('SELECT count(*) c FROM template_exercises')).toBe(0); // CASCADE
  });
});

describe('workout sessions: lifecycle', () => {
  beforeEach(async () => {
    await db.exec(`INSERT INTO exercises(source,slug,category,primary_muscle,equipment,tracking_type,created_at) VALUES ('seed','bench','strength','chest','barbell','weight_reps',${T});
                   INSERT INTO exercises(source,slug,category,primary_muscle,equipment,tracking_type,created_at) VALUES ('seed','squat','strength','quads','barbell','weight_reps',${T});
                   INSERT INTO workout_templates(name,created_at,updated_at) VALUES ('Push',${T},${T});`);
  });
  const session = (status: string, extra: { ended?: string; discarded?: string; id?: number; rpe?: number } = {}) =>
    `INSERT INTO workout_sessions(${extra.id ? 'id,' : ''}template_id,name,status,started_at,ended_at,discarded_at,local_date${extra.rpe ? ',rpe' : ''}) VALUES (${extra.id ? extra.id + ',' : ''}1,'Push','${status}',${T},${extra.ended ?? 'NULL'},${extra.discarded ?? 'NULL'},'2026-10-21'${extra.rpe ? ',' + extra.rpe : ''})`;
  const addEx = (sessionId: number, exId: number, pos: number) => `INSERT INTO session_exercises(session_id,exercise_id,position) VALUES (${sessionId},${exId},${pos})`;
  const addSet = (seId: number, n: number, cols = 'weight_kg,reps,is_completed,completed_at', vals = `80,8,1,${T + H}`) => `INSERT INTO session_sets(session_exercise_id,set_number,${cols}) VALUES (${seId},${n},${vals})`;
  /** in-progress session #1 with one exercise and one completed set */
  async function active() { await db.exec(session('in_progress', { id: 1 })); await db.exec(addEx(1, 1, 1)); await db.exec(addSet(1, 1)); }
  const complete = (id = 1, end = T + 2 * H) => `UPDATE workout_sessions SET status='completed', ended_at=${end} WHERE id=${id}`;
  const discard = (id = 1, at = T + 2 * H) => `UPDATE workout_sessions SET status='discarded', discarded_at=${at} WHERE id=${id}`;
  const status = async (id = 1) => (await db.first<{ status: string }>(`SELECT status FROM workout_sessions WHERE id=${id}`))!.status;

  it('state/timestamp combinations are enforced by CHECK (inserts of in_progress rows, and updates)', async () => {
    await rejects(session('in_progress', { ended: String(T + H) }), CHECK);
    await rejects(session('in_progress', { discarded: String(T + H) }), CHECK);
    await rejects(session('in_progress', { rpe: 7 }), CHECK); // rpe only once completed
    await active();
    const upd = (set: string) => `UPDATE workout_sessions SET ${set} WHERE id=1`;
    await rejects(upd(`status='completed'`), CHECK); // no ended_at
    await rejects(upd(`status='completed', ended_at=${T - 5}`), CHECK);
    await rejects(upd(`status='completed', ended_at=${T + H}, discarded_at=${T + H}`), CHECK);
    await rejects(upd(`status='discarded'`), CHECK); // no discarded_at
    await rejects(upd(`status='discarded', discarded_at=${T - 5}`), CHECK);
    await rejects(upd(`status='discarded', discarded_at=${T + H}, ended_at=${T + H}`), CHECK);
    await rejects(upd(`status='paused'`), { kind: 'invalid_transition' }); // the lifecycle trigger fires before the CHECK
  });

  it('a session can only be INSERTED in progress (E7): no pre-completed or pre-discarded sessions', async () => {
    const MUST = { kind: 'invalid_transition', reason: 'must_start_in_progress' } as const;
    // even well-formed completed/discarded rows are refused; a completed session would have no completed set
    await rejects(session('completed', { ended: String(T + H) }), MUST);
    await rejects(session('discarded', { discarded: String(T + H) }), MUST);
    await rejects(session('completed', { ended: String(T + H), id: 9 }), MUST);
    await rejects(session('paused'), MUST);
    expect(await count('SELECT count(*) c FROM workout_sessions')).toBe(0);
    await accepts(session('in_progress', { id: 1 }));
    // the supported path still works: start, add a completed set, complete
    await db.exec(addEx(1, 1, 1));
    await db.exec(addSet(1, 1));
    await accepts(complete());
    expect(await status()).toBe('completed');
  });
  it('only one session can be in progress at a time; completed and discarded free the slot', async () => {
    await active();
    await rejects(session('in_progress', { id: 2 }), { kind: 'conflict', reason: 'active_session' });
    await db.exec(complete());
    await accepts(session('in_progress', { id: 2 }));
    await db.exec(addEx(2, 1, 1));
    await db.exec(discard(2));
    await accepts(session('in_progress', { id: 3 }));
  });

  describe('permitted and forbidden transitions', () => {
    it('in_progress -> completed (needs a completed set)', async () => {
      await active();
      await accepts(complete());
      expect(await status()).toBe('completed');
    });
    it('in_progress -> discarded records the discard time and keeps the data', async () => {
      await active();
      await accepts(discard());
      const row = await db.first<{ status: string; discarded_at: number; ended_at: number | null }>('SELECT status,discarded_at,ended_at FROM workout_sessions WHERE id=1');
      expect(row).toEqual({ status: 'discarded', discarded_at: T + 2 * H, ended_at: null });
      expect(await count('SELECT count(*) c FROM session_sets')).toBe(1); // history retained, not deleted
    });
    it('a session with no completed set cannot be completed (it can be discarded)', async () => {
      await db.exec(session('in_progress', { id: 1 }));
      await db.exec(addEx(1, 1, 1));
      await db.exec(addSet(1, 1, 'reps', '5')); // incomplete set
      await rejects(complete(), { kind: 'invalid_transition', reason: 'no_completed_sets' });
      expect(await status()).toBe('in_progress');
      await accepts(discard());
    });
    it.each([
      ['completed -> in_progress', "UPDATE workout_sessions SET status='in_progress', ended_at=NULL WHERE id=1", 'complete'],
      ['completed -> discarded', "UPDATE workout_sessions SET status='discarded', ended_at=NULL, discarded_at=" + (T + 3 * H) + ' WHERE id=1', 'complete'],
      ['discarded -> in_progress', "UPDATE workout_sessions SET status='in_progress', discarded_at=NULL WHERE id=1", 'discard'],
      ['discarded -> completed', `UPDATE workout_sessions SET status='completed', discarded_at=NULL, ended_at=${T + 3 * H} WHERE id=1`, 'discard'],
    ])('rejects %s', async (_l, sql, via) => {
      await active();
      await db.exec(via === 'complete' ? complete() : discard());
      const before = await status();
      await expect(db.exec(sql)).rejects.toMatchObject({ appError: { kind: expect.stringMatching(/invalid_transition|immutable/) } });
      expect(await status()).toBe(before);
    });
    it('the start time can never be rewritten', async () => {
      await active();
      await rejects(`UPDATE workout_sessions SET started_at=${T - H} WHERE id=1`, { kind: 'immutable', reason: 'session_start_time' });
    });
  });

  describe('discarded sessions are frozen', () => {
    beforeEach(async () => { await active(); await db.exec(discard()); });
    it('cannot be edited, nor have exercises or sets added, changed or removed', async () => {
      await rejects(`UPDATE workout_sessions SET name='x' WHERE id=1`, { kind: 'immutable' });
      await rejects(addEx(1, 2, 2), { kind: 'immutable' });
      await rejects(addSet(1, 2), { kind: 'immutable' });
      await rejects(`UPDATE session_sets SET reps=9 WHERE id=1`, { kind: 'immutable' });
      await rejects(`DELETE FROM session_sets WHERE id=1`, { kind: 'immutable' });
      await rejects(`UPDATE session_exercises SET position=5 WHERE id=1`, { kind: 'immutable' });
      await rejects(`DELETE FROM session_exercises WHERE id=1`, { kind: 'immutable' });
    });
    it('are excluded from completed counts', async () => {
      await db.exec(session('in_progress', { id: 2 }));
      await db.exec(addEx(2, 1, 1));
      await db.exec(addSet(2, 1));
      await db.exec(complete(2, T + 3 * H));
      expect(await count("SELECT count(*) c FROM workout_sessions WHERE status='completed'")).toBe(1);
      expect(await count("SELECT count(*) c FROM workout_sessions WHERE status='discarded'")).toBe(1);
    });
  });

  describe('a COMPLETED session: exercises and sets are immutable (migration 009)', () => {
    const COMPLETED = { kind: 'immutable', reason: 'completed_session' } as const;
    beforeEach(async () => {
      await active();
      await db.exec(addSet(1, 2, 'weight_kg,reps,is_completed,completed_at', `85,6,1,${T + H + 60_000}`));
      await db.exec(complete());
    });
    it('rejects every insert, update and delete of its exercises and sets, and nothing changes', async () => {
      await rejects(addEx(1, 2, 2), COMPLETED);
      await rejects(addSet(1, 3, 'weight_kg,reps,is_completed,completed_at', `70,10,1,${T + H + 120_000}`), COMPLETED);
      await rejects(`UPDATE session_sets SET weight_kg=82.5, reps=7 WHERE session_exercise_id=1 AND set_number=1`, COMPLETED);
      await rejects(`UPDATE session_sets SET is_completed=0, completed_at=NULL WHERE set_number=2`, COMPLETED);
      await rejects(`DELETE FROM session_sets WHERE set_number=2`, COMPLETED);
      await rejects(`DELETE FROM session_sets WHERE set_number=1`, COMPLETED); // also the one that used to be "the last completed set"
      await rejects(`UPDATE session_exercises SET position=5 WHERE id=1`, COMPLETED);
      await rejects(`DELETE FROM session_exercises WHERE id=1`, COMPLETED);
      expect(await count('SELECT count(*) c FROM session_sets')).toBe(2);
      expect(await count('SELECT count(*) c FROM session_exercises')).toBe(1);
      expect((await db.first<{ weight_kg: number }>('SELECT weight_kg FROM session_sets WHERE set_number=1'))!.weight_kg).toBe(80);
    });
    it('cannot be bypassed by moving rows into or out of the completed session', async () => {
      await db.exec(session('in_progress', { id: 2 }));
      await db.exec(addEx(2, 2, 1)); // session_exercise 2, in the running session
      await db.exec(addSet(2, 1, 'reps,is_completed,completed_at', `10,1,${T + H}`)); // set 3
      await rejects(`UPDATE session_exercises SET session_id=1, position=7 WHERE id=2`, COMPLETED); // exercise into
      await rejects(`UPDATE session_exercises SET session_id=2, position=7 WHERE id=1`, COMPLETED); // exercise out of
      await rejects(`UPDATE session_sets SET session_exercise_id=1, set_number=9 WHERE id=3`, COMPLETED); // set into
      await rejects(`UPDATE session_sets SET session_exercise_id=2, set_number=9 WHERE id=1`, COMPLETED); // set out of
      await rejects(`UPDATE session_sets SET id=77 WHERE id=1`, COMPLETED); // re-keying
      expect(await count('SELECT count(*) c FROM session_sets WHERE session_exercise_id=1')).toBe(2);
      expect(await count('SELECT count(*) c FROM session_sets WHERE session_exercise_id=2')).toBe(1);
    });
    it('its own details can still be corrected: name, rpe, and the end time', async () => {
      await accepts(`UPDATE workout_sessions SET name='Push day (fixed)', rpe=8 WHERE id=1`);
      expect(await status()).toBe('completed');
    });
    it('keeps timestamps consistent: the end cannot precede a set or the start, and moving it later is fine', async () => {
      await rejects(`UPDATE workout_sessions SET ended_at=${T + H} WHERE id=1`, { kind: 'constraint', constraint: 'check' }); // before the last set
      await rejects(`UPDATE workout_sessions SET ended_at=${T - 1} WHERE id=1`, CHECK);
      await accepts(`UPDATE workout_sessions SET ended_at=${T + 4 * H} WHERE id=1`);
    });
  });

  describe('an IN-PROGRESS session is unaffected: logging, editing and removing still work', () => {
    beforeEach(async () => { await active(); });
    it('accepts the normal operations of a live workout', async () => {
      await accepts(addSet(1, 2, 'weight_kg,reps,is_completed,completed_at', `85,6,1,${T + H + 60_000}`));
      await accepts(`UPDATE session_sets SET weight_kg=82.5, reps=7 WHERE set_number=1`);
      await accepts(addEx(1, 2, 2));
      await accepts(addSet(2, 1, 'reps,is_completed,completed_at', `12,1,${T + H + 180_000}`));
      await accepts(`DELETE FROM session_sets WHERE set_number=2 AND session_exercise_id=1`);
      await accepts(`DELETE FROM session_exercises WHERE id=2`);
      expect(await status()).toBe('in_progress');
    });
    it('an in-progress session can still be completed, and then freezes', async () => {
      await accepts(complete());
      expect(await status()).toBe('completed');
      await rejects(addSet(1, 2), { kind: 'immutable', reason: 'completed_session' });
    });
    it('discarded sessions keep their own protection', async () => {
      await accepts(discard());
      await rejects(addSet(1, 2), { kind: 'immutable', reason: 'discarded_session' });
      await rejects(`DELETE FROM session_sets WHERE id=1`, { kind: 'immutable', reason: 'discarded_session' });
    });
  });

  describe('set ordering and in-progress validation', () => {
    beforeEach(async () => { await db.exec(session('in_progress', { id: 1 })); await db.exec(addEx(1, 1, 1)); });
    it('exercise positions and set numbers are unique and positive', async () => {
      await rejects(addEx(1, 2, 1), UNIQUE);
      await rejects(addEx(1, 2, 0), CHECK);
      await accepts(addSet(1, 1));
      await rejects(addSet(1, 1), UNIQUE);
      await rejects(addSet(1, 0), CHECK);
      await accepts(addSet(1, 2));
    });
    it('a completed set needs completed_at and a metric; an incomplete set cannot carry completed_at', async () => {
      await rejects(addSet(1, 1, 'reps,is_completed', '5,1'), CHECK);
      await rejects(addSet(1, 1, 'reps,completed_at', `5,${T + H}`), CHECK);
      await rejects(addSet(1, 1, 'is_completed,completed_at', `1,${T + H}`), CHECK);
      await rejects(addSet(1, 1, 'weight_kg,reps', '-5,5'), CHECK);
      await rejects(addSet(1, 1, 'rpe,reps', '11,5'), CHECK);
      await rejects(addSet(1, 1, 'reps,is_completed,completed_at', `5,1,${T - 1}`), { kind: 'constraint', constraint: 'check' }); // before the session started
    });
    it('FK: sets need a real session exercise; exercises need a real exercise', async () => {
      await rejects(addSet(99, 1), FK);
      await rejects(addEx(1, 9999, 2), FK);
    });
  });

  describe('foreign keys: RESTRICT / CASCADE / SET NULL', () => {
    it('an exercise used by history cannot be deleted; deleting the template keeps sessions (SET NULL)', async () => {
      await db.exec(`INSERT INTO exercises(source,custom_name,category,primary_muscle,equipment,tracking_type,created_at) VALUES ('user','Used','strength','back','dumbbell','reps_only',${T})`);
      await active();
      await db.exec(addEx(1, 3, 2));
      await rejects(`DELETE FROM exercises WHERE id=3`, FK);
      await db.exec(`DELETE FROM workout_templates WHERE id=1`);
      expect((await db.first<{ t: number | null }>('SELECT template_id t FROM workout_sessions WHERE id=1'))!.t).toBeNull();
    });
    it('deleting an IN-PROGRESS session cascades to its exercises and sets without orphans', async () => {
      await active();
      await db.exec('DELETE FROM workout_sessions WHERE id=1');
      expect(await count('SELECT count(*) c FROM session_exercises')).toBe(0);
      expect(await count('SELECT count(*) c FROM session_sets')).toBe(0);
      expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    });
    it('deleting a COMPLETED or DISCARDED session (explicit history removal) cascades cleanly despite the guards', async () => {
      await active();
      await db.exec(complete());
      await accepts('DELETE FROM workout_sessions WHERE id=1');
      expect(await count('SELECT count(*) c FROM session_sets')).toBe(0);
      await db.exec(session('in_progress', { id: 2 }));
      await db.exec(addEx(2, 1, 1));
      await db.exec(addSet(1, 1)); // the first (deleted) session freed rowid 1 for this exercise
      await db.exec(discard(2));
      await accepts('DELETE FROM workout_sessions WHERE id=2');
      expect(await count('SELECT count(*) c FROM session_exercises')).toBe(0);
      expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    });
  });
});

describe('nutrition, water, weight, habits', () => {
  const food = (kcal: number | string = 130, unit = 'g') => `INSERT INTO foods(source,custom_name,unit,kcal_per_100,protein_per_100,carbs_per_100,fat_per_100,default_serving,data_label,created_at) VALUES ('user','Rice','${unit}',${kcal},2.7,28,0.3,150,'user_entered',${T})`;
  const meal = (f: string | number, q: string, amt = 150) => `INSERT INTO meal_entries(local_date,meal_type,food_id,quick_label,amount,kcal,protein_g,carbs_g,fat_g,logged_at) VALUES ('2026-10-21','lunch',${f},${q},${amt},195,4,42,0.5,${T})`;
  it('foods validate units and ranges; seed rows are protected', async () => {
    await accepts(food());
    await rejects(food(2000), CHECK);
    await rejects(food(130, 'oz'), CHECK);
    await db.exec(`INSERT INTO foods(source,slug,unit,kcal_per_100,protein_per_100,carbs_per_100,fat_per_100,default_serving,data_label,created_at) VALUES ('seed','oats','g',380,13,60,7,40,'approximate',${T})`);
    await rejects(`DELETE FROM foods WHERE slug='oats'`, { kind: 'immutable' });
    await rejects(`UPDATE foods SET data_label='verified' WHERE slug='oats'`, CHECK);
  });
  it('meals need a food or a label; history protects its food (RESTRICT) and snapshots values', async () => {
    await db.exec(food());
    await accepts(meal(1, 'NULL'));
    await accepts(meal('NULL', "'Quick snack'"));
    await rejects(meal('NULL', 'NULL'), CHECK);
    await rejects(meal(1, 'NULL', 0), CHECK);
    await rejects(meal(99, 'NULL'), FK);
    await rejects('DELETE FROM foods WHERE id=1', FK);
    await db.exec('UPDATE foods SET kcal_per_100=500 WHERE id=1');
    expect((await db.first<{ kcal: number }>('SELECT kcal FROM meal_entries WHERE id=1'))!.kcal).toBe(195); // history unchanged
  });
  it('weight has one entry per day (upsert) and a source', async () => {
    const w = (kg: number) => `INSERT INTO weight_entries(local_date,weight_kg,source,logged_at) VALUES ('2026-10-21',${kg},'manual',${T})`;
    await accepts(w(72.5));
    await rejects(w(73), UNIQUE);
    await accepts(`${w(73)} ON CONFLICT(local_date) DO UPDATE SET weight_kg=excluded.weight_kg`);
    expect((await db.first<{ w: number }>('SELECT weight_kg w FROM weight_entries'))!.w).toBe(73);
    await rejects(`INSERT INTO weight_entries(local_date,weight_kg,source,logged_at) VALUES ('2026-10-22',70,'imported',${T})`, CHECK);
  });
  it('habits: kind/target consistency, one log per habit-day, cascade on delete', async () => {
    await accepts(`INSERT INTO habits(source,custom_name,kind,created_at) VALUES ('user','Walk','boolean',${T})`);
    await rejects(`INSERT INTO habits(source,custom_name,kind,created_at) VALUES ('user','Water','count',${T})`, CHECK);
    await rejects(`INSERT INTO habits(source,custom_name,kind,target_count,created_at) VALUES ('user','W','boolean',5,${T})`, CHECK);
    await rejects(`INSERT INTO habits(source,custom_name,kind,schedule_days,created_at) VALUES ('user','W','boolean',0,${T})`, CHECK);
    await accepts(`INSERT INTO habit_logs(habit_id,local_date,value) VALUES (1,'2026-10-21',1)`);
    await rejects(`INSERT INTO habit_logs(habit_id,local_date,value) VALUES (1,'2026-10-21',1)`, UNIQUE);
    await rejects(`INSERT INTO habit_logs(habit_id,local_date,value) VALUES (9,'2026-10-22',1)`, FK);
    await db.exec('DELETE FROM habits WHERE id=1');
    expect(await count('SELECT count(*) c FROM habit_logs')).toBe(0);
  });
});
