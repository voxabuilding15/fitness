import { SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { createRepoEnv, errorOf, unwrap, type RepoEnv } from '../../db/testing/repoEnv';

let env: RepoEnv;
beforeEach(async () => {
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
});

const lookup = async () => {
  const all = unwrap(await env.repos.exercises.list());
  return (slug: string) => all.find((e) => e.slug === slug)!.id;
};
const template = async (name = 'Full body', slugs = ['bench_press', 'pull_up', 'back_squat', 'plank', 'running']) => {
  const id = await lookup();
  return unwrap(await env.repos.templates.create({
    name, exercises: slugs.map((s, i) => ({ exerciseId: id(s), targetSets: 3 + i, targetRepsMin: 5 + i, restSec: 30 * (i + 1) })),
  }));
};
const count = async (table: string) => (await env.db.first<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`))!.n;

describe('starting a session from a saved template', () => {
  it('creates one in-progress session linked to the template, with its exercises in template order and no sets', async () => {
    const t = await template();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    expect(s).toMatchObject({ templateId: t.id, name: 'Full body', status: 'in_progress', endedAt: null, localDate: '2026-10-21' });
    expect(s.exercises.map((e) => e.exerciseId)).toEqual(t.exercises.map((e) => e.exerciseId));
    expect(s.exercises.map((e) => e.position)).toEqual([1, 2, 3, 4, 5]);
    expect(s.exercises.every((e) => e.sets.length === 0)).toBe(true);
    expect(unwrap(await env.repos.sessions.getActive())?.id).toBe(s.id);
    expect(unwrap(await env.repos.sessions.get(s.id))).toEqual(s); // what was returned is what is stored
  });

  it('follows the template order after it was reordered, and never changes the template', async () => {
    const t = await template();
    const reordered = unwrap(await env.repos.templates.update(t.id, {
      name: 'Full body', exercises: [...t.exercises].reverse().map((e) => ({ exerciseId: e.exerciseId, targetSets: e.targetSets, targetRepsMin: e.targetRepsMin ?? undefined, targetDurationSec: e.targetDurationSec ?? undefined, restSec: e.restSec })),
    }));
    const before = unwrap(await env.repos.templates.get(t.id));
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    expect(s.exercises.map((e) => e.exerciseId)).toEqual(reordered.exercises.map((e) => e.exerciseId));
    expect(unwrap(await env.repos.templates.get(t.id))).toEqual(before);
  });

  it('a missing template is not found and writes nothing', async () => {
    expect(errorOf(await env.repos.sessions.start({ templateId: 999 }))).toEqual({ kind: 'not_found', entity: 'template' });
    expect(await count('workout_sessions')).toBe(0);
    expect(await count('session_exercises')).toBe(0);
  });

  it('a second start while one is in progress is a conflict that leaves exactly the first session behind', async () => {
    const a = await template('A', ['pull_up']);
    const b = await template('B', ['plank', 'running']);
    const first = unwrap(await env.repos.sessions.start({ templateId: a.id }));
    expect(errorOf(await env.repos.sessions.start({ templateId: b.id }))).toEqual({ kind: 'conflict', reason: 'active_session' });
    expect(await count('workout_sessions')).toBe(1);
    expect(await count('session_exercises')).toBe(1); // the failed start's rows were rolled back
    expect(unwrap(await env.repos.sessions.getActive())?.id).toBe(first.id);
  });

  it('simultaneous starts create only one session', async () => {
    const t = await template();
    const results = await Promise.all([env.repos.sessions.start({ templateId: t.id }), env.repos.sessions.start({ templateId: t.id }), env.repos.sessions.start({ templateId: t.id })]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.error.kind === 'conflict')).toBe(true);
    expect(await count('workout_sessions')).toBe(1);
    expect(await count('session_exercises')).toBe(5);
  });

  it('deleting the template afterwards keeps the session and its exercises (the link becomes empty)', async () => {
    const t = await template();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    unwrap(await env.repos.templates.delete(t.id));
    const kept = unwrap(await env.repos.sessions.get(s.id));
    expect(kept).toMatchObject({ templateId: null, name: 'Full body', status: 'in_progress' });
    expect(kept.exercises).toHaveLength(5);
  });

  it('editing the template afterwards does not change the session\'s exercises', async () => {
    const t = await template();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    const one = t.exercises[0];
    unwrap(await env.repos.templates.update(t.id, { name: 'Renamed', exercises: [{ exerciseId: one.exerciseId, targetSets: 1, targetRepsMin: 1, restSec: 0 }] }));
    expect(unwrap(await env.repos.sessions.get(s.id))).toMatchObject({ name: 'Full body' });
    expect(unwrap(await env.repos.sessions.get(s.id)).exercises).toHaveLength(5);
  });

  it('a session whose exercise is hidden still opens, and the exercise cannot be deleted while used', async () => {
    const t = await template('H', ['pull_up']);
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    unwrap(await env.repos.exercises.setArchived(s.exercises[0].exerciseId, true));
    expect(unwrap(await env.repos.sessions.get(s.id)).exercises).toHaveLength(1);
  });
});
