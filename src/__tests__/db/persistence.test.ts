import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../db/database';
import { createRepositories } from '../../db/repositories';
import { openFileTestDb } from '../../db/testing/testDb';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { runMigrations } from '../../db/migrations/runner';
import { ManualClock } from '../../domain/clock';
import { T0, MIN, errorOf, unwrap } from '../../db/testing/repoEnv';

let dir: string;
let path: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-persist-')); path = join(dir, 'app.db'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const reposFor = (db: Database, clock = new ManualClock(T0)) => createRepositories({ db, clock, utcOffsetMinutes: () => 0 });

describe('persistence across closing and reopening the database file', () => {
  it('every kind of record survives, with identical values, and the file passes integrity checks', async () => {
    let db = await openFileTestDb(path);
    let r = reposFor(db);
    unwrap(await r.profile.save({ displayName: 'Sara', location: 'Cairo', ageYears: 30, heightCm: 165 }));
    unwrap(await r.goals.save({ goalType: 'maintain', waterMlTarget: 2000, weeklyWorkoutTarget: 3, source: 'manual' }));
    const ex = unwrap(await r.exercises.create({ name: 'Row', category: 'strength', primaryMuscle: 'back', equipment: 'cable', trackingType: 'weight_reps', secondaryMuscles: ['biceps'] }));
    const tpl = unwrap(await r.templates.create({ name: 'Pull', exercises: [{ exerciseId: ex.id, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSec: 60 }] }));
    const session = unwrap(await r.sessions.start({ templateId: tpl.id }));
    unwrap(await r.sessions.addSet(session.exercises[0].id, { reps: 10, weightKg: 40, isCompleted: true }));
    unwrap(await r.sessions.complete(session.id, { rpe: 7 }));
    const food = unwrap(await r.nutrition.createFood({ name: 'Rice', unit: 'g', kcalPer100: 130, proteinPer100: 2.7, carbsPer100: 28, fatPer100: 0.3, defaultServing: 150 }));
    unwrap(await r.nutrition.addMeal({ kind: 'food', foodId: food.id, amount: 200, mealType: 'lunch' }));
    unwrap(await r.water.add({ amountMl: 500 }));
    unwrap(await r.weight.save({ weightKg: 71.3 }));
    const habit = unwrap(await r.habits.create({ name: 'Walk', kind: 'boolean' }));
    unwrap(await r.habits.setLog({ habitId: habit.id, localDate: '2026-10-21', value: 1 }));
    const snapshot = {
      profile: unwrap(await r.profile.get()), goals: unwrap(await r.goals.get()), exercises: unwrap(await r.exercises.list()),
      templates: unwrap(await r.templates.list()), session: unwrap(await r.sessions.get(session.id)), meals: unwrap(await r.nutrition.listMeals('2026-10-21')),
      water: unwrap(await r.water.day('2026-10-21')), weight: unwrap(await r.weight.latest()), habits: unwrap(await r.habits.list()),
      logs: unwrap(await r.habits.listLogs({ from: '2026-10-01', to: '2026-10-31' })),
    };
    await db.close();

    db = await openFileTestDb(path); // reopen: migrations run again and must be a no-op
    r = reposFor(db);
    expect({
      profile: unwrap(await r.profile.get()), goals: unwrap(await r.goals.get()), exercises: unwrap(await r.exercises.list()),
      templates: unwrap(await r.templates.list()), session: unwrap(await r.sessions.get(session.id)), meals: unwrap(await r.nutrition.listMeals('2026-10-21')),
      water: unwrap(await r.water.day('2026-10-21')), weight: unwrap(await r.weight.latest()), habits: unwrap(await r.habits.list()),
      logs: unwrap(await r.habits.listLogs({ from: '2026-10-01', to: '2026-10-31' })),
    }).toEqual(snapshot);
    expect(snapshot.session).toMatchObject({ status: 'completed', rpe: 7 });
    expect(await db.all('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    expect((await db.first<{ user_version: number }>('PRAGMA user_version'))!.user_version).toBe(6);
    await db.close();
  });
  it('a workout still in progress when the app is closed is recovered on the next launch, and can be finished', async () => {
    let db = await openFileTestDb(path);
    let clock = new ManualClock(T0);
    let r = reposFor(db, clock);
    const ex = unwrap(await r.exercises.create({ name: 'Squat', category: 'strength', primaryMuscle: 'quads', equipment: 'barbell', trackingType: 'weight_reps' }));
    const s = unwrap(await r.sessions.start({ name: 'Leg day', exerciseIds: [ex.id] }));
    unwrap(await r.sessions.addSet(s.exercises[0].id, { reps: 5, weightKg: 100, isCompleted: true }));
    await db.close(); // app killed mid-workout

    db = await openFileTestDb(path);
    clock = new ManualClock(T0 + 40 * MIN);
    r = reposFor(db, clock);
    const active = unwrap(await r.sessions.getActive())!;
    expect(active).toMatchObject({ id: s.id, name: 'Leg day', status: 'in_progress' });
    expect(active.exercises[0].sets).toHaveLength(1);
    expect(unwrap(await r.sessions.complete(active.id)).endedAt).toBe(T0 + 40 * MIN);
    await db.close();
  });
  it('a transaction that was rolled back leaves nothing behind after reopening', async () => {
    let db = await openFileTestDb(path);
    const r = reposFor(db);
    expect(errorOf(await r.templates.create({ name: 'Broken', exercises: [{ exerciseId: 9999, targetSets: 3, targetRepsMin: 5, restSec: 30 }] })).kind).toBe('constraint');
    await db.close();
    db = await openFileTestDb(path);
    expect(unwrap(await reposFor(db).templates.list())).toEqual([]);
    await db.close();
  });
  it('writes are visible to a second connection only after commit (durable, not just cached)', async () => {
    const db = await openFileTestDb(path);
    unwrap(await reposFor(db).water.add({ amountMl: 330 }));
    const other = await Database.open(new NodeSqliteDriver(path));
    expect(await other.all('SELECT amount_ml FROM water_entries')).toEqual([{ amount_ml: 330 }]);
    expect((await runMigrations(other)).ok).toBe(true);
    await other.close();
    await db.close();
  });
});
