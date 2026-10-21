import type { DailyTotals, Food, MealEntry } from '../../domain/models';
import type { NutritionRepository } from '../../domain/repositories';
import { err } from '../../domain/result';
import { isValidLocalDate as isValidDate } from '../../domain/dates';
import { foodInput, mealInput, mealPatch, parseInput } from '../../domain/schemas';
import { RepoContext, bit, fail, flag, guard, likePattern, notFound, round1 } from './base';

interface FoodRow {
  id: number; slug: string | null; source: 'seed' | 'user'; custom_name: string | null; brand: string | null; unit: Food['unit'];
  kcal_per_100: number; protein_per_100: number; carbs_per_100: number; fat_per_100: number; fiber_per_100: number | null;
  default_serving: number; is_favorite: number; is_archived: number; data_label: Food['dataLabel']; created_at: number;
}
const toFood = (r: FoodRow): Food => ({
  id: r.id, slug: r.slug, source: r.source, customName: r.custom_name, brand: r.brand, unit: r.unit, kcalPer100: r.kcal_per_100,
  proteinPer100: r.protein_per_100, carbsPer100: r.carbs_per_100, fatPer100: r.fat_per_100, fiberPer100: r.fiber_per_100,
  defaultServing: r.default_serving, isFavorite: flag(r.is_favorite), isArchived: flag(r.is_archived), dataLabel: r.data_label, createdAt: r.created_at,
});

interface MealRow {
  id: number; local_date: string; meal_type: MealEntry['mealType']; food_id: number | null; quick_label: string | null; amount: number;
  kcal: number; protein_g: number; carbs_g: number; fat_g: number; logged_at: number;
}
/** The per-entry limits of meal_entries (migration 004). Checked here so an oversized portion is a validation error, not a raw CHECK failure. */
const snapshotFits = (kcal: number, protein: number, carbs: number, fat: number) =>
  kcal <= 20_000 && protein <= 2000 && carbs <= 3000 && fat <= 2000;

const toMeal = (r: MealRow): MealEntry => ({
  id: r.id, localDate: r.local_date, mealType: r.meal_type, foodId: r.food_id, quickLabel: r.quick_label, amount: r.amount,
  kcal: r.kcal, proteinG: r.protein_g, carbsG: r.carbs_g, fatG: r.fat_g, loggedAt: r.logged_at,
});

export function createNutritionRepository(ctx: RepoContext): NutritionRepository {
  const loadFood = async (id: number) => {
    const r = await ctx.db.first<FoodRow>('SELECT * FROM foods WHERE id=?', [id]);
    return r ? toFood(r) : notFound('food');
  };
  const loadMeal = async (id: number) => {
    const r = await ctx.db.first<MealRow>('SELECT * FROM meal_entries WHERE id=?', [id]);
    return r ? toMeal(r) : notFound('meal');
  };

  return {
    listFoods: (filter = {}) => guard(async () => {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (!filter.includeArchived) where.push('is_archived=0');
      if (filter.favoritesOnly) where.push('is_favorite=1');
      if (filter.search?.trim()) {
        where.push("(custom_name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\' OR brand LIKE ? ESCAPE '\\')");
        const p = likePattern(filter.search);
        params.push(p, p, p);
      }
      return (await ctx.db.all<FoodRow>(
        `SELECT * FROM foods ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY is_favorite DESC, COALESCE(custom_name, slug) COLLATE NOCASE, id`, params)).map(toFood);
    }),
    getFood: (id) => guard(() => loadFood(id)),

    async createFood(input) {
      const parsed = parseInput(foodInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const r = await ctx.db.run(
          `INSERT INTO foods(source,custom_name,brand,unit,kcal_per_100,protein_per_100,carbs_per_100,fat_per_100,fiber_per_100,default_serving,data_label,created_at)
           VALUES ('user',?,?,?,?,?,?,?,?,?,'user_entered',?)`,
          [v.name, v.brand || null, v.unit, v.kcalPer100, v.proteinPer100, v.carbsPer100, v.fatPer100, v.fiberPer100 ?? null, v.defaultServing, ctx.now()]);
        return loadFood(r.lastInsertRowId);
      });
    },
    async updateFood(id, input) {
      const parsed = parseInput(foodInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const f = await loadFood(id);
        if (f.source === 'seed') return fail({ kind: 'immutable', reason: 'seed_row' });
        await ctx.db.run(
          `UPDATE foods SET custom_name=?, brand=?, unit=?, kcal_per_100=?, protein_per_100=?, carbs_per_100=?, fat_per_100=?, fiber_per_100=?, default_serving=? WHERE id=?`,
          [v.name, v.brand || null, v.unit, v.kcalPer100, v.proteinPer100, v.carbsPer100, v.fatPer100, v.fiberPer100 ?? null, v.defaultServing, id]);
        return loadFood(id); // existing meal entries keep the values they were logged with
      });
    },
    setFoodFavorite: (id, favorite) => guard(async () => {
      await loadFood(id);
      await ctx.db.run('UPDATE foods SET is_favorite=? WHERE id=?', [bit(favorite), id]);
      return loadFood(id);
    }),
    setFoodArchived: (id, archived) => guard(async () => {
      await loadFood(id);
      await ctx.db.run('UPDATE foods SET is_archived=? WHERE id=?', [bit(archived), id]);
      return loadFood(id);
    }),

    async addMeal(input) {
      const parsed = parseInput(mealInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(() => ctx.db.transaction(async (tx) => {
        const now = ctx.now();
        const date = v.localDate ?? ctx.localDate(now);
        if (v.kind === 'food') {
          const f = await tx.first<FoodRow>('SELECT * FROM foods WHERE id=?', [v.foodId]);
          if (!f) return notFound('food');
          const k = v.amount / 100;
          const snap = [round1(f.kcal_per_100 * k), round1(f.protein_per_100 * k), round1(f.carbs_per_100 * k), round1(f.fat_per_100 * k)] as const;
          if (!snapshotFits(...snap)) return fail({ kind: 'validation', issues: { amount: 'validation.outOfRange' } });
          // values are copied into the entry so later edits to the food never rewrite history
          const r = await tx.run(
            `INSERT INTO meal_entries(local_date,meal_type,food_id,amount,kcal,protein_g,carbs_g,fat_g,logged_at) VALUES (?,?,?,?,?,?,?,?,?)`,
            [date, v.mealType, v.foodId, v.amount, ...snap, now]);
          return toMeal((await tx.first<MealRow>('SELECT * FROM meal_entries WHERE id=?', [r.lastInsertRowId]))!);
        }
        // quick entry: one portion of an unnamed item with user-supplied numbers
        const r = await tx.run(
          `INSERT INTO meal_entries(local_date,meal_type,quick_label,amount,kcal,protein_g,carbs_g,fat_g,logged_at) VALUES (?,?,?,1,?,?,?,?,?)`,
          [date, v.mealType, v.quickLabel, v.kcal, v.proteinG, v.carbsG, v.fatG, now]);
        return toMeal((await tx.first<MealRow>('SELECT * FROM meal_entries WHERE id=?', [r.lastInsertRowId]))!);
      }));
    },
    async updateMeal(id, patch) {
      const parsed = parseInput(mealPatch, patch);
      if (!parsed.ok) return err(parsed.error);
      const p = parsed.value;
      return guard(() => ctx.db.transaction(async (tx) => {
        const r = await tx.first<MealRow>('SELECT * FROM meal_entries WHERE id=?', [id]);
        if (!r) return notFound('meal');
        let { amount, kcal, protein_g, carbs_g, fat_g } = r;
        if (p.amount !== undefined) {
          if (r.food_id === null) return fail({ kind: 'validation', issues: { amount: 'validation.invalid' } }); // quick entries have no quantity
          const scale = p.amount / r.amount; // scale the stored snapshot; the food's current values are not consulted
          amount = p.amount; kcal = round1(r.kcal * scale); protein_g = round1(r.protein_g * scale); carbs_g = round1(r.carbs_g * scale); fat_g = round1(r.fat_g * scale);
          if (!snapshotFits(kcal, protein_g, carbs_g, fat_g)) return fail({ kind: 'validation', issues: { amount: 'validation.outOfRange' } });
        }
        await tx.run('UPDATE meal_entries SET meal_type=?, amount=?, kcal=?, protein_g=?, carbs_g=?, fat_g=? WHERE id=?', [p.mealType ?? r.meal_type, amount, kcal, protein_g, carbs_g, fat_g, id]);
        return toMeal((await tx.first<MealRow>('SELECT * FROM meal_entries WHERE id=?', [id]))!);
      }));
    },
    deleteMeal: (id) => guard(async () => {
      await loadMeal(id);
      await ctx.db.run('DELETE FROM meal_entries WHERE id=?', [id]);
    }),
    async listMeals(localDate) {
      if (!isValidDate(localDate)) return err({ kind: 'validation', issues: { localDate: 'validation.invalidDate' } });
      return guard(async () => (await ctx.db.all<MealRow>('SELECT * FROM meal_entries WHERE local_date=? ORDER BY logged_at, id', [localDate])).map(toMeal));
    },
    async dailyTotals(localDate) {
      if (!isValidDate(localDate)) return err({ kind: 'validation', issues: { localDate: 'validation.invalidDate' } });
      return guard(async (): Promise<DailyTotals | null> => {
        const r = await ctx.db.first<{ c: number; kcal: number | null; p: number | null; cb: number | null; f: number | null }>(
          'SELECT count(*) c, SUM(kcal) kcal, SUM(protein_g) p, SUM(carbs_g) cb, SUM(fat_g) f FROM meal_entries WHERE local_date=?', [localDate]);
        if (!r || Number(r.c) === 0) return null; // nothing logged: no totals, never zeros that look like data
        return { entryCount: Number(r.c), kcal: round1(r.kcal ?? 0), proteinG: round1(r.p ?? 0), carbsG: round1(r.cb ?? 0), fatG: round1(r.f ?? 0) };
      });
    },
  };
}
