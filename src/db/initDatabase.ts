import { systemClock, type Clock } from '../domain/clock';
import { DbError, type AppError } from '../domain/errors';
import type { Repositories } from '../domain/repositories';
import type { BackupStrategy } from './backup';
import { Database } from './database';
import { runMigrations, type MigrationReport } from './migrations/runner';
import { createRepositories } from './repositories';
import type { Db, SqlDriver } from './sqlDatabase';
import { mapDbError } from './mapDbError';

export type DbInitResult =
  | { status: 'ready'; db: Db; repos: Repositories; report: MigrationReport }
  | { status: 'unavailable'; error: AppError };

export interface InitDeps {
  /** Opens the platform driver (and, where supported, its backup strategy). */
  open(): Promise<{ driver: SqlDriver; backup?: BackupStrategy }>;
  clock?: Clock;
  queueTimeoutMs?: number;
}

export interface DatabaseInitializer {
  /** Safe to call any number of times, concurrently: all callers share one in-flight initialization. Never rejects. */
  get(): Promise<DbInitResult>;
  /** Forget a cached FAILURE so the next `get()` tries again (a ready database is never discarded). */
  retry(): Promise<DbInitResult>;
}

const unavailable = (error: AppError): DbInitResult => ({ status: 'unavailable', error });

/**
 * Opens the database, verifies foreign keys, migrates (with a validated backup first when data exists), and builds the
 * repositories. It NEVER deletes or resets anything on failure: the database is simply reported as unavailable and
 * the rest of the app keeps running.
 */
export function createDatabaseInitializer(deps: InitDeps): DatabaseInitializer {
  let inflight: Promise<DbInitResult> | null = null;

  async function init(): Promise<DbInitResult> {
    let database: Database | null = null;
    try {
      const { driver, backup } = await deps.open();
      database = await Database.open(driver, { queueTimeoutMs: deps.queueTimeoutMs });
      const migrated = await runMigrations(database, { backup, clock: deps.clock });
      if (!migrated.ok) {
        await database.close().catch(() => undefined);
        return unavailable(migrated.error);
      }
      return { status: 'ready', db: database, repos: createRepositories({ db: database, clock: deps.clock ?? systemClock }), report: migrated.value };
    } catch (e) {
      await database?.close().catch(() => undefined);
      return unavailable(e instanceof DbError ? e.appError : mapDbError(e));
    }
  }

  const start = () => {
    const attempt = init();
    inflight = attempt;
    // a failed attempt is not cached: it stops being "in flight" once settled so a later call can retry
    attempt.then((r) => {
      if (r.status === 'unavailable' && inflight === attempt) inflight = null;
    });
    return attempt;
  };

  return {
    get: () => inflight ?? start(),
    retry: () => inflight ?? start(),
  };
}
