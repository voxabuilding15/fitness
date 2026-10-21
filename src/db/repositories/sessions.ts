import { DbError } from '../../domain/errors';
import type { SessionExercise, SessionSet, WorkoutSession, WorkoutSessionDetail } from '../../domain/models';
import type { SessionRepository } from '../../domain/repositories';
import { err } from '../../domain/result';
import {
  completeSessionInput, dateRangeInput, parseInput, sessionPatch, sessionStartInput, setInput, setPatch,
} from '../../domain/schemas';
import { canTransition, isEditable, type SessionStatus } from '../../domain/sessionLifecycle';
import type { SqlExecutor } from '../sqlDatabase';
import { RepoContext, bit, fail, flag, guard, notFound } from './base';

interface SessionRow {
  id: number; template_id: number | null; name: string; status: SessionStatus; started_at: number; ended_at: number | null;
  discarded_at: number | null; local_date: string; rpe: number | null; est_kcal: number | null; est_method: 'met' | null;
}
interface SessionExerciseRow {
  id: number; session_id: number; exercise_id: number; position: number; exercise_name: string | null; plan_sets: number | null;
  plan_reps_min: number | null; plan_reps_max: number | null; plan_duration_sec: number | null; plan_rest_sec: number | null; plan_captured: number;
}
interface TemplateRowForStart {
  exercise_id: number; target_sets: number; target_reps_min: number | null; target_reps_max: number | null; target_duration_sec: number | null;
  rest_sec: number; source: 'seed' | 'user'; custom_name: string | null;
}

const toSessionExercise = (e: SessionExerciseRow, sets: SessionSet[]): SessionExercise => ({
  id: e.id, exerciseId: e.exercise_id, position: e.position, exerciseName: e.exercise_name,
  plan: e.plan_captured === 1
    ? { sets: e.plan_sets!, repsMin: e.plan_reps_min, repsMax: e.plan_reps_max, durationSec: e.plan_duration_sec, restSec: e.plan_rest_sec! }
    : null,
  sets,
});

/** The name to keep for an exercise a session uses: a custom exercise's own name (built-in ones have none; they are named by translation). */
const nameToKeep = async (db: SqlExecutor, exerciseId: number): Promise<string | null> =>
  (await db.first<{ custom_name: string | null }>('SELECT custom_name FROM exercises WHERE id=?', [exerciseId]))?.custom_name ?? null;

interface SetRow {
  id: number; session_exercise_id: number; set_number: number; weight_kg: number | null; reps: number | null; duration_sec: number | null;
  distance_m: number | null; rpe: number | null; is_warmup: number; is_completed: number; completed_at: number | null;
}

const toSession = (r: SessionRow): WorkoutSession => ({
  id: r.id, templateId: r.template_id, name: r.name, status: r.status, startedAt: r.started_at, endedAt: r.ended_at,
  discardedAt: r.discarded_at, localDate: r.local_date, rpe: r.rpe, estKcal: r.est_kcal, estMethod: r.est_method,
});
const toSet = (r: SetRow): SessionSet => ({
  id: r.id, sessionExerciseId: r.session_exercise_id, setNumber: r.set_number, weightKg: r.weight_kg, reps: r.reps, durationSec: r.duration_sec,
  distanceM: r.distance_m, rpe: r.rpe, isWarmup: flag(r.is_warmup), isCompleted: flag(r.is_completed), completedAt: r.completed_at,
});

/** `undefined` = leave unchanged, `null` = clear the value. */
const pick = <T>(patch: T | null | undefined, current: T | null): T | null => (patch === undefined ? current : patch);

/** Temporary offset used to renumber rows without tripping UNIQUE(…position/set_number) mid-update. */
const RENUMBER_OFFSET = 100_000;

const loadSession = async (db: SqlExecutor, id: number): Promise<WorkoutSession> => {
  const r = await db.first<SessionRow>('SELECT * FROM workout_sessions WHERE id=?', [id]);
  return r ? toSession(r) : notFound('session');
};

async function loadDetail(db: SqlExecutor, id: number): Promise<WorkoutSessionDetail> {
  const session = await loadSession(db, id);
  const ses = await db.all<SessionExerciseRow>('SELECT * FROM session_exercises WHERE session_id=? ORDER BY position', [id]);
  const sets = await db.all<SetRow>(
    `SELECT ss.* FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id WHERE se.session_id=? ORDER BY se.position, ss.set_number`, [id]);
  return {
    ...session,
    exercises: ses.map((e) => toSessionExercise(e, sets.filter((s) => s.session_exercise_id === e.id).map(toSet))),
  };
}

const sessionOf = async (db: SqlExecutor, sessionExerciseId: number) => {
  const se = await db.first<SessionExerciseRow>('SELECT * FROM session_exercises WHERE id=?', [sessionExerciseId]);
  if (!se) return notFound('session_exercise');
  return { se, session: await loadSession(db, se.session_id) };
};

/** A completion time must lie within [startedAt, endedAt]; when none is given, "now" clamped into that window. */
const clampToSession = (now: number, s: WorkoutSession) => Math.max(s.startedAt, Math.min(now, s.endedAt ?? Number.POSITIVE_INFINITY));

/** Clock skew allowed for a user-supplied time. Anything later is "in the future" and rejected, so a typo cannot push a workout's end (and so its duration and date) far ahead. */
const FUTURE_TOLERANCE_MS = 5 * 60_000;
const inFuture = (t: number | undefined, now: number) => t !== undefined && t > now + FUTURE_TOLERANCE_MS;

const rethrowTransition = (e: unknown, from: SessionStatus, to: SessionStatus): never => {
  if (e instanceof DbError && e.appError.kind === 'invalid_transition') throw new DbError({ ...e.appError, from, to });
  throw e;
};

export function createSessionRepository(ctx: RepoContext): SessionRepository {
  const requireTransition = (s: WorkoutSession, to: SessionStatus) => {
    if (!canTransition(s.status, to)) fail({ kind: 'invalid_transition', from: s.status, to, reason: 'not_permitted' });
  };

  return {
    async start(input = {}) {
      const parsed = parseInput(sessionStartInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      return guard(() => ctx.db.transaction(async (tx) => {
        let name = v.name;
        let exerciseIds = v.exerciseIds ?? [];
        let fromTemplate: TemplateRowForStart[] | null = null;
        if (v.templateId !== undefined) {
          const t = await tx.first<{ name: string }>('SELECT name FROM workout_templates WHERE id=?', [v.templateId]);
          if (!t) return notFound('template');
          name ??= t.name;
          if (!v.exerciseIds) {
            // the template's targets are copied now, inside this transaction: later edits or deletion of the template must not reach the session
            fromTemplate = await tx.all<TemplateRowForStart>(
              `SELECT te.exercise_id, te.target_sets, te.target_reps_min, te.target_reps_max, te.target_duration_sec, te.rest_sec, e.source, e.custom_name
               FROM template_exercises te JOIN exercises e ON e.id=te.exercise_id WHERE te.template_id=? ORDER BY te.position`, [v.templateId]);
            exerciseIds = fromTemplate.map((r) => r.exercise_id);
          }
        }
        if (!name) return fail({ kind: 'validation', issues: { name: 'validation.required' } });
        const now = ctx.now();
        const r = await tx.run(
          "INSERT INTO workout_sessions(template_id,name,status,started_at,local_date) VALUES (?,?,'in_progress',?,?)",
          [v.templateId ?? null, name, now, ctx.localDate(now)]); // a second active session is rejected by the unique index -> conflict
        let position = 1;
        if (fromTemplate) {
          for (const row of fromTemplate) {
            await tx.run(
              `INSERT INTO session_exercises(session_id,exercise_id,position,exercise_name,plan_sets,plan_reps_min,plan_reps_max,plan_duration_sec,plan_rest_sec,plan_captured)
               VALUES (?,?,?,?,?,?,?,?,?,1)`,
              [r.lastInsertRowId, row.exercise_id, position++, row.source === 'user' ? row.custom_name : null, row.target_sets, row.target_reps_min, row.target_reps_max, row.target_duration_sec, row.rest_sec]);
          }
        } else {
          for (const exerciseId of exerciseIds) {
            await tx.run('INSERT INTO session_exercises(session_id,exercise_id,position,exercise_name) VALUES (?,?,?,?)', [r.lastInsertRowId, exerciseId, position++, await nameToKeep(tx, exerciseId)]);
          }
        }
        return loadDetail(tx, r.lastInsertRowId);
      }));
    },

    getActive: () => guard(async () => {
      const r = await ctx.db.first<{ id: number }>("SELECT id FROM workout_sessions WHERE status='in_progress'");
      return r ? loadDetail(ctx.db, r.id) : null;
    }),
    get: (id) => guard(() => loadDetail(ctx.db, id)),

    async list(filter = {}) {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (filter.status) { where.push('status=?'); params.push(filter.status); }
      if (filter.range) {
        const rr = parseInput(dateRangeInput, filter.range);
        if (!rr.ok) return err(rr.error);
        where.push('local_date BETWEEN ? AND ?');
        params.push(rr.value.from, rr.value.to);
      }
      const limit = Math.min(200, Math.max(1, Math.trunc(filter.limit ?? 50)));
      const offset = Math.max(0, Math.trunc(filter.offset ?? 0));
      return guard(async () => (await ctx.db.all<SessionRow>(
        `SELECT * FROM workout_sessions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?`, [...params, limit, offset])).map(toSession));
    },

    addExercise: (sessionId, exerciseId) => guard(() => ctx.db.transaction(async (tx) => {
      await loadSession(tx, sessionId);
      const next = (await tx.first<{ p: number }>('SELECT COALESCE(MAX(position),0)+1 p FROM session_exercises WHERE session_id=?', [sessionId]))!.p;
      const keep = await nameToKeep(tx, exerciseId);
      const r = await tx.run('INSERT INTO session_exercises(session_id,exercise_id,position,exercise_name) VALUES (?,?,?,?)', [sessionId, exerciseId, next, keep]);
      const out: SessionExercise = { id: r.lastInsertRowId, exerciseId, position: next, exerciseName: keep, plan: null, sets: [] };
      return out;
    })),

    removeExercise: (sessionExerciseId) => guard(() => ctx.db.transaction(async (tx) => {
      const { se } = await sessionOf(tx, sessionExerciseId);
      await tx.run('DELETE FROM session_exercises WHERE id=?', [sessionExerciseId]); // frozen / would-empty guards live in the database
      await tx.run('UPDATE session_exercises SET position=position+? WHERE session_id=? AND position>?', [RENUMBER_OFFSET, se.session_id, se.position]);
      await tx.run('UPDATE session_exercises SET position=position-? WHERE session_id=? AND position>?', [RENUMBER_OFFSET + 1, se.session_id, RENUMBER_OFFSET]);
    })),

    async addSet(sessionExerciseId, input) {
      const parsed = parseInput(setInput, input);
      if (!parsed.ok) return err(parsed.error);
      const v = parsed.value;
      if (!v.isCompleted && v.completedAt !== undefined) return err({ kind: 'validation', issues: { completedAt: 'validation.invalid' } });
      return guard(() => ctx.db.transaction(async (tx) => {
        const { session } = await sessionOf(tx, sessionExerciseId);
        if (inFuture(v.completedAt, ctx.now())) return fail({ kind: 'validation', issues: { completedAt: 'validation.outOfRange' } });
        const completedAt = v.isCompleted ? (v.completedAt ?? clampToSession(ctx.now(), session)) : null;
        const n = (await tx.first<{ n: number }>('SELECT COALESCE(MAX(set_number),0)+1 n FROM session_sets WHERE session_exercise_id=?', [sessionExerciseId]))!.n;
        const r = await tx.run(
          `INSERT INTO session_sets(session_exercise_id,set_number,weight_kg,reps,duration_sec,distance_m,rpe,is_warmup,is_completed,completed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [sessionExerciseId, n, v.weightKg ?? null, v.reps ?? null, v.durationSec ?? null, v.distanceM ?? null, v.rpe ?? null, bit(v.isWarmup), bit(v.isCompleted), completedAt]);
        return toSet((await tx.first<SetRow>('SELECT * FROM session_sets WHERE id=?', [r.lastInsertRowId]))!);
      }));
    },

    async updateSet(setId, patch) {
      const parsed = parseInput(setPatch, patch);
      if (!parsed.ok) return err(parsed.error);
      const p = parsed.value;
      return guard(() => ctx.db.transaction(async (tx) => {
        const row = await tx.first<SetRow>('SELECT * FROM session_sets WHERE id=?', [setId]);
        if (!row) return notFound('set');
        const { session } = await sessionOf(tx, row.session_exercise_id);
        const m = {
          weightKg: pick(p.weightKg, row.weight_kg), reps: pick(p.reps, row.reps), durationSec: pick(p.durationSec, row.duration_sec),
          distanceM: pick(p.distanceM, row.distance_m), rpe: pick(p.rpe, row.rpe),
          isWarmup: p.isWarmup ?? flag(row.is_warmup), isCompleted: p.isCompleted ?? flag(row.is_completed),
        };
        if (!m.isCompleted && p.completedAt) return fail({ kind: 'validation', issues: { completedAt: 'validation.invalid' } });
        if (inFuture(p.completedAt ?? undefined, ctx.now())) return fail({ kind: 'validation', issues: { completedAt: 'validation.outOfRange' } });
        const completedAt = m.isCompleted ? (p.completedAt ?? row.completed_at ?? clampToSession(ctx.now(), session)) : null;
        // the merged set must satisfy the same rules as a new one (e.g. a completed set needs a metric)
        const check = parseInput(setInput, {
          weightKg: m.weightKg ?? undefined, reps: m.reps ?? undefined, durationSec: m.durationSec ?? undefined, distanceM: m.distanceM ?? undefined,
          rpe: m.rpe ?? undefined, isWarmup: m.isWarmup, isCompleted: m.isCompleted, completedAt: completedAt ?? undefined,
        });
        if (!check.ok) return fail(check.error);
        await tx.run(
          'UPDATE session_sets SET weight_kg=?, reps=?, duration_sec=?, distance_m=?, rpe=?, is_warmup=?, is_completed=?, completed_at=? WHERE id=?',
          [m.weightKg, m.reps, m.durationSec, m.distanceM, m.rpe, bit(m.isWarmup), bit(m.isCompleted), completedAt, setId]);
        return toSet((await tx.first<SetRow>('SELECT * FROM session_sets WHERE id=?', [setId]))!);
      }));
    },

    deleteSet: (setId) => guard(() => ctx.db.transaction(async (tx) => {
      const row = await tx.first<SetRow>('SELECT * FROM session_sets WHERE id=?', [setId]);
      if (!row) return notFound('set');
      await tx.run('DELETE FROM session_sets WHERE id=?', [setId]);
      await tx.run('UPDATE session_sets SET set_number=set_number+? WHERE session_exercise_id=? AND set_number>?', [RENUMBER_OFFSET, row.session_exercise_id, row.set_number]);
      await tx.run('UPDATE session_sets SET set_number=set_number-? WHERE session_exercise_id=? AND set_number>?', [RENUMBER_OFFSET + 1, row.session_exercise_id, RENUMBER_OFFSET]);
    })),

    async complete(sessionId, input = {}) {
      const parsed = parseInput(completeSessionInput, input);
      if (!parsed.ok) return err(parsed.error);
      return guard(() => ctx.db.transaction(async (tx) => {
        const s = await loadSession(tx, sessionId);
        requireTransition(s, 'completed');
        const last = await tx.first<{ t: number | null }>(
          'SELECT MAX(ss.completed_at) t FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id WHERE se.session_id=?', [sessionId]);
        const endedAt = Math.max(ctx.now(), s.startedAt, last?.t ?? 0); // never before the start or before the last set
        try {
          await tx.run("UPDATE workout_sessions SET status='completed', ended_at=?, rpe=? WHERE id=?", [endedAt, parsed.value.rpe ?? null, sessionId]);
        } catch (e) {
          rethrowTransition(e, 'in_progress', 'completed');
        }
        return loadSession(tx, sessionId);
      }));
    },

    discard: (sessionId) => guard(() => ctx.db.transaction(async (tx) => {
      const s = await loadSession(tx, sessionId);
      requireTransition(s, 'discarded');
      await tx.run("UPDATE workout_sessions SET status='discarded', discarded_at=? WHERE id=?", [Math.max(ctx.now(), s.startedAt), sessionId]);
      return loadSession(tx, sessionId);
    })),

    async updateDetails(sessionId, patch) {
      const parsed = parseInput(sessionPatch, patch);
      if (!parsed.ok) return err(parsed.error);
      const p = parsed.value;
      return guard(() => ctx.db.transaction(async (tx) => {
        const s = await loadSession(tx, sessionId);
        if (!isEditable(s.status)) return fail({ kind: 'immutable', reason: 'discarded_session' });
        const issues: Record<string, string> = {};
        if (p.endedAt !== undefined && s.status !== 'completed') issues.endedAt = 'validation.invalid';
        if (p.rpe != null && s.status !== 'completed') issues.rpe = 'validation.invalid';
        if (p.endedAt !== undefined && !issues.endedAt && (p.endedAt < s.startedAt || inFuture(p.endedAt, ctx.now()))) issues.endedAt = 'validation.outOfRange';
        if (Object.keys(issues).length) return fail({ kind: 'validation', issues });
        await tx.run('UPDATE workout_sessions SET name=?, rpe=?, ended_at=? WHERE id=?', [
          p.name ?? s.name, pick(p.rpe, s.rpe), p.endedAt ?? s.endedAt, sessionId]);
        return loadSession(tx, sessionId);
      }));
    },

    async completedDates(range) {
      const r = parseInput(dateRangeInput, range);
      if (!r.ok) return err(r.error);
      return guard(async () => (await ctx.db.all<{ local_date: string }>(
        "SELECT DISTINCT local_date FROM workout_sessions WHERE status='completed' AND local_date BETWEEN ? AND ? ORDER BY local_date", [r.value.from, r.value.to])).map((x) => x.local_date));
    },
    async countCompleted(range) {
      const r = parseInput(dateRangeInput, range);
      if (!r.ok) return err(r.error);
      return guard(async () => Number((await ctx.db.first<{ c: number }>(
        "SELECT count(*) c FROM workout_sessions WHERE status='completed' AND local_date BETWEEN ? AND ?", [r.value.from, r.value.to]))!.c));
    },
  };
}
