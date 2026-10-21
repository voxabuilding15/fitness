import { DbError, type AppError } from '../domain/errors';

/** Codes raised by our own triggers via RAISE(ABORT, 'FITNESS_*') in the migrations. */
const TRIGGER_ERRORS: Record<string, AppError> = {
  FITNESS_SEED_IMMUTABLE: { kind: 'immutable', reason: 'seed_row' },
  FITNESS_SESSION_FROZEN: { kind: 'immutable', reason: 'discarded_session' },
  FITNESS_SESSION_COMPLETED: { kind: 'immutable', reason: 'completed_session' },
  FITNESS_SESSION_PLAN_IMMUTABLE: { kind: 'immutable', reason: 'session_plan' },
  FITNESS_SESSION_START_IMMUTABLE: { kind: 'immutable', reason: 'session_start_time' },
  FITNESS_SESSION_TRANSITION: { kind: 'invalid_transition', from: '', to: '', reason: 'not_permitted' },
  FITNESS_SESSION_INSERT_STATUS: { kind: 'invalid_transition', from: '', to: '', reason: 'must_start_in_progress' },
  FITNESS_SESSION_EMPTY: { kind: 'invalid_transition', from: '', to: '', reason: 'no_completed_sets' },
  FITNESS_SET_TIME_RANGE: { kind: 'constraint', constraint: 'check', message: 'set time outside session' },
  FITNESS_SESSION_END_BEFORE_SET: { kind: 'constraint', constraint: 'check', message: 'session ends before a set' },
};

/** Translates a raw SQLite / driver failure into an AppError. SQLite messages are stable across drivers. */
export function mapDbError(e: unknown): AppError {
  if (e instanceof DbError) return e.appError;
  const message = e instanceof Error ? e.message : String(e);

  for (const [code, mapped] of Object.entries(TRIGGER_ERRORS)) {
    if (message.includes(code)) return mapped;
  }
  if (/UNIQUE constraint failed: workout_sessions\.status/i.test(message)) return { kind: 'conflict', reason: 'active_session' };
  if (/UNIQUE constraint failed/i.test(message)) return { kind: 'constraint', constraint: 'unique', message };
  if (/FOREIGN KEY constraint failed/i.test(message)) return { kind: 'constraint', constraint: 'foreign_key', message };
  if (/NOT NULL constraint failed/i.test(message)) return { kind: 'constraint', constraint: 'not_null', message };
  if (/CHECK constraint failed/i.test(message)) return { kind: 'constraint', constraint: 'check', message };
  if (/database is locked|SQLITE_BUSY|database table is locked/i.test(message)) return { kind: 'busy', message };
  return { kind: 'unknown', message };
}
