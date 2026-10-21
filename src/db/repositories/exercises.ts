import type { Exercise } from '../../domain/models';
import type { ExerciseRepository } from '../../domain/repositories';
import { err } from '../../domain/result';
import { exerciseInput, exercisePatch, parseInput } from '../../domain/schemas';
import { RepoContext, bit, fail, flag, guard, likePattern, notFound } from './base';

export interface ExerciseRow {
  id: number; slug: string | null; source: 'seed' | 'user'; custom_name: string | null; category: Exercise['category'];
  primary_muscle: Exercise['primaryMuscle']; secondary_muscles: string; equipment: Exercise['equipment'];
  tracking_type: Exercise['trackingType']; met_value: number | null; is_archived: number; created_at: number;
}
export const toExercise = (r: ExerciseRow): Exercise => ({
  id: r.id, slug: r.slug, source: r.source, customName: r.custom_name, category: r.category, primaryMuscle: r.primary_muscle,
  secondaryMuscles: JSON.parse(r.secondary_muscles) as Exercise['secondaryMuscles'], equipment: r.equipment, trackingType: r.tracking_type,
  metValue: r.met_value, isArchived: flag(r.is_archived), createdAt: r.created_at,
});

export function createExerciseRepository(ctx: RepoContext): ExerciseRepository {
  const load = async (id: number): Promise<Exercise> => {
    const r = await ctx.db.first<ExerciseRow>('SELECT * FROM exercises WHERE id=?', [id]);
    return r ? toExercise(r) : notFound('exercise');
  };
  return {
    list: (filter = {}) => guard(async () => {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (!filter.includeArchived) where.push('is_archived=0');
      if (filter.primaryMuscle) { where.push('primary_muscle=?'); params.push(filter.primaryMuscle); }
      if (filter.equipment) { where.push('equipment=?'); params.push(filter.equipment); }
      if (filter.category) { where.push('category=?'); params.push(filter.category); }
      if (filter.search?.trim()) {
        where.push("(custom_name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\')");
        params.push(likePattern(filter.search), likePattern(filter.search));
      }
      const rows = await ctx.db.all<ExerciseRow>(
        `SELECT * FROM exercises ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(custom_name, slug) COLLATE NOCASE, id`, params);
      return rows.map(toExercise);
    }),
    get: (id) => guard(() => load(id)),
    async create(input) {
      const parsed = parseInput(exerciseInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const r = await ctx.db.run(
          `INSERT INTO exercises(source,custom_name,category,primary_muscle,secondary_muscles,equipment,tracking_type,met_value,created_at)
           VALUES ('user',?,?,?,?,?,?,?,?)`,
          [v.name, v.category, v.primaryMuscle, JSON.stringify(v.secondaryMuscles), v.equipment, v.trackingType, v.metValue ?? null, ctx.now()]);
        return load(r.lastInsertRowId);
      });
    },
    async update(id, patch) {
      const parsed = parseInput(exercisePatch, patch);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const current = await load(id);
        if (current.source === 'seed') return fail({ kind: 'immutable', reason: 'seed_row' });
        const next = {
          name: v.name ?? current.customName!, category: v.category ?? current.category, primaryMuscle: v.primaryMuscle ?? current.primaryMuscle,
          secondaryMuscles: v.secondaryMuscles ?? current.secondaryMuscles, equipment: v.equipment ?? current.equipment,
          trackingType: v.trackingType ?? current.trackingType, metValue: v.metValue === undefined ? current.metValue : v.metValue, // undefined = unchanged, null = clear
        };
        // the merged result must satisfy the same rules as a new exercise (e.g. secondary muscles exclude the primary)
        const full = parseInput(exerciseInput, { ...next, metValue: next.metValue ?? undefined });
        if (!full.ok) return fail(full.error);
        await ctx.db.run(
          'UPDATE exercises SET custom_name=?, category=?, primary_muscle=?, secondary_muscles=?, equipment=?, tracking_type=?, met_value=? WHERE id=?',
          [next.name, next.category, next.primaryMuscle, JSON.stringify(next.secondaryMuscles), next.equipment, next.trackingType, next.metValue, id]);
        return load(id);
      });
    },
    setArchived: (id, archived) => guard(async () => {
      await load(id);
      await ctx.db.run('UPDATE exercises SET is_archived=? WHERE id=?', [bit(archived), id]);
      return load(id);
    }),
    delete: (id) => guard(async () => {
      await load(id);
      await ctx.db.run('DELETE FROM exercises WHERE id=?', [id]); // seed -> immutable (trigger); in use -> foreign_key (RESTRICT)
    }),
  };
}
