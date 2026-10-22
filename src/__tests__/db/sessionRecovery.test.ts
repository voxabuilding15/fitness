/**
 * An unfinished workout must come back exactly as it was after the app is closed or killed: the same sets, the same plan snapshot,
 * the same place in the workout - and it must stay a normal in-progress workout (one at a time, finishable, immutable once done).
 * These tests close and reopen a real SQLite FILE (Node SQLite), not the Expo native driver, and not a real process kill.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database } from '../../db/database';
import { createRepositories } from '../../db/repositories';
import { openFileTestDb } from '../../db/testing/testDb';
import { ManualClock } from '../../domain/clock';
import { firstOpenIndex, sessionProgress } from '../../domain/sessionProgress';
import { recoveryOf } from '../../domain/sessionRecovery';
import { T0, MIN, errorOf, unwrap } from '../../db/testing/repoEnv';

let dir: string;
let path: string;
const open: Database[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-recover-')); path = join(dir, 'app.db'); });
afterEach(async () => { for (const d of open.splice(0)) await d.close().catch(() => undefined); rmSync(dir, { recursive: true, force: true }); });

const launch = async (at: number) => {
  const db = await openFileTestDb(path);
  open.push(db);
  const clock = new ManualClock(at);
  return { db, clock, r: createRepositories({ db, clock, utcOffsetMinutes: () => 0 }) };
};
const close = async (db: Database) => { await db.close(); open.splice(open.indexOf(db), 1); };

const setup = async () => {
  const a = await launch(T0);
  const bench = unwrap(await a.r.exercises.create({ name: 'Bench', category: 'strength', primaryMuscle: 'chest', equipment: 'barbell', trackingType: 'weight_reps' }));
  const plank = unwrap(await a.r.exercises.create({ name: 'Plank', category: 'strength', primaryMuscle: 'core', equipment: 'bodyweight', trackingType: 'duration' }));
  const tpl = unwrap(await a.r.templates.create({ name: 'Push', exercises: [
    { exerciseId: bench.id, targetSets: 2, targetRepsMin: 8, targetRepsMax: 10, restSec: 90 },
    { exerciseId: plank.id, targetSets: 1, targetDurationSec: 45, restSec: 30 },
  ] }));
  const s = unwrap(await a.r.sessions.start({ templateId: tpl.id }));
  return { a, s, tpl, bench, plank };
};

describe('an in-progress workout across an app restart', () => {
  it('comes back identical: sets, order, timestamps, plan snapshot and progress', async () => {
    const { a, s } = await setup();
    unwrap(await a.r.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 60, isCompleted: true }));
    a.clock.advance(2 * MIN);
    unwrap(await a.r.sessions.addSet(s.exercises[0].id, { reps: 9, weightKg: 60, isCompleted: true }));
    const before = unwrap(await a.r.sessions.get(s.id));
    await close(a.db);

    const b = await launch(T0 + 30 * MIN);
    const after = unwrap(await b.r.sessions.get(s.id));
    expect(after).toEqual(before);
    expect(unwrap(await b.r.sessions.getActive())).toEqual(before);
    expect(after.exercises[0].plan).toMatchObject({ sets: 2, repsMin: 8, repsMax: 10, restSec: 90 });
    // the place in the workout and the progress are derived from the saved sets alone
    expect(firstOpenIndex(after.exercises)).toBe(1);
    expect(sessionProgress(after.exercises)).toMatchObject({ loggedSets: 2, plannedSets: 3, exercisesDone: 1 });
    expect(recoveryOf(after, b.clock.now())).toMatchObject({ loggedSets: 2, lastLoggedAt: T0 + 2 * MIN, minutesSinceLastSet: 28, minutesSinceStart: 30 });
  });

  it('keeps its plan snapshot even if the template is deleted while the app is closed', async () => {
    const { a, s, tpl } = await setup();
    await close(a.db);
    const b = await launch(T0 + 5 * MIN);
    unwrap(await b.r.templates.delete(tpl.id));
    await close(b.db);
    const c = await launch(T0 + 6 * MIN);
    const back = unwrap(await c.r.sessions.getActive())!;
    expect(back.id).toBe(s.id);
    expect(back.exercises.map((e) => e.plan?.sets)).toEqual([2, 1]);
  });

  it('is still the only in-progress workout, can continue, finish, and is then immutable - also after further restarts', async () => {
    const { a, s, tpl } = await setup();
    unwrap(await a.r.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 60, isCompleted: true }));
    await close(a.db);

    const b = await launch(T0 + 20 * MIN);
    expect(errorOf(await b.r.sessions.start({ templateId: tpl.id })).kind).not.toBe('ok');
    const added = unwrap(await b.r.sessions.addSet(s.exercises[0].id, { reps: 7, weightKg: 60, isCompleted: true }));
    expect(added).toMatchObject({ setNumber: 2, completedAt: T0 + 20 * MIN });
    const done = unwrap(await b.r.sessions.complete(s.id));
    expect(done.status).toBe('completed');
    const frozen = unwrap(await b.r.sessions.get(s.id));
    await close(b.db);

    const c = await launch(T0 + 90 * MIN);
    expect(unwrap(await c.r.sessions.getActive())).toBeNull();
    expect(unwrap(await c.r.sessions.get(s.id))).toEqual(frozen);
    expect(errorOf(await c.r.sessions.addSet(s.exercises[0].id, { reps: 5, weightKg: 50, isCompleted: true })).kind).toBeDefined();
    expect(unwrap(await c.r.sessions.get(s.id))).toEqual(frozen);
  });

  it('a discarded workout is not brought back as active', async () => {
    const { a, s } = await setup();
    unwrap(await a.r.sessions.discard(s.id));
    await close(a.db);
    const b = await launch(T0 + MIN);
    expect(unwrap(await b.r.sessions.getActive())).toBeNull();
    expect(unwrap(await b.r.sessions.get(s.id)).status).toBe('discarded');
  });

  it('a write interrupted by an error leaves the saved sets exactly as they were', async () => {
    const { a, s } = await setup();
    unwrap(await a.r.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 60, isCompleted: true }));
    const before = unwrap(await a.r.sessions.get(s.id));
    await expect(a.db.transaction(async (tx) => {
      await tx.run('INSERT INTO session_sets(session_exercise_id,set_number,reps,is_warmup,is_completed,completed_at) VALUES(?,?,?,?,?,?)', [s.exercises[0].id, 2, 5, 0, 1, T0 + MIN]);
      throw new Error('process died before commit');
    })).rejects.toThrow();
    expect(errorOf(await a.r.sessions.addSet(s.exercises[0].id, { reps: -1, isCompleted: true })).kind).toBeDefined();
    await close(a.db);
    const b = await launch(T0 + 5 * MIN);
    expect(unwrap(await b.r.sessions.get(s.id))).toEqual(before);
  });
});
