import { SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { createRepoEnv, errorOf, unwrap, T0, type RepoEnv } from '../../db/testing/repoEnv';

let env: RepoEnv;
let bench = 0;
let plank = 0;
beforeEach(async () => {
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  const all = unwrap(await env.repos.exercises.list());
  bench = all.find((e) => e.slug === 'bench_press')!.id;
  plank = all.find((e) => e.slug === 'plank')!.id;
});
const DAY = 86_400_000;
const range = { from: '2026-10-01', to: '2026-10-31' };
type SetSpec = { exercise?: number; weight?: number; reps?: number; seconds?: number; warmup?: boolean; done?: boolean };

/** a workout on `daysFromT0`, lasting `minutes`, ended as asked */
async function workout(daysFromT0: number, sets: SetSpec[], opts: { minutes?: number; end?: 'complete' | 'discard' | 'leave' } = {}) {
  env.clock.set(T0 + daysFromT0 * DAY);
  const s = unwrap(await env.repos.sessions.start({ name: 'W', exerciseIds: [bench, plank] }));
  for (const x of sets) {
    const se = s.exercises.find((e) => e.exerciseId === (x.exercise ?? bench))!;
    const done = x.done ?? true;
    unwrap(await env.repos.sessions.addSet(se.id, { weightKg: x.weight, reps: x.reps, durationSec: x.seconds, isWarmup: x.warmup ?? false, isCompleted: done }));
  }
  env.clock.advance((opts.minutes ?? 30) * 60_000);
  const end = opts.end ?? 'complete';
  if (end === 'complete') unwrap(await env.repos.sessions.complete(s.id, {}));
  if (end === 'discard') unwrap(await env.repos.sessions.discard(s.id));
  return s;
}

describe('SessionRepository.dailyActivity', () => {
  it('sums a completed workout: sets, reps, weight x reps and minutes', async () => {
    await workout(0, [{ weight: 80, reps: 5 }, { weight: 82.5, reps: 3 }, { exercise: plank, seconds: 45 }], { minutes: 42 });
    expect(unwrap(await env.repos.sessions.dailyActivity(range))).toEqual([
      { localDate: '2026-10-21', workouts: 1, sets: 3, reps: 8, volumeKg: 647.5, minutes: 42 },
    ]);
  });

  it('two workouts on one day add up and are not multiplied by their sets', async () => {
    await workout(0, [{ weight: 100, reps: 1 }, { weight: 100, reps: 1 }], { minutes: 20 });
    await workout(0, [{ weight: 50, reps: 10 }], { minutes: 25 });
    const [d] = unwrap(await env.repos.sessions.dailyActivity(range));
    expect(d).toEqual({ localDate: '2026-10-21', workouts: 2, sets: 3, reps: 12, volumeKg: 700, minutes: 45 });
  });

  it('discarded and in-progress workouts contribute nothing', async () => {
    await workout(-2, [{ weight: 60, reps: 8 }], { end: 'discard' });
    await workout(-1, [{ weight: 70, reps: 8 }], { end: 'complete' });
    await workout(0, [{ weight: 999, reps: 9 }], { end: 'leave' });
    const rows = unwrap(await env.repos.sessions.dailyActivity(range));
    expect(rows.map((r) => r.localDate)).toEqual(['2026-10-20']);
    expect(rows[0].volumeKg).toBe(560);
    // while the retained rows of the discarded workout are still stored
    expect((await env.db.first<{ n: number }>("SELECT COUNT(*) n FROM workout_sessions WHERE status='discarded'"))!.n).toBe(1);
  });

  it('warm-up sets and sets that were never completed are left out', async () => {
    await workout(0, [{ weight: 40, reps: 10, warmup: true }, { weight: 80, reps: 5 }, { weight: 90, reps: 5, done: false }]);
    const [d] = unwrap(await env.repos.sessions.dailyActivity(range));
    expect(d).toMatchObject({ sets: 1, reps: 5, volumeKg: 400 });
  });

  it('only days inside the range are returned, oldest first, and an empty range gives an empty list', async () => {
    await workout(10, [{ weight: 10, reps: 10 }]); // 2026-10-31
    await workout(-5, [{ weight: 20, reps: 10 }]); // 2026-10-16
    await workout(15, [{ weight: 30, reps: 10 }]); // 2026-11-05
    expect(unwrap(await env.repos.sessions.dailyActivity(range)).map((r) => r.localDate)).toEqual(['2026-10-16', '2026-10-31']);
    expect(unwrap(await env.repos.sessions.dailyActivity({ from: '2026-12-01', to: '2026-12-31' }))).toEqual([]);
  });

  it('a workout of timed sets only has sets and minutes but no volume', async () => {
    await workout(0, [{ exercise: plank, seconds: 60 }], { minutes: 10 });
    expect(unwrap(await env.repos.sessions.dailyActivity(range))[0]).toMatchObject({ sets: 1, reps: 0, volumeKg: 0, minutes: 10 });
  });

  it('rejects an invalid range', async () => {
    expect(errorOf(await env.repos.sessions.dailyActivity({ from: '2026-10-31', to: '2026-10-01' })).kind).toBe('validation');
    expect(errorOf(await env.repos.sessions.dailyActivity({ from: '2026-02-30', to: '2026-03-01' })).kind).toBe('validation');
  });

  it('agrees with countCompleted', async () => {
    await workout(-3, [{ weight: 1, reps: 1 }]);
    await workout(-2, [{ weight: 1, reps: 1 }], { end: 'discard' });
    await workout(-1, [{ weight: 1, reps: 1 }]);
    const total = unwrap(await env.repos.sessions.dailyActivity(range)).reduce((s, r) => s + r.workouts, 0);
    expect(total).toBe(unwrap(await env.repos.sessions.countCompleted(range)));
  });
});
