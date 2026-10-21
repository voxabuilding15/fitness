import type { Goals, Profile } from '../../domain/models';
import type { GoalsRepository, ProfileRepository } from '../../domain/repositories';
import { err } from '../../domain/result';
import { goalsInput, parseInput, profileInput } from '../../domain/schemas';
import { RepoContext, guard } from './base';

interface ProfileRow {
  display_name: string; location: string | null; sex: Profile['sex']; age_years: number | null; age_set_on: string | null;
  height_cm: number | null; activity_level: Profile['activityLevel']; updated_at: number;
}
const toProfile = (r: ProfileRow): Profile => ({
  displayName: r.display_name, location: r.location, sex: r.sex, ageYears: r.age_years, ageSetOn: r.age_set_on,
  heightCm: r.height_cm, activityLevel: r.activity_level, updatedAt: r.updated_at,
});

export function createProfileRepository(ctx: RepoContext): ProfileRepository {
  const get = () => guard(async () => {
    const r = await ctx.db.first<ProfileRow>('SELECT * FROM profile WHERE id=1');
    return r ? toProfile(r) : null;
  });
  return {
    get,
    async save(input) {
      const parsed = parseInput(profileInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const now = ctx.now();
        // Only record when an age was entered; the date lets the app say how old that figure is, never guess.
        const ageSetOn = v.ageYears === undefined ? null : ctx.localDate(now);
        await ctx.db.run(
          `INSERT INTO profile(id,display_name,location,sex,age_years,age_set_on,height_cm,activity_level,updated_at)
           VALUES (1,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name, location=excluded.location, sex=excluded.sex,
             age_years=excluded.age_years, age_set_on=excluded.age_set_on, height_cm=excluded.height_cm,
             activity_level=excluded.activity_level, updated_at=excluded.updated_at`,
          [v.displayName, v.location || null, v.sex ?? null, v.ageYears ?? null, ageSetOn, v.heightCm ?? null, v.activityLevel ?? null, now],
        );
        return toProfile((await ctx.db.first<ProfileRow>('SELECT * FROM profile WHERE id=1'))!);
      });
    },
  };
}

interface GoalsRow {
  goal_type: Goals['goalType']; target_weight_kg: number | null; kcal_target: number | null; protein_g: number | null;
  carbs_g: number | null; fat_g: number | null; water_ml_target: number; weekly_workout_target: number; source: Goals['source']; updated_at: number;
}
const toGoals = (r: GoalsRow): Goals => ({
  goalType: r.goal_type, targetWeightKg: r.target_weight_kg, kcalTarget: r.kcal_target, proteinG: r.protein_g, carbsG: r.carbs_g,
  fatG: r.fat_g, waterMlTarget: r.water_ml_target, weeklyWorkoutTarget: r.weekly_workout_target, source: r.source, updatedAt: r.updated_at,
});

export function createGoalsRepository(ctx: RepoContext): GoalsRepository {
  return {
    get: () => guard(async () => {
      const r = await ctx.db.first<GoalsRow>('SELECT * FROM goals WHERE id=1');
      return r ? toGoals(r) : null;
    }),
    async save(input) {
      const parsed = parseInput(goalsInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        await ctx.db.run(
          `INSERT INTO goals(id,goal_type,target_weight_kg,kcal_target,protein_g,carbs_g,fat_g,water_ml_target,weekly_workout_target,source,updated_at)
           VALUES (1,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET goal_type=excluded.goal_type, target_weight_kg=excluded.target_weight_kg, kcal_target=excluded.kcal_target,
             protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g, water_ml_target=excluded.water_ml_target,
             weekly_workout_target=excluded.weekly_workout_target, source=excluded.source, updated_at=excluded.updated_at`,
          [v.goalType, v.targetWeightKg ?? null, v.kcalTarget ?? null, v.proteinG ?? null, v.carbsG ?? null, v.fatG ?? null, v.waterMlTarget, v.weeklyWorkoutTarget, v.source, ctx.now()],
        );
        return toGoals((await ctx.db.first<GoalsRow>('SELECT * FROM goals WHERE id=1'))!);
      });
    },
  };
}
