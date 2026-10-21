import { createRepoEnv, errorOf, H, MIN, T0, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import { canTransition, type SessionStatus } from '../../domain/sessionLifecycle';

let env: RepoEnv;
let bench: number, squat: number;
beforeEach(async () => {
  env = await createRepoEnv();
  const mk = async (name: string) => unwrap(await env.repos.exercises.create({ name, category: 'strength', primaryMuscle: 'chest', equipment: 'barbell', trackingType: 'weight_reps' })).id;
  bench = await mk('Bench');
  squat = await mk('Squat');
});
const S = () => env.repos.sessions;
const done = { reps: 8, weightKg: 60, isCompleted: true } as const;

/** a started session with one exercise and one completed set */
async function activeWithSet() {
  const s = unwrap(await S().start({ name: 'Push', exerciseIds: [bench] }));
  const set = unwrap(await S().addSet(s.exercises[0].id, done));
  return { s, seId: s.exercises[0].id, set };
}
async function completedSession(minutes = 30) {
  const a = await activeWithSet();
  env.clock.advance(minutes * MIN);
  unwrap(await S().complete(a.s.id));
  return a;
}

describe('starting a session', () => {
  it('from a template: copies name and exercises in order, stamps local date and start time', async () => {
    const t = unwrap(await env.repos.templates.create({ name: 'Leg day', exercises: [
      { exerciseId: squat, targetSets: 3, targetRepsMin: 5, restSec: 90 }, { exerciseId: bench, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    const s = unwrap(await S().start({ templateId: t.id }));
    expect(s).toMatchObject({ name: 'Leg day', status: 'in_progress', templateId: t.id, startedAt: T0, localDate: '2026-10-21', endedAt: null, discardedAt: null, rpe: null, estKcal: null });
    expect(s.exercises.map((e) => [e.position, e.exerciseId, e.sets.length])).toEqual([[1, squat, 0], [2, bench, 0]]);
  });
  it('ad hoc (name + exercises), or empty with a name; needs a name when there is no template', async () => {
    expect(unwrap(await S().start({ name: 'Free', exerciseIds: [bench, squat] })).exercises).toHaveLength(2);
    unwrap(await S().discard(unwrap(await S().getActive())!.id));
    expect(unwrap(await S().start({ name: 'Empty' })).exercises).toEqual([]);
    unwrap(await S().discard(unwrap(await S().getActive())!.id));
    expect(errorOf(await S().start({}))).toEqual({ kind: 'validation', issues: { name: 'validation.required' } });
    expect(errorOf(await S().start({ templateId: 999 }))).toEqual({ kind: 'not_found', entity: 'template' });
  });
  it('only one workout can be in progress; a failed start leaves nothing behind', async () => {
    unwrap(await S().start({ name: 'A' }));
    expect(errorOf(await S().start({ name: 'B' }))).toEqual({ kind: 'conflict', reason: 'active_session' });
    unwrap(await S().discard(unwrap(await S().getActive())!.id));
    expect(errorOf(await S().start({ name: 'C', exerciseIds: [bench, 9999] }))).toMatchObject({ kind: 'constraint', constraint: 'foreign_key' });
    expect(unwrap(await S().getActive())).toBeNull(); // rolled back: no half-created session blocking the next start
    unwrap(await S().start({ name: 'D' }));
  });
  it('two concurrent starts: exactly one wins', async () => {
    const [a, b] = await Promise.all([S().start({ name: 'A' }), S().start({ name: 'B' })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(errorOf(a.ok ? b : a)).toEqual({ kind: 'conflict', reason: 'active_session' });
  });
  it('records the device-local date, not the UTC date', async () => {
    const e = await createRepoEnv(-300); // UTC-5
    e.clock.set(Date.UTC(2026, 9, 21, 2, 0));
    expect(unwrap(await e.repos.sessions.start({ name: 'Late' })).localDate).toBe('2026-10-20');
  });
  it('get / getActive / not found', async () => {
    expect(unwrap(await S().getActive())).toBeNull();
    const s = unwrap(await S().start({ name: 'A' }));
    expect(unwrap(await S().getActive())!.id).toBe(s.id);
    expect(unwrap(await S().get(s.id))).toEqual(s);
    expect(errorOf(await S().get(999))).toEqual({ kind: 'not_found', entity: 'session' });
  });
});

describe('logging sets in a running workout', () => {
  it('numbers sets 1..n per exercise, stamps completed sets with "now", leaves planned sets unstamped', async () => {
    const s = unwrap(await S().start({ name: 'P', exerciseIds: [bench, squat] }));
    const [a, b] = s.exercises;
    env.clock.advance(5 * MIN);
    const s1 = unwrap(await S().addSet(a.id, done));
    const s2 = unwrap(await S().addSet(a.id, { reps: 8 }));
    const s3 = unwrap(await S().addSet(b.id, { reps: 5, isWarmup: true, isCompleted: true }));
    expect([s1.setNumber, s2.setNumber, s3.setNumber]).toEqual([1, 2, 1]);
    expect(s1).toMatchObject({ isCompleted: true, completedAt: T0 + 5 * MIN, weightKg: 60, isWarmup: false });
    expect(s2).toMatchObject({ isCompleted: false, completedAt: null });
    expect(s3.isWarmup).toBe(true);
  });
  it('validates input and the owning exercise', async () => {
    const { seId } = await activeWithSet();
    expect(errorOf(await S().addSet(seId, { reps: -1 }))).toMatchObject({ kind: 'validation', issues: { reps: 'validation.outOfRange' } });
    expect(errorOf(await S().addSet(seId, { isCompleted: true }))).toMatchObject({ kind: 'validation', issues: { reps: 'validation.required' } });
    expect(errorOf(await S().addSet(seId, { reps: 5, completedAt: T0 + 1 }))).toMatchObject({ kind: 'validation', issues: { completedAt: 'validation.invalid' } });
    expect(errorOf(await S().addSet(999, { reps: 5 }))).toEqual({ kind: 'not_found', entity: 'session_exercise' });
    expect(errorOf(await S().addSet(seId, { reps: 5, isCompleted: true, completedAt: T0 - H }))).toMatchObject({ kind: 'constraint', constraint: 'check' }); // before the session began
  });
  it('updateSet merges fields, null clears, and the merged set is re-validated', async () => {
    const { set } = await activeWithSet();
    expect(unwrap(await S().updateSet(set.id, { weightKg: 65 }))).toMatchObject({ weightKg: 65, reps: 8, isCompleted: true });
    expect(unwrap(await S().updateSet(set.id, { weightKg: null }))).toMatchObject({ weightKg: null, reps: 8 });
    expect(errorOf(await S().updateSet(set.id, { reps: null }))).toMatchObject({ kind: 'validation' }); // completed set must keep a metric
    expect(unwrap(await S().updateSet(set.id, { isCompleted: false }))).toMatchObject({ isCompleted: false, completedAt: null });
    expect(unwrap(await S().updateSet(set.id, { isCompleted: true }))).toMatchObject({ isCompleted: true, completedAt: T0 });
    expect(errorOf(await S().updateSet(set.id, { isCompleted: false, completedAt: T0 }))).toMatchObject({ kind: 'validation' });
    expect(errorOf(await S().updateSet(999, { reps: 1 }))).toEqual({ kind: 'not_found', entity: 'set' });
  });
  it('deleting a set renumbers the rest without gaps, in order', async () => {
    const s = unwrap(await S().start({ name: 'P', exerciseIds: [bench] }));
    const id = s.exercises[0].id;
    const sets = [];
    for (let i = 1; i <= 4; i++) sets.push(unwrap(await S().addSet(id, { reps: i })));
    unwrap(await S().deleteSet(sets[1].id));
    const after = unwrap(await S().get(s.id)).exercises[0].sets;
    expect(after.map((x) => [x.setNumber, x.reps])).toEqual([[1, 1], [2, 3], [3, 4]]);
  });
  it('exercises can be added and removed with contiguous positions', async () => {
    const s = unwrap(await S().start({ name: 'P', exerciseIds: [bench, squat] }));
    const third = unwrap(await S().addExercise(s.id, bench));
    expect(third).toMatchObject({ position: 3, sets: [] });
    unwrap(await S().removeExercise(s.exercises[0].id));
    expect(unwrap(await S().get(s.id)).exercises.map((e) => [e.position, e.exerciseId])).toEqual([[1, squat], [2, bench]]);
    expect(errorOf(await S().addExercise(999, bench)).kind).toBe('not_found');
    expect(errorOf(await S().addExercise(s.id, 9999))).toMatchObject({ kind: 'constraint', constraint: 'foreign_key' });
    expect(errorOf(await S().removeExercise(999)).kind).toBe('not_found');
  });
});

describe('completing a session', () => {
  it('in_progress -> completed: sets the end time (never before the start or the last set) and the optional rpe', async () => {
    const { s } = await activeWithSet();
    env.clock.advance(45 * MIN);
    const c = unwrap(await S().complete(s.id, { rpe: 8 }));
    expect(c).toMatchObject({ status: 'completed', startedAt: T0, endedAt: T0 + 45 * MIN, rpe: 8, discardedAt: null });
  });
  it('a clock that moved backwards cannot produce an end before the last set', async () => {
    const { s } = await activeWithSet();
    env.clock.advance(20 * MIN);
    unwrap(await S().addSet(s.exercises[0].id, { reps: 5, isCompleted: true })); // set stamped T0+20m
    env.clock.set(T0 + 5 * MIN); // clock jumps back
    const c = unwrap(await S().complete(s.id));
    expect(c.endedAt).toBe(T0 + 20 * MIN);
  });
  it('needs at least one completed set; the session stays in progress and can still be discarded', async () => {
    const s = unwrap(await S().start({ name: 'P', exerciseIds: [bench] }));
    unwrap(await S().addSet(s.exercises[0].id, { reps: 5 })); // planned, not done
    expect(errorOf(await S().complete(s.id))).toEqual({ kind: 'invalid_transition', from: 'in_progress', to: 'completed', reason: 'no_completed_sets' });
    expect(unwrap(await S().get(s.id)).status).toBe('in_progress');
    expect(unwrap(await S().discard(s.id)).status).toBe('discarded');
  });
  it('validates rpe', async () => {
    const { s } = await activeWithSet();
    expect(errorOf(await S().complete(s.id, { rpe: 11 }))).toMatchObject({ kind: 'validation' });
    expect(unwrap(await S().get(s.id)).status).toBe('in_progress');
  });
});

describe('discarding a session (explicit status, kept as history, never counted)', () => {
  it('in_progress -> discarded records the discard time and keeps the data', async () => {
    const { s } = await activeWithSet();
    env.clock.advance(7 * MIN);
    const d = unwrap(await S().discard(s.id));
    expect(d).toMatchObject({ status: 'discarded', discardedAt: T0 + 7 * MIN, endedAt: null });
    const detail = unwrap(await S().get(s.id));
    expect(detail.exercises[0].sets).toHaveLength(1);
    expect(unwrap(await S().getActive())).toBeNull(); // frees the slot
  });
  it('does not count toward completed workouts, dates or the completed filter', async () => {
    await completedSession(); // 1 completed on 2026-10-21
    env.clock.advance(24 * H);
    const { s } = await activeWithSet(); // 2026-10-22
    unwrap(await S().discard(s.id));
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(unwrap(await S().countCompleted(range))).toBe(1);
    expect(unwrap(await S().completedDates(range))).toEqual(['2026-10-21']);
    expect(unwrap(await S().list({ status: 'completed' })).map((x) => x.status)).toEqual(['completed']);
    expect(unwrap(await S().list({ status: 'discarded' })).map((x) => x.status)).toEqual(['discarded']);
    expect(unwrap(await S().list()).map((x) => x.status)).toEqual(['discarded', 'completed']); // history lists everything, newest first
  });
  it('is frozen: no edits, no new sets or exercises', async () => {
    const { s, seId, set } = await activeWithSet();
    unwrap(await S().discard(s.id));
    expect(errorOf(await S().updateDetails(s.id, { name: 'x' }))).toEqual({ kind: 'immutable', reason: 'discarded_session' });
    expect(errorOf(await S().addSet(seId, { reps: 1 })).kind).toBe('immutable');
    expect(errorOf(await S().updateSet(set.id, { reps: 1 })).kind).toBe('immutable');
    expect(errorOf(await S().deleteSet(set.id)).kind).toBe('immutable');
    expect(errorOf(await S().addExercise(s.id, squat)).kind).toBe('immutable');
    expect(errorOf(await S().removeExercise(seId)).kind).toBe('immutable');
  });
});

describe('permitted status transitions (repository behaviour matches the domain rules)', () => {
  const statuses: SessionStatus[] = ['in_progress', 'completed', 'discarded'];
  async function sessionIn(status: SessionStatus) {
    if (status === 'completed') { const { s } = await completedSession(); return s.id; }
    const { s } = await activeWithSet();
    if (status === 'discarded') unwrap(await S().discard(s.id));
    return s.id;
  }
  it.each(statuses)('from %s: only in_progress may move, and only to completed or discarded', async (from) => {
    for (const to of ['completed', 'discarded'] as const) {
      const id = await sessionIn(from);
      const r = to === 'completed' ? await S().complete(id) : await S().discard(id);
      if (canTransition(from, to)) expect(r.ok).toBe(true);
      else expect(errorOf(r)).toEqual({ kind: 'invalid_transition', from, to, reason: 'not_permitted' });
      const expectedStatus = canTransition(from, to) ? to : from;
      expect(unwrap(await S().get(id)).status).toBe(expectedStatus);
      // clean up so the next iteration can start a new session
      const active = unwrap(await S().getActive());
      if (active) unwrap(await S().discard(active.id));
    }
  });
  it('there is no way back to in_progress: completed and discarded sessions stay put', async () => {
    const { s } = await completedSession();
    expect(errorOf(await S().discard(s.id)).kind).toBe('invalid_transition');
    expect(errorOf(await S().complete(s.id)).kind).toBe('invalid_transition');
    expect(unwrap(await S().get(s.id)).status).toBe('completed');
    await expect(env.db.run("UPDATE workout_sessions SET status='in_progress', ended_at=NULL WHERE id=?", [s.id])).rejects.toMatchObject({ appError: { kind: 'invalid_transition' } });
  });
});

describe('a COMPLETED session\'s exercises and sets are immutable', () => {
  const IMMUTABLE = { kind: 'immutable', reason: 'completed_session' } as const;
  it('refuses to change a set, and nothing changes', async () => {
    const { s, set } = await completedSession(60);
    const before = unwrap(await S().get(s.id));
    expect(errorOf(await S().updateSet(set.id, { weightKg: 62.5, reps: 7 }))).toMatchObject(IMMUTABLE);
    expect(unwrap(await S().get(s.id))).toEqual(before);
  });
  it('refuses a set added later (no made-up timestamp inside the finished session)', async () => {
    const { s, seId } = await completedSession(60);
    env.clock.advance(5 * H);
    expect(errorOf(await S().addSet(seId, { reps: 6, weightKg: 50, isCompleted: true }))).toMatchObject(IMMUTABLE);
    expect(unwrap(await S().get(s.id)).exercises[0].sets).toHaveLength(1);
  });
  it('refuses to add or remove an exercise', async () => {
    const { s, seId } = await completedSession(60);
    expect(errorOf(await S().addExercise(s.id, squat))).toMatchObject(IMMUTABLE);
    expect(errorOf(await S().removeExercise(seId))).toMatchObject(IMMUTABLE);
    expect(unwrap(await S().get(s.id)).exercises).toHaveLength(1);
  });
  it('refuses to delete or un-complete a set, with the same error for the last one as for any other', async () => {
    const { s, set } = await completedSession();
    expect(errorOf(await S().deleteSet(set.id))).toMatchObject(IMMUTABLE);
    expect(errorOf(await S().updateSet(set.id, { isCompleted: false }))).toMatchObject(IMMUTABLE);
    const d = unwrap(await S().get(s.id));
    expect(d.status).toBe('completed');
    expect(d.exercises[0].sets).toHaveLength(1);
    expect(d.exercises[0].sets[0].isCompleted).toBe(true);
  });
  it('set numbering and timestamps are validated while the session is still in progress', async () => {
    const { seId, set } = await activeWithSet();
    unwrap(await S().addSet(seId, { reps: 5, isCompleted: true }));
    unwrap(await S().addSet(seId, { reps: 4, isCompleted: true }));
    unwrap(await S().deleteSet(set.id)); // an in-progress workout can still remove a set; numbering stays gap-free
    expect(unwrap(await S().get(unwrap(await S().getActive())!.id)).exercises[0].sets.map((x) => [x.setNumber, x.reps])).toEqual([[1, 5], [2, 4]]);
    expect(errorOf(await S().addSet(seId, { reps: 5, isCompleted: true, completedAt: T0 - 1 }))).toMatchObject({ kind: 'constraint', constraint: 'check' });
    expect(unwrap(await S().updateSet(unwrap(await S().getActive())!.exercises[0].sets[0].id, { completedAt: T0 + MIN })).completedAt).toBe(T0 + MIN);
  });
  it('a finished workout still reads back whole, and discarding or completing it again is refused', async () => {
    const { s } = await completedSession(60);
    expect(errorOf(await S().complete(s.id))).toMatchObject({ kind: 'invalid_transition' });
    expect(errorOf(await S().discard(s.id))).toMatchObject({ kind: 'invalid_transition' });
    expect(unwrap(await S().get(s.id)).exercises[0].sets).toHaveLength(1);
  });
});

describe('correcting a COMPLETED session\'s own details', () => {
  it('updateDetails: rename, rpe, and moving the end time (never before the start or a set)', async () => {
    const { s } = await completedSession(60);
    expect(unwrap(await S().updateDetails(s.id, { name: 'Push (fixed)', rpe: 9 }))).toMatchObject({ name: 'Push (fixed)', rpe: 9, status: 'completed' });
    expect(unwrap(await S().updateDetails(s.id, { rpe: null })).rpe).toBeNull();
    env.clock.advance(2 * H); // moving the end later is allowed once that time has actually passed (E9: not into the future)
    expect(unwrap(await S().updateDetails(s.id, { endedAt: T0 + 2 * H })).endedAt).toBe(T0 + 2 * H);
    expect(errorOf(await S().updateDetails(s.id, { endedAt: T0 - 1 }))).toMatchObject({ kind: 'validation', issues: { endedAt: 'validation.outOfRange' } });
    // the only set is at T0, so ending exactly at the start is still consistent
    expect(unwrap(await S().updateDetails(s.id, { endedAt: T0 })).endedAt).toBe(T0);
  });
  it('updateDetails: the end cannot be moved before the last set', async () => {
    const { seId } = await activeWithSet();
    env.clock.advance(2 * H);
    unwrap(await S().addSet(seId, { reps: 5, isCompleted: true, completedAt: T0 + 90 * MIN }));
    const s = unwrap(await S().complete(unwrap(await S().getActive())!.id));
    expect(s.endedAt).toBe(T0 + 2 * H);
    expect(errorOf(await S().updateDetails(s.id, { endedAt: T0 + 60 * MIN }))).toMatchObject({ kind: 'constraint', constraint: 'check' });
    expect(unwrap(await S().get(s.id)).endedAt).toBe(T0 + 2 * H); // unchanged
  });
  it('updateDetails on a running session: name only (no end time, no rpe yet)', async () => {
    const { s } = await activeWithSet();
    expect(unwrap(await S().updateDetails(s.id, { name: 'Renamed' })).name).toBe('Renamed');
    expect(errorOf(await S().updateDetails(s.id, { endedAt: T0 + H }))).toMatchObject({ kind: 'validation', issues: { endedAt: 'validation.invalid' } });
    expect(errorOf(await S().updateDetails(s.id, { rpe: 5 }))).toMatchObject({ kind: 'validation', issues: { rpe: 'validation.invalid' } });
    expect(errorOf(await S().updateDetails(999, { name: 'x' })).kind).toBe('not_found');
  });
});

describe('history queries', () => {
  it('list: newest first, filters by range, paginates, clamps the limit', async () => {
    for (let i = 0; i < 3; i++) { await completedSession(); env.clock.advance(24 * H); }
    const all = unwrap(await S().list());
    expect(all.map((x) => x.localDate)).toEqual(['2026-10-23', '2026-10-22', '2026-10-21']);
    expect(unwrap(await S().list({ limit: 1, offset: 1 })).map((x) => x.localDate)).toEqual(['2026-10-22']);
    expect(unwrap(await S().list({ range: { from: '2026-10-22', to: '2026-10-22' } })).map((x) => x.localDate)).toEqual(['2026-10-22']);
    expect(unwrap(await S().list({ limit: 0 }))).toHaveLength(1); // clamped to >= 1
    expect(errorOf(await S().list({ range: { from: '2026-10-30', to: '2026-10-01' } })).kind).toBe('validation');
  });
  it('list({ status: "completed" }) never includes discarded or in-progress sessions, while an unfiltered list does', async () => {
    const done = await completedSession();
    env.clock.advance(H);
    const dropped = await activeWithSet();
    unwrap(await S().discard(dropped.s.id));
    const running = await activeWithSet();
    const completed = unwrap(await S().list({ status: 'completed' }));
    expect(completed.map((x) => x.id)).toEqual([done.s.id]);
    expect(completed.every((x) => x.status === 'completed')).toBe(true);
    expect(unwrap(await S().list({ status: 'discarded' })).map((x) => x.id)).toEqual([dropped.s.id]);
    expect(unwrap(await S().list()).map((x) => x.id).sort()).toEqual([done.s.id, dropped.s.id, running.s.id].sort()); // documented: no status = every status
    const range = { from: '2000-01-01', to: '2100-01-01' };
    expect(unwrap(await S().countCompleted(range))).toBe(1);
    expect(unwrap(await S().completedDates(range))).toHaveLength(1);
  });
  it('empty history gives empty results, not placeholders', async () => {
    const range = { from: '2026-01-01', to: '2026-12-31' };
    expect(unwrap(await S().list())).toEqual([]);
    expect(unwrap(await S().completedDates(range))).toEqual([]);
    expect(unwrap(await S().countCompleted(range))).toBe(0);
  });
  it('completedDates are distinct even with several workouts in one day; countCompleted counts each', async () => {
    await completedSession(); await completedSession();
    const range = { from: '2026-10-21', to: '2026-10-21' };
    expect(unwrap(await S().completedDates(range))).toEqual(['2026-10-21']);
    expect(unwrap(await S().countCompleted(range))).toBe(2);
    expect(errorOf(await S().countCompleted({ from: '2026-02-30', to: '2026-03-01' })).kind).toBe('validation');
  });
});

describe('session insertion invariants (E7)', () => {
  const insert = (status: string, extra = '') =>
    env.db.exec(`INSERT INTO workout_sessions(name,status,started_at,ended_at,discarded_at,local_date) VALUES ('x','${status}',${T0},${status === 'completed' ? T0 + H : 'NULL'},${status === 'discarded' ? T0 + H : 'NULL'},'2026-10-21')${extra}`);
  it('direct SQL cannot create a completed or discarded session, and nothing is left behind', async () => {
    await expect(insert('completed')).rejects.toMatchObject({ appError: { kind: 'invalid_transition', reason: 'must_start_in_progress' } });
    await expect(insert('discarded')).rejects.toMatchObject({ appError: { kind: 'invalid_transition', reason: 'must_start_in_progress' } });
    expect(unwrap(await S().list())).toEqual([]);
    expect(unwrap(await S().countCompleted({ from: '2026-01-01', to: '2026-12-31' }))).toBe(0); // no empty "completed" workout in the statistics
  });
  it('repository start() always creates an in-progress session; completion still requires a completed set', async () => {
    const s = unwrap(await S().start({ name: 'Free', exerciseIds: [bench] }));
    expect(s.status).toBe('in_progress');
    expect(errorOf(await S().complete(s.id)).kind).toBe('invalid_transition');
  });
});

describe('user-supplied times may not be in the future (E9)', () => {
  const OUT = { kind: 'validation', issues: { completedAt: 'validation.outOfRange' } };
  it('a set completion time more than 5 minutes ahead of the clock is rejected; within the tolerance is accepted', async () => {
    const { seId, set } = await activeWithSet();
    expect(errorOf(await S().addSet(seId, { reps: 5, isCompleted: true, completedAt: T0 + 6 * MIN }))).toMatchObject(OUT);
    expect(errorOf(await S().updateSet(set.id, { completedAt: T0 + 6 * MIN }))).toMatchObject(OUT);
    expect(unwrap(await S().addSet(seId, { reps: 5, isCompleted: true, completedAt: T0 + 5 * MIN })).completedAt).toBe(T0 + 5 * MIN);
  });
  it('a far-future set cannot drag the session end (and its duration) into the future', async () => {
    const { s, seId } = await activeWithSet();
    expect(errorOf(await S().addSet(seId, { reps: 5, isCompleted: true, completedAt: T0 + 400 * 24 * H }))).toMatchObject(OUT);
    expect(unwrap(await S().complete(s.id)).endedAt).toBe(T0);
  });
  it('a corrected end time in the future is rejected', async () => {
    const { s } = await completedSession(60);
    expect(errorOf(await S().updateDetails(s.id, { endedAt: T0 + 61 * MIN + 5 * MIN + 1 }))).toMatchObject({ kind: 'validation', issues: { endedAt: 'validation.outOfRange' } });
    expect(unwrap(await S().updateDetails(s.id, { endedAt: T0 + 65 * MIN })).endedAt).toBe(T0 + 65 * MIN);
  });
});
