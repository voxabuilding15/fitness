import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { createRepositories } from '../../db/repositories';
import { runSeed } from '../../db/seedRunner';
import { openFileTestDb } from '../../db/testing/testDb';
import { ManualClock } from '../../domain/clock';
import { T0, errorOf, unwrap } from '../../db/testing/repoEnv';
import type { Database } from '../../db/database';
import { addExercise, draftFromTemplate, emptyTemplateDraft, moveItem, planTemplateSave, removeItem, updateItem } from '../../domain/templateBuilder';

let dir: string;
let path: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-templates-')); path = join(dir, 'app.db'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const reposFor = (db: Database) => createRepositories({ db, clock: new ManualClock(T0), utcOffsetMinutes: () => 0 });
const FIVE = ['bench_press', 'pull_up', 'back_squat', 'plank', 'running'];

async function open() {
  const db = await openFileTestDb(path);
  unwrap(await runSeed(db, SEED_PACK, new ManualClock(T0)));
  return { db, repos: reposFor(db) };
}

describe('workout templates built from the library, across closing and reopening the database file', () => {
  it('a template of five library exercises keeps its order and every target after a restart', async () => {
    let { db, repos } = await open();
    const all = unwrap(await repos.exercises.list());
    const exercises = FIVE.map((slug) => all.find((e) => e.slug === slug)!);
    let draft = { ...emptyTemplateDraft(), name: 'Full body', notes: 'Heavy' };
    for (const e of exercises) draft = addExercise(draft, e);
    draft = updateItem(draft, 2, { sets: '5', repsMin: '3', repsMax: '5', restSec: '180' });
    const plan = planTemplateSave(draft, []);
    if (!plan.ok) throw new Error(JSON.stringify(plan.error));
    const created = unwrap(await repos.templates.create(plan.value));
    expect(created.exercises).toHaveLength(5);
    await db.close();

    ({ db, repos } = await (async () => { const d = await openFileTestDb(path); return { db: d, repos: reposFor(d) }; })());
    const reopened = unwrap(await repos.templates.get(created.id));
    expect(reopened.name).toBe('Full body');
    expect(reopened.notes).toBe('Heavy');
    expect(reopened.exercises.map((e) => e.position)).toEqual([1, 2, 3, 4, 5]);
    expect(reopened.exercises.map((e) => e.exerciseId)).toEqual(exercises.map((e) => e.id));
    expect(reopened.exercises[1]).toMatchObject({ targetSets: 5, targetRepsMin: 3, targetRepsMax: 5, targetDurationSec: null, restSec: 180 });
    expect(reopened.exercises[3]).toMatchObject({ targetSets: 3, targetRepsMin: null, targetDurationSec: 30, restSec: 60 }); // plank is timed
    // opening it again for editing and saving without a change reproduces the same rows
    const again = planTemplateSave(draftFromTemplate(reopened), [reopened], reopened.id);
    if (!again.ok) throw new Error(JSON.stringify(again.error));
    const saved = unwrap(await repos.templates.update(reopened.id, again.value));
    expect(saved.exercises.map(({ id: _id, ...rest }) => rest)).toEqual(reopened.exercises.map(({ id: _id, ...rest }) => rest));
    expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
    await db.close();
  });

  it('reordering and removing rows, then saving, rewrites positions without gaps and leaves other templates alone', async () => {
    const { db, repos } = await open();
    const all = unwrap(await repos.exercises.list());
    const ex = FIVE.map((slug) => all.find((e) => e.slug === slug)!);
    let draft = { ...emptyTemplateDraft(), name: 'A' };
    for (const e of ex) draft = addExercise(draft, e);
    const a = unwrap(await repos.templates.create((planTemplateSave(draft, []) as any).value));
    const other = unwrap(await repos.templates.create((planTemplateSave({ ...addExercise(emptyTemplateDraft(), ex[0]), name: 'B' }, []) as any).value));

    let edit = draftFromTemplate(a);
    edit = removeItem(edit, edit.items[1].key); // drop pull_up
    edit = moveItem(edit, edit.items[3].key, -1); // running above plank
    const plan = planTemplateSave(edit, unwrap(await repos.templates.list()), a.id);
    const updated = unwrap(await repos.templates.update(a.id, (plan as any).value));
    expect(updated.exercises.map((e) => e.exerciseId)).toEqual([ex[0], ex[2], ex[4], ex[3]].map((e) => e.id));
    expect(updated.exercises.map((e) => e.position)).toEqual([1, 2, 3, 4]);
    expect(unwrap(await repos.templates.get(other.id))).toEqual(other);
    await db.close();
  });

  it('a failed save changes nothing: the old template and its exercises are intact', async () => {
    const { db, repos } = await open();
    const all = unwrap(await repos.exercises.list());
    const t = unwrap(await repos.templates.create({ name: 'Keep', exercises: [{ exerciseId: all[0].id, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    const bad = errorOf(await repos.templates.update(t.id, { name: 'Broken', exercises: [{ exerciseId: all[1].id, targetSets: 3, targetRepsMin: 8, restSec: 60 }, { exerciseId: 999999, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    expect(bad.kind).toBe('constraint');
    expect(unwrap(await repos.templates.get(t.id))).toEqual(t);
    await db.close();
  });

  it('deleting a template keeps the exercises and the completed sessions that came from it', async () => {
    const { db, repos } = await open();
    const all = unwrap(await repos.exercises.list());
    const t = unwrap(await repos.templates.create({ name: 'Gone', exercises: [{ exerciseId: all[0].id, targetSets: 2, targetRepsMin: 8, restSec: 60 }] }));
    const s = unwrap(await repos.sessions.start({ templateId: t.id }));
    unwrap(await repos.sessions.addSet(s.exercises[0].id, { reps: 8, isCompleted: true }));
    unwrap(await repos.sessions.complete(s.id, {}));
    unwrap(await repos.templates.delete(t.id));
    expect(unwrap(await repos.templates.list())).toEqual([]);
    expect(unwrap(await repos.exercises.list()).length).toBe(all.length);
    const kept = unwrap(await repos.sessions.get(s.id));
    expect(kept).toMatchObject({ status: 'completed', templateId: null });
    expect(kept.exercises[0].sets).toHaveLength(1);
    await db.close();
  });

  it('an exercise used by a template cannot be deleted, so a template never points at nothing', async () => {
    const { db, repos } = await open();
    const mine = unwrap(await repos.exercises.create({ name: 'Mine', category: 'strength', primaryMuscle: 'core', equipment: 'cable', trackingType: 'reps_only' }));
    unwrap(await repos.templates.create({ name: 'Uses mine', exercises: [{ exerciseId: mine.id, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    expect(errorOf(await repos.exercises.delete(mine.id))).toMatchObject({ kind: 'constraint', constraint: 'foreign_key' });
    expect(unwrap(await repos.exercises.setArchived(mine.id, true)).isArchived).toBe(true); // hiding is allowed and keeps the template valid
    expect(unwrap(await repos.templates.list())[0].exercises[0].exerciseId).toBe(mine.id);
    await db.close();
  });
});
