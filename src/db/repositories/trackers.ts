import type { Habit, HabitLog, WaterDay, WaterEntry, WeightEntry } from '../../domain/models';
import type { HabitRepository, WaterRepository, WeightRepository } from '../../domain/repositories';
import { err } from '../../domain/result';
import { dateRangeInput, habitInput, habitLogInput, parseInput, waterInput, weightInput } from '../../domain/schemas';
import { isValidLocalDate } from '../../domain/dates';
import { RepoContext, bit, fail, flag, guard, notFound, round1 } from './base';

const badDate = () => err({ kind: 'validation' as const, issues: { localDate: 'validation.invalidDate' } });

// ---- water ----
interface WaterRow { id: number; local_date: string; amount_ml: number; logged_at: number }
const toWater = (r: WaterRow): WaterEntry => ({ id: r.id, localDate: r.local_date, amountMl: r.amount_ml, loggedAt: r.logged_at });

export function createWaterRepository(ctx: RepoContext): WaterRepository {
  return {
    async add(input) {
      const parsed = parseInput(waterInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const now = ctx.now();
        const r = await ctx.db.run('INSERT INTO water_entries(local_date,amount_ml,logged_at) VALUES (?,?,?)', [v.localDate ?? ctx.localDate(now), v.amountMl, now]);
        return toWater((await ctx.db.first<WaterRow>('SELECT * FROM water_entries WHERE id=?', [r.lastInsertRowId]))!);
      });
    },
    async undoLast(localDate) {
      const date = localDate ?? ctx.today();
      if (!isValidLocalDate(date)) return badDate();
      return guard(() => ctx.db.transaction(async (tx) => {
        const r = await tx.first<WaterRow>('SELECT * FROM water_entries WHERE local_date=? ORDER BY logged_at DESC, id DESC LIMIT 1', [date]);
        if (!r) return null;
        await tx.run('DELETE FROM water_entries WHERE id=?', [r.id]);
        return toWater(r);
      }));
    },
    async listDay(localDate) {
      if (!isValidLocalDate(localDate)) return badDate();
      return guard(async () => (await ctx.db.all<WaterRow>('SELECT * FROM water_entries WHERE local_date=? ORDER BY logged_at, id', [localDate])).map(toWater));
    },
    async day(localDate) {
      if (!isValidLocalDate(localDate)) return badDate();
      return guard(async (): Promise<WaterDay | null> => {
        const r = await ctx.db.first<{ c: number; t: number | null }>('SELECT count(*) c, SUM(amount_ml) t FROM water_entries WHERE local_date=?', [localDate]);
        return !r || Number(r.c) === 0 ? null : { entryCount: Number(r.c), totalMl: Number(r.t) };
      });
    },
  };
}

// ---- weight ----
interface WeightRow { id: number; local_date: string; weight_kg: number; note: string | null; source: WeightEntry['source']; logged_at: number }
const toWeight = (r: WeightRow): WeightEntry => ({ id: r.id, localDate: r.local_date, weightKg: r.weight_kg, note: r.note, source: r.source, loggedAt: r.logged_at });

export function createWeightRepository(ctx: RepoContext): WeightRepository {
  return {
    async save(input) {
      const parsed = parseInput(weightInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const now = ctx.now();
        const date = v.localDate ?? ctx.localDate(now);
        await ctx.db.run(
          `INSERT INTO weight_entries(local_date,weight_kg,note,source,logged_at) VALUES (?,?,?,'manual',?)
           ON CONFLICT(local_date) DO UPDATE SET weight_kg=excluded.weight_kg, note=excluded.note, source='manual', logged_at=excluded.logged_at`,
          [date, round1(v.weightKg), v.note || null, now]);
        return toWeight((await ctx.db.first<WeightRow>('SELECT * FROM weight_entries WHERE local_date=?', [date]))!);
      });
    },
    async remove(localDate) {
      if (!isValidLocalDate(localDate)) return badDate();
      return guard(async () => {
        const r = await ctx.db.run('DELETE FROM weight_entries WHERE local_date=?', [localDate]);
        if (r.changes === 0) notFound('weight_entry');
      });
    },
    async list(range) {
      const r = parseInput(dateRangeInput, range);
      if (!r.ok) return err(r.error);
      return guard(async () => (await ctx.db.all<WeightRow>('SELECT * FROM weight_entries WHERE local_date BETWEEN ? AND ? ORDER BY local_date', [r.value.from, r.value.to])).map(toWeight));
    },
    latest: () => guard(async () => {
      const r = await ctx.db.first<WeightRow>('SELECT * FROM weight_entries ORDER BY local_date DESC LIMIT 1');
      return r ? toWeight(r) : null;
    }),
  };
}

// ---- habits ----
interface HabitRow {
  id: number; slug: string | null; source: 'seed' | 'user'; custom_name: string | null; kind: Habit['kind']; target_count: number | null;
  schedule_days: number; is_archived: number; created_at: number;
}
const toHabit = (r: HabitRow): Habit => ({
  id: r.id, slug: r.slug, source: r.source, customName: r.custom_name, kind: r.kind, targetCount: r.target_count,
  scheduleDays: r.schedule_days, isArchived: flag(r.is_archived), createdAt: r.created_at,
});
interface LogRow { id: number; habit_id: number; local_date: string; value: number }
const toLog = (r: LogRow): HabitLog => ({ id: r.id, habitId: r.habit_id, localDate: r.local_date, value: r.value });

export function createHabitRepository(ctx: RepoContext): HabitRepository {
  const loadHabit = async (id: number) => {
    const r = await ctx.db.first<HabitRow>('SELECT * FROM habits WHERE id=?', [id]);
    return r ? toHabit(r) : notFound('habit');
  };
  return {
    async create(input) {
      const parsed = parseInput(habitInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const r = await ctx.db.run("INSERT INTO habits(source,custom_name,kind,target_count,schedule_days,created_at) VALUES ('user',?,?,?,?,?)",
          [v.name, v.kind, v.targetCount ?? null, v.scheduleDays, ctx.now()]);
        return loadHabit(r.lastInsertRowId);
      });
    },
    list: (opts = {}) => guard(async () => (await ctx.db.all<HabitRow>(
      `SELECT * FROM habits ${opts.includeArchived ? '' : 'WHERE is_archived=0'} ORDER BY created_at, id`)).map(toHabit)),
    setArchived: (id, archived) => guard(async () => {
      await loadHabit(id);
      await ctx.db.run('UPDATE habits SET is_archived=? WHERE id=?', [bit(archived), id]);
      return loadHabit(id);
    }),
    async setLog(input) {
      const parsed = parseInput(habitLogInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(async () => {
        const h = await loadHabit(v.habitId);
        if (h.isArchived) return fail({ kind: 'immutable', reason: 'archived_habit' });
        if (h.kind === 'boolean' && v.value > 1) return fail({ kind: 'validation', issues: { value: 'validation.outOfRange' } });
        await ctx.db.run(
          'INSERT INTO habit_logs(habit_id,local_date,value) VALUES (?,?,?) ON CONFLICT(habit_id,local_date) DO UPDATE SET value=excluded.value',
          [v.habitId, v.localDate, v.value]);
        return toLog((await ctx.db.first<LogRow>('SELECT * FROM habit_logs WHERE habit_id=? AND local_date=?', [v.habitId, v.localDate]))!);
      });
    },
    async removeLog(habitId, localDate) {
      if (!isValidLocalDate(localDate)) return badDate();
      return guard(async () => {
        const r = await ctx.db.run('DELETE FROM habit_logs WHERE habit_id=? AND local_date=?', [habitId, localDate]);
        if (r.changes === 0) notFound('habit_log');
      });
    },
    async listLogs(range, habitId) {
      const r = parseInput(dateRangeInput, range);
      if (!r.ok) return err(r.error);
      return guard(async () => (await ctx.db.all<LogRow>(
        `SELECT * FROM habit_logs WHERE local_date BETWEEN ? AND ? ${habitId ? 'AND habit_id=?' : ''} ORDER BY local_date, habit_id`,
        habitId ? [r.value.from, r.value.to, habitId] : [r.value.from, r.value.to])).map(toLog));
    },
  };
}
