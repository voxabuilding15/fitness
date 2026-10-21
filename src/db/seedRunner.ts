import { z } from 'zod';
import { DbError } from '../domain/errors';
import { err, ok, type Result } from '../domain/result';
import { systemClock, type Clock } from '../domain/clock';
import { parseInput, int, num } from '../domain/schemas/common';
import { categorySchema, equipmentSchema, foodUnitSchema, habitKindSchema, muscleSchema, trackingTypeSchema } from '../domain/schemas/enums';
import { mapDbError } from './mapDbError';
import type { Db } from './sqlDatabase';

const slug = z.string().regex(/^[a-z0-9_]{2,60}$/, { message: 'validation.invalid' });

const seedExercise = z.strictObject({
  slug, category: categorySchema, primaryMuscle: muscleSchema, secondaryMuscles: z.array(muscleSchema).max(5).default([]),
  equipment: equipmentSchema, trackingType: trackingTypeSchema, metValue: num(1, 25).optional(),
});
const seedFood = z.strictObject({
  slug, unit: foodUnitSchema, kcalPer100: num(0, 950), proteinPer100: num(0, 100), carbsPer100: num(0, 100), fatPer100: num(0, 100),
  fiberPer100: num(0, 100).optional(), defaultServing: num(0.1, 5000),
});
const seedHabit = z.strictObject({ slug, kind: habitKindSchema, targetCount: int(1, 1000).optional(), scheduleDays: int(1, 127).default(127) });

/** Built-in content. Names are NOT stored: display names come from the translation files, keyed by slug. */
export const seedPackSchema = z.strictObject({
  version: int(1, 1_000_000),
  exercises: z.array(seedExercise).default([]),
  foods: z.array(seedFood).default([]),
  habits: z.array(seedHabit).default([]),
});
export type SeedPack = z.input<typeof seedPackSchema>;

export const SEED_VERSION_KEY = 'seed_version';

/**
 * Applies built-in content idempotently. A pack is applied only if its version is newer than the stored one, in a
 * single transaction, by slug: existing rows keep their id, archived flag, favourites and history links.
 * Phase 1 ships NO pack (no exercise or food content yet); this is the mechanism for later phases.
 */
export async function runSeed(db: Db, pack: SeedPack, clock: Clock = systemClock): Promise<Result<{ applied: boolean; version: number }>> {
  const parsed = parseInput(seedPackSchema, pack);
  if (!parsed.ok) return err(parsed.error);
  const p = parsed.value;
  try {
    const row = await db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [SEED_VERSION_KEY]);
    const current = row ? Number(row.value) || 0 : 0;
    if (p.version <= current) return ok({ applied: false, version: current });
    const now = clock.now();
    await db.transaction(async (tx) => {
      for (const e of p.exercises) {
        await tx.run(
          `INSERT INTO exercises(source,slug,category,primary_muscle,secondary_muscles,equipment,tracking_type,met_value,created_at) VALUES ('seed',?,?,?,?,?,?,?,?)
           ON CONFLICT(slug) DO UPDATE SET category=excluded.category, primary_muscle=excluded.primary_muscle, secondary_muscles=excluded.secondary_muscles,
             equipment=excluded.equipment, tracking_type=excluded.tracking_type, met_value=excluded.met_value`,
          [e.slug, e.category, e.primaryMuscle, JSON.stringify(e.secondaryMuscles), e.equipment, e.trackingType, e.metValue ?? null, now]);
      }
      for (const f of p.foods) {
        await tx.run(
          `INSERT INTO foods(source,slug,unit,kcal_per_100,protein_per_100,carbs_per_100,fat_per_100,fiber_per_100,default_serving,data_label,created_at) VALUES ('seed',?,?,?,?,?,?,?,?,'approximate',?)
           ON CONFLICT(slug) DO UPDATE SET unit=excluded.unit, kcal_per_100=excluded.kcal_per_100, protein_per_100=excluded.protein_per_100,
             carbs_per_100=excluded.carbs_per_100, fat_per_100=excluded.fat_per_100, fiber_per_100=excluded.fiber_per_100, default_serving=excluded.default_serving`,
          [f.slug, f.unit, f.kcalPer100, f.proteinPer100, f.carbsPer100, f.fatPer100, f.fiberPer100 ?? null, f.defaultServing, now]);
      }
      for (const h of p.habits) {
        await tx.run(
          `INSERT INTO habits(source,slug,kind,target_count,schedule_days,created_at) VALUES ('seed',?,?,?,?,?)
           ON CONFLICT(slug) DO UPDATE SET kind=excluded.kind, target_count=excluded.target_count, schedule_days=excluded.schedule_days`,
          [h.slug, h.kind, h.targetCount ?? null, h.scheduleDays, now]);
      }
      await tx.run('INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [SEED_VERSION_KEY, String(p.version)]);
    });
    return ok({ applied: true, version: p.version });
  } catch (e) {
    return err(e instanceof DbError ? e.appError : mapDbError(e));
  }
}
