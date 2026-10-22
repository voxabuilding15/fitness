import { createRepoEnv, H, T0, unwrap, type RepoEnv } from '../../db/testing/repoEnv';

let env: RepoEnv;
beforeEach(async () => { env = await createRepoEnv(); });

const exercise = async (name: string) => unwrap(await env.repos.exercises.create({ name, category: 'strength', primaryMuscle: 'chest', equipment: 'barbell', trackingType: 'weight_reps' }));
const workout = async (ids: number[], sets: Record<number, [number, number][]>, end: 'complete' | 'discard' | 'keep' = 'complete') => {
  const s = unwrap(await env.repos.sessions.start({ name: 'W', exerciseIds: ids }));
  for (const se of s.exercises) for (const [w, r] of sets[se.exerciseId] ?? []) unwrap(await env.repos.sessions.addSet(se.id, { weightKg: w, reps: r, isCompleted: true }));
  if (end === 'complete') unwrap(await env.repos.sessions.complete(s.id));
  if (end === 'discard') unwrap(await env.repos.sessions.discard(s.id));
  return s;
};

describe('sessions.lastPerformance', () => {
  it('returns the completed sets of the most recent completed workout that logged the exercise, in order', async () => {
    const bench = await exercise('Bench');
    await workout([bench.id], { [bench.id]: [[60, 10]] });
    env.clock.advance(24 * H);
    const newer = await workout([bench.id], { [bench.id]: [[80, 8], [80, 7]] });
    const r = unwrap(await env.repos.sessions.lastPerformance([bench.id]));
    expect(r[bench.id]).toMatchObject({ sessionId: newer.id, localDate: '2026-10-22' });
    expect(r[bench.id].sets.map((s) => [s.setNumber, s.weightKg, s.reps])).toEqual([[1, 80, 8], [2, 80, 7]]);
  });

  it('ignores in-progress and discarded workouts, and exercises never done are absent', async () => {
    const bench = await exercise('Bench');
    const squat = await exercise('Squat');
    const fly = await exercise('Fly');
    await workout([bench.id], { [bench.id]: [[60, 10]] });
    env.clock.advance(H);
    await workout([bench.id, squat.id], { [bench.id]: [[100, 1]], [squat.id]: [[100, 5]] }, 'discard');
    env.clock.advance(H);
    await workout([bench.id], { [bench.id]: [[90, 3]] }, 'keep');
    const r = unwrap(await env.repos.sessions.lastPerformance([bench.id, squat.id, fly.id]));
    expect(r[bench.id].sets.map((s) => s.weightKg)).toEqual([60]);
    expect(r[squat.id]).toBeUndefined();
    expect(r[fly.id]).toBeUndefined();
  });

  it('skips a newer workout that included the exercise but logged nothing for it', async () => {
    const bench = await exercise('Bench');
    const squat = await exercise('Squat');
    await workout([bench.id], { [bench.id]: [[60, 10]] });
    env.clock.advance(H);
    await workout([bench.id, squat.id], { [squat.id]: [[100, 5]] }); // bench was in the workout but had no sets
    const r = unwrap(await env.repos.sessions.lastPerformance([bench.id]));
    expect(r[bench.id].sets.map((s) => s.weightKg)).toEqual([60]);
  });

  it('handles empty, duplicate and nonsense ids without failing', async () => {
    const bench = await exercise('Bench');
    await workout([bench.id], { [bench.id]: [[60, 10]] });
    expect(unwrap(await env.repos.sessions.lastPerformance([]))).toEqual({});
    const r = unwrap(await env.repos.sessions.lastPerformance([bench.id, bench.id, -1, 0, 1.5, NaN]));
    expect(Object.keys(r)).toEqual([String(bench.id)]);
    void T0;
  });
});
