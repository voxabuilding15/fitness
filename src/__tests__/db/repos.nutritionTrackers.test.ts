import { createRepoEnv, errorOf, H, T0, unwrap, type RepoEnv } from '../../db/testing/repoEnv';

let env: RepoEnv;
beforeEach(async () => { env = await createRepoEnv(); });
const rice = { name: 'Rice', unit: 'g', kcalPer100: 130, proteinPer100: 2.7, carbsPer100: 28, fatPer100: 0.3, defaultServing: 150 } as const;
const seedFood = (slug = 'oats') => env.db.run(
  `INSERT INTO foods(source,slug,unit,kcal_per_100,protein_per_100,carbs_per_100,fat_per_100,default_serving,data_label,created_at) VALUES ('seed',?,'g',380,13,60,7,40,'approximate',?)`, [slug, T0]);

describe('foods', () => {
  it('creates user foods labelled as user-entered; validates', async () => {
    const f = unwrap(await env.repos.nutrition.createFood({ ...rice, brand: 'Acme', fiberPer100: 0.4 }));
    expect(f).toMatchObject({ source: 'user', slug: null, customName: 'Rice', brand: 'Acme', dataLabel: 'user_entered', isFavorite: false, isArchived: false, createdAt: T0 });
    expect(errorOf(await env.repos.nutrition.createFood({ ...rice, kcalPer100: 2000 }))).toMatchObject({ kind: 'validation', issues: { kcalPer100: 'validation.outOfRange' } });
    expect(errorOf(await env.repos.nutrition.createFood({ ...rice, proteinPer100: 60, carbsPer100: 50 })).kind).toBe('validation');
  });
  it('list: favourites first, search by name or brand (wildcards escaped), archived hidden', async () => {
    await seedFood('oats');
    const a = unwrap(await env.repos.nutrition.createFood(rice));
    const b = unwrap(await env.repos.nutrition.createFood({ ...rice, name: 'Bread', brand: 'Baker_Co' }));
    const names = async (f?: any) => (unwrap(await env.repos.nutrition.listFoods(f)) as any[]).map((x) => x.customName ?? x.slug);
    expect(await names()).toEqual(['Bread', 'oats', 'Rice']);
    unwrap(await env.repos.nutrition.setFoodFavorite(b.id, true));
    unwrap(await env.repos.nutrition.setFoodFavorite(a.id, true));
    expect(await names()).toEqual(['Bread', 'Rice', 'oats']);
    expect(await names({ favoritesOnly: true })).toEqual(['Bread', 'Rice']);
    expect(await names({ search: 'baker_' })).toEqual(['Bread']);
    expect(await names({ search: '%' })).toEqual([]);
    unwrap(await env.repos.nutrition.setFoodArchived(a.id, true));
    expect(await names()).not.toContain('Rice');
    expect(await names({ includeArchived: true })).toContain('Rice');
  });
  it('built-in foods cannot be edited but can be favourited/archived; user foods can be edited', async () => {
    await seedFood('oats');
    expect(errorOf(await env.repos.nutrition.updateFood(1, rice))).toEqual({ kind: 'immutable', reason: 'seed_row' });
    expect(unwrap(await env.repos.nutrition.setFoodFavorite(1, true)).isFavorite).toBe(true);
    const f = unwrap(await env.repos.nutrition.createFood(rice));
    expect(unwrap(await env.repos.nutrition.updateFood(f.id, { ...rice, name: 'Brown rice', kcalPer100: 120 }))).toMatchObject({ customName: 'Brown rice', kcalPer100: 120 });
    expect(errorOf(await env.repos.nutrition.getFood(999))).toEqual({ kind: 'not_found', entity: 'food' });
    expect(errorOf(await env.repos.nutrition.updateFood(999, rice)).kind).toBe('not_found');
  });
});

describe('meals', () => {
  it('logs a food: the nutrient snapshot is computed from the amount and stored with the entry', async () => {
    const f = unwrap(await env.repos.nutrition.createFood(rice));
    const m = unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 200, mealType: 'lunch' }));
    expect(m).toMatchObject({ localDate: '2026-10-21', mealType: 'lunch', foodId: f.id, quickLabel: null, amount: 200, kcal: 260, proteinG: 5.4, carbsG: 56, fatG: 0.6, loggedAt: T0 });
  });
  it('editing a food later never rewrites past meals, but new meals use the new values', async () => {
    const f = unwrap(await env.repos.nutrition.createFood(rice));
    const before = unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 100, mealType: 'lunch' }));
    unwrap(await env.repos.nutrition.updateFood(f.id, { ...rice, kcalPer100: 500 }));
    expect(unwrap(await env.repos.nutrition.listMeals('2026-10-21'))[0]).toEqual(before);
    expect(unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 100, mealType: 'dinner' })).kcal).toBe(500);
  });
  it('quick entries take the user\'s numbers as-is (one portion)', async () => {
    const m = unwrap(await env.repos.nutrition.addMeal({ kind: 'quick', quickLabel: 'Restaurant lunch', kcal: 850, proteinG: 40, mealType: 'lunch', localDate: '2026-10-20' }));
    expect(m).toMatchObject({ foodId: null, quickLabel: 'Restaurant lunch', amount: 1, kcal: 850, proteinG: 40, carbsG: 0, fatG: 0, localDate: '2026-10-20' });
  });
  it('validates and reports unknown foods / bad dates', async () => {
    expect(errorOf(await env.repos.nutrition.addMeal({ kind: 'food', foodId: 999, amount: 100, mealType: 'lunch' }))).toEqual({ kind: 'not_found', entity: 'food' });
    expect(errorOf(await env.repos.nutrition.addMeal({ kind: 'food', foodId: 1, amount: 0, mealType: 'lunch' })).kind).toBe('validation');
    expect(errorOf(await env.repos.nutrition.addMeal({ kind: 'quick', quickLabel: 'x', kcal: 1, mealType: 'snack', localDate: '2026-02-30' }))).toMatchObject({ issues: { localDate: 'validation.invalidDate' } });
    expect(errorOf(await env.repos.nutrition.listMeals('nope'))).toMatchObject({ kind: 'validation' });
    expect(errorOf(await env.repos.nutrition.dailyTotals('2026-13-01'))).toMatchObject({ kind: 'validation' });
  });
  it('updateMeal scales the stored snapshot (not the food\'s current values); quick entries have no quantity', async () => {
    const f = unwrap(await env.repos.nutrition.createFood(rice));
    const m = unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 100, mealType: 'lunch' }));
    unwrap(await env.repos.nutrition.updateFood(f.id, { ...rice, kcalPer100: 500 }));
    expect(unwrap(await env.repos.nutrition.updateMeal(m.id, { amount: 200, mealType: 'dinner' }))).toMatchObject({ amount: 200, kcal: 260, mealType: 'dinner' });
    const q = unwrap(await env.repos.nutrition.addMeal({ kind: 'quick', quickLabel: 'Q', kcal: 100, mealType: 'snack' }));
    expect(errorOf(await env.repos.nutrition.updateMeal(q.id, { amount: 3 }))).toMatchObject({ kind: 'validation', issues: { amount: 'validation.invalid' } });
    expect(unwrap(await env.repos.nutrition.updateMeal(q.id, { mealType: 'dinner' })).mealType).toBe('dinner');
    expect(errorOf(await env.repos.nutrition.updateMeal(999, { amount: 1 })).kind).toBe('not_found');
  });
  it('lists a day in logging order; deletes', async () => {
    const f = unwrap(await env.repos.nutrition.createFood(rice));
    const a = unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 100, mealType: 'breakfast' }));
    env.clock.advance(H);
    const b = unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 50, mealType: 'lunch' }));
    expect(unwrap(await env.repos.nutrition.listMeals('2026-10-21')).map((x) => x.id)).toEqual([a.id, b.id]);
    unwrap(await env.repos.nutrition.deleteMeal(a.id));
    expect(unwrap(await env.repos.nutrition.listMeals('2026-10-21')).map((x) => x.id)).toEqual([b.id]);
    expect(errorOf(await env.repos.nutrition.deleteMeal(a.id)).kind).toBe('not_found');
  });
  it('dailyTotals is null when nothing was logged, and sums only that day when something was', async () => {
    expect(unwrap(await env.repos.nutrition.dailyTotals('2026-10-21'))).toBeNull(); // not zeros
    const f = unwrap(await env.repos.nutrition.createFood(rice));
    unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 200, mealType: 'lunch' }));
    unwrap(await env.repos.nutrition.addMeal({ kind: 'quick', quickLabel: 'Q', kcal: 140, proteinG: 4, carbsG: 4, fatG: 4, mealType: 'snack' }));
    unwrap(await env.repos.nutrition.addMeal({ kind: 'quick', quickLabel: 'Other day', kcal: 999, mealType: 'snack', localDate: '2026-10-22' }));
    expect(unwrap(await env.repos.nutrition.dailyTotals('2026-10-21'))).toEqual({ entryCount: 2, kcal: 400, proteinG: 9.4, carbsG: 60, fatG: 4.6 });
    expect(unwrap(await env.repos.nutrition.dailyTotals('2026-10-23'))).toBeNull();
  });
});

describe('water', () => {
  it('reports nothing (null / empty) before anything is logged', async () => {
    expect(unwrap(await env.repos.water.day('2026-10-21'))).toBeNull();
    expect(unwrap(await env.repos.water.listDay('2026-10-21'))).toEqual([]);
    expect(unwrap(await env.repos.water.undoLast())).toBeNull();
  });
  it('adds, totals the day, and undoes the most recent entry (repeatedly)', async () => {
    unwrap(await env.repos.water.add({ amountMl: 250 }));
    env.clock.advance(H);
    unwrap(await env.repos.water.add({ amountMl: 500 }));
    unwrap(await env.repos.water.add({ amountMl: 300, localDate: '2026-10-20' }));
    expect(unwrap(await env.repos.water.day('2026-10-21'))).toEqual({ entryCount: 2, totalMl: 750 });
    expect(unwrap(await env.repos.water.undoLast())).toMatchObject({ amountMl: 500 });
    expect(unwrap(await env.repos.water.day('2026-10-21'))).toEqual({ entryCount: 1, totalMl: 250 });
    expect(unwrap(await env.repos.water.undoLast('2026-10-20'))).toMatchObject({ amountMl: 300 });
    expect(unwrap(await env.repos.water.undoLast())).toMatchObject({ amountMl: 250 });
    expect(unwrap(await env.repos.water.day('2026-10-21'))).toBeNull(); // back to "no data"
  });
  it('same-instant entries undo in reverse insertion order', async () => {
    unwrap(await env.repos.water.add({ amountMl: 100 }));
    unwrap(await env.repos.water.add({ amountMl: 200 }));
    expect(unwrap(await env.repos.water.undoLast())).toMatchObject({ amountMl: 200 });
  });
  it('validates amounts and dates; uses the device-local day', async () => {
    expect(errorOf(await env.repos.water.add({ amountMl: 0 }))).toMatchObject({ kind: 'validation' });
    expect(errorOf(await env.repos.water.add({ amountMl: 250, localDate: '2026-13-01' }))).toMatchObject({ kind: 'validation' });
    expect(errorOf(await env.repos.water.day('garbage')).kind).toBe('validation');
    expect(errorOf(await env.repos.water.listDay('garbage')).kind).toBe('validation');
    expect(errorOf(await env.repos.water.undoLast('garbage')).kind).toBe('validation');
    const east = await createRepoEnv(180); // UTC+3
    east.clock.set(Date.UTC(2026, 9, 21, 22, 0));
    expect(unwrap(await east.repos.water.add({ amountMl: 250 })).localDate).toBe('2026-10-22');
  });
});

describe('weight', () => {
  it('is empty before anything is saved (no placeholder weight)', async () => {
    expect(unwrap(await env.repos.weight.latest())).toBeNull();
    expect(unwrap(await env.repos.weight.list({ from: '2026-01-01', to: '2026-12-31' }))).toEqual([]);
  });
  it('saves one entry per day (re-saving replaces it), rounds to 0.1 kg, finds the latest', async () => {
    expect(unwrap(await env.repos.weight.save({ weightKg: 72.46 }))).toMatchObject({ localDate: '2026-10-21', weightKg: 72.5, source: 'manual' });
    env.clock.advance(H);
    expect(unwrap(await env.repos.weight.save({ weightKg: 72.0, note: 'morning' }))).toMatchObject({ weightKg: 72, note: 'morning', loggedAt: T0 + H });
    unwrap(await env.repos.weight.save({ weightKg: 71.2, localDate: '2026-10-19' }));
    expect(unwrap(await env.repos.weight.list({ from: '2026-10-01', to: '2026-10-31' })).map((w) => [w.localDate, w.weightKg])).toEqual([['2026-10-19', 71.2], ['2026-10-21', 72]]);
    expect(unwrap(await env.repos.weight.latest())).toMatchObject({ localDate: '2026-10-21', weightKg: 72 });
    expect(Number((await env.db.first<{ c: number }>('SELECT count(*) c FROM weight_entries'))!.c)).toBe(2);
  });
  it('removes an entry; validates', async () => {
    unwrap(await env.repos.weight.save({ weightKg: 70 }));
    unwrap(await env.repos.weight.remove('2026-10-21'));
    expect(errorOf(await env.repos.weight.remove('2026-10-21'))).toEqual({ kind: 'not_found', entity: 'weight_entry' });
    expect(errorOf(await env.repos.weight.save({ weightKg: 10 }))).toMatchObject({ kind: 'validation', issues: { weightKg: 'validation.outOfRange' } });
    expect(errorOf(await env.repos.weight.save({ weightKg: 70, localDate: '2027-02-29' })).kind).toBe('validation');
    expect(errorOf(await env.repos.weight.list({ from: '2026-10-31', to: '2026-10-01' })).kind).toBe('validation');
    expect(errorOf(await env.repos.weight.remove('x')).kind).toBe('validation');
  });
});

describe('habits', () => {
  it('creates boolean and count habits; list hides archived by default', async () => {
    const walk = unwrap(await env.repos.habits.create({ name: 'Walk', kind: 'boolean' }));
    const water = unwrap(await env.repos.habits.create({ name: 'Glasses', kind: 'count', targetCount: 8, scheduleDays: 62 }));
    expect(walk).toMatchObject({ source: 'user', kind: 'boolean', targetCount: null, scheduleDays: 127, isArchived: false });
    expect(water).toMatchObject({ targetCount: 8, scheduleDays: 62 });
    unwrap(await env.repos.habits.setArchived(walk.id, true));
    expect(unwrap(await env.repos.habits.list()).map((h) => h.customName)).toEqual(['Glasses']);
    expect(unwrap(await env.repos.habits.list({ includeArchived: true }))).toHaveLength(2);
    expect(errorOf(await env.repos.habits.create({ name: 'x', kind: 'count' })).kind).toBe('validation');
    expect(errorOf(await env.repos.habits.setArchived(999, true)).kind).toBe('not_found');
  });
  it('one log per habit per day (re-logging replaces it); value rules by kind; archived habits are frozen', async () => {
    const walk = unwrap(await env.repos.habits.create({ name: 'Walk', kind: 'boolean' }));
    const water = unwrap(await env.repos.habits.create({ name: 'Glasses', kind: 'count', targetCount: 8 }));
    unwrap(await env.repos.habits.setLog({ habitId: water.id, localDate: '2026-10-21', value: 3 }));
    expect(unwrap(await env.repos.habits.setLog({ habitId: water.id, localDate: '2026-10-21', value: 5 })).value).toBe(5);
    expect(Number((await env.db.first<{ c: number }>('SELECT count(*) c FROM habit_logs'))!.c)).toBe(1);
    expect(errorOf(await env.repos.habits.setLog({ habitId: walk.id, localDate: '2026-10-21', value: 2 }))).toMatchObject({ kind: 'validation', issues: { value: 'validation.outOfRange' } });
    expect(errorOf(await env.repos.habits.setLog({ habitId: 999, localDate: '2026-10-21', value: 1 })).kind).toBe('not_found');
    expect(errorOf(await env.repos.habits.setLog({ habitId: walk.id, localDate: '2026-02-30', value: 1 })).kind).toBe('validation');
    unwrap(await env.repos.habits.setArchived(walk.id, true));
    expect(errorOf(await env.repos.habits.setLog({ habitId: walk.id, localDate: '2026-10-21', value: 1 }))).toEqual({ kind: 'immutable', reason: 'archived_habit' });
  });
  it('lists logs by range and habit; removes a log; empty is empty', async () => {
    const a = unwrap(await env.repos.habits.create({ name: 'A', kind: 'boolean' }));
    const b = unwrap(await env.repos.habits.create({ name: 'B', kind: 'boolean' }));
    const range = { from: '2026-10-01', to: '2026-10-31' };
    expect(unwrap(await env.repos.habits.listLogs(range))).toEqual([]);
    for (const [h, d] of [[a, '2026-10-20'], [a, '2026-10-21'], [b, '2026-10-21']] as const) unwrap(await env.repos.habits.setLog({ habitId: h.id, localDate: d, value: 1 }));
    expect(unwrap(await env.repos.habits.listLogs(range)).map((l) => [l.habitId, l.localDate])).toEqual([[a.id, '2026-10-20'], [a.id, '2026-10-21'], [b.id, '2026-10-21']]);
    expect(unwrap(await env.repos.habits.listLogs(range, b.id))).toHaveLength(1);
    unwrap(await env.repos.habits.removeLog(a.id, '2026-10-20'));
    expect(errorOf(await env.repos.habits.removeLog(a.id, '2026-10-20'))).toEqual({ kind: 'not_found', entity: 'habit_log' });
    expect(errorOf(await env.repos.habits.removeLog(a.id, 'x')).kind).toBe('validation');
    expect(errorOf(await env.repos.habits.listLogs({ from: 'a', to: 'b' })).kind).toBe('validation');
  });
});

describe('meal snapshot limits (E10)', () => {
  const dense = { name: 'Oil', unit: 'g', kcalPer100: 900, proteinPer100: 0, carbsPer100: 0, fatPer100: 100, defaultServing: 15 } as const;
  const OUT = { kind: 'validation', issues: { amount: 'validation.outOfRange' } };
  it('a portion whose snapshot would exceed the per-entry limits is a validation error, not a raw CHECK failure', async () => {
    const f = unwrap(await env.repos.nutrition.createFood(dense));
    // 5000 g x 900 kcal/100 g = 45,000 kcal > 20,000
    expect(errorOf(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 5000, mealType: 'lunch' }))).toEqual(OUT);
    expect(await env.db.first('SELECT count(*) c FROM meal_entries')).toEqual({ c: 0 });
  });
  it('boundary: exactly at the fat limit (2,000 g) is accepted, just above is rejected', async () => {
    const f = unwrap(await env.repos.nutrition.createFood(dense));
    expect(unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 2000, mealType: 'lunch' }))).toMatchObject({ kcal: 18000, fatG: 2000 });
    expect(errorOf(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 2001, mealType: 'lunch' }))).toEqual(OUT);
  });
  it('editing an amount past the limits is rejected and leaves the entry unchanged', async () => {
    const f = unwrap(await env.repos.nutrition.createFood(dense));
    const m = unwrap(await env.repos.nutrition.addMeal({ kind: 'food', foodId: f.id, amount: 100, mealType: 'lunch' }));
    expect(errorOf(await env.repos.nutrition.updateMeal(m.id, { amount: 5000 }))).toEqual(OUT);
    expect(unwrap(await env.repos.nutrition.updateMeal(m.id, { mealType: 'dinner' }))).toMatchObject({ amount: 100, kcal: 900 });
  });
});
