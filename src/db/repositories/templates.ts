import type { WorkoutTemplate } from '../../domain/models';
import type { TemplateRepository } from '../../domain/repositories';
import { err } from '../../domain/result';
import { parseInput, templateInput, type TemplateInput } from '../../domain/schemas';
import type { SqlExecutor } from '../sqlDatabase';
import { RepoContext, guard, notFound } from './base';

interface TemplateRow { id: number; name: string; notes: string | null; created_at: number; updated_at: number }
interface TemplateExerciseRow {
  id: number; template_id: number; exercise_id: number; position: number; target_sets: number; target_reps_min: number | null;
  target_reps_max: number | null; target_duration_sec: number | null; rest_sec: number;
}

async function loadAll(db: SqlExecutor, id?: number): Promise<WorkoutTemplate[]> {
  const templates = await db.all<TemplateRow>(`SELECT * FROM workout_templates ${id ? 'WHERE id=?' : ''} ORDER BY updated_at DESC, id DESC`, id ? [id] : []);
  if (!templates.length) return [];
  const rows = await db.all<TemplateExerciseRow>(`SELECT * FROM template_exercises ${id ? 'WHERE template_id=?' : ''} ORDER BY template_id, position`, id ? [id] : []);
  return templates.map((t) => ({
    id: t.id, name: t.name, notes: t.notes, createdAt: t.created_at, updatedAt: t.updated_at,
    exercises: rows.filter((e) => e.template_id === t.id).map((e) => ({
      id: e.id, exerciseId: e.exercise_id, position: e.position, targetSets: e.target_sets, targetRepsMin: e.target_reps_min,
      targetRepsMax: e.target_reps_max, targetDurationSec: e.target_duration_sec, restSec: e.rest_sec,
    })),
  }));
}

async function insertExercises(tx: SqlExecutor, templateId: number, list: ReturnType<typeof templateInput.parse>['exercises']) {
  let position = 1;
  for (const e of list) {
    await tx.run(
      `INSERT INTO template_exercises(template_id,exercise_id,position,target_sets,target_reps_min,target_reps_max,target_duration_sec,rest_sec)
       VALUES (?,?,?,?,?,?,?,?)`,
      [templateId, e.exerciseId, position++, e.targetSets, e.targetRepsMin ?? null, e.targetRepsMax ?? null, e.targetDurationSec ?? null, e.restSec]);
  }
}

export function createTemplateRepository(ctx: RepoContext): TemplateRepository {
  const one = async (db: SqlExecutor, id: number) => (await loadAll(db, id))[0] ?? notFound('template');

  async function create(input: TemplateInput) {
    const parsed = parseInput(templateInput, input);
    if (!parsed.ok) return err(parsed.error);
    const v = parsed.value;
    return guard(() => ctx.db.transaction(async (tx) => {
      const now = ctx.now();
      const r = await tx.run('INSERT INTO workout_templates(name,notes,created_at,updated_at) VALUES (?,?,?,?)', [v.name, v.notes || null, now, now]);
      await insertExercises(tx, r.lastInsertRowId, v.exercises);
      return one(tx, r.lastInsertRowId);
    }));
  }

  return {
    list: () => guard(() => loadAll(ctx.db)),
    get: (id) => guard(() => one(ctx.db, id)),
    create,
    async update(id, input) {
      const parsed = parseInput(templateInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(() => ctx.db.transaction(async (tx) => {
        await one(tx, id);
        await tx.run('UPDATE workout_templates SET name=?, notes=?, updated_at=? WHERE id=?', [v.name, v.notes || null, ctx.now(), id]);
        await tx.run('DELETE FROM template_exercises WHERE template_id=?', [id]);
        await insertExercises(tx, id, v.exercises);
        return one(tx, id);
      }));
    },
    delete: (id) => guard(async () => {
      await one(ctx.db, id);
      await ctx.db.run('DELETE FROM workout_templates WHERE id=?', [id]); // sessions keep their history (template_id -> NULL)
    }),
    async duplicate(id, newName) {
      const source = await guard(() => one(ctx.db, id));
      if (!source.ok) return source;
      return create({
        name: newName, notes: source.value.notes ?? undefined,
        exercises: source.value.exercises.map((e) => ({
          exerciseId: e.exerciseId, targetSets: e.targetSets, targetRepsMin: e.targetRepsMin ?? undefined, targetRepsMax: e.targetRepsMax ?? undefined,
          targetDurationSec: e.targetDurationSec ?? undefined, restSec: e.restSec,
        })),
      });
    },
  };
}
