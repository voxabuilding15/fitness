import type { Clock } from '../../domain/clock';
import { deviceUtcOffsetMinutes, toLocalDate } from '../../domain/dates';
import { DbError, type AppError } from '../../domain/errors';
import { err, ok, type Result } from '../../domain/result';
import { mapDbError } from '../mapDbError';
import type { Db } from '../sqlDatabase';

export interface RepoDeps {
  db: Db;
  clock: Clock;
  /** UTC offset (minutes) in force at an instant; defaults to the device's. Injectable for tests. */
  utcOffsetMinutes?: (ms: number) => number;
}

export class RepoContext {
  readonly db: Db;
  readonly clock: Clock;
  private readonly offset: (ms: number) => number;
  constructor(deps: RepoDeps) {
    this.db = deps.db;
    this.clock = deps.clock;
    this.offset = deps.utcOffsetMinutes ?? deviceUtcOffsetMinutes;
  }
  now() {
    return this.clock.now();
  }
  localDate(ms: number) {
    return toLocalDate(ms, this.offset(ms));
  }
  today() {
    return this.localDate(this.now());
  }
}

/** Runs a repository operation and converts any failure into a Result. Repositories never throw. */
export async function guard<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(mapDbError(e));
  }
}

/** For use inside `guard`: aborts the operation (rolling back an enclosing transaction) with a typed error. */
export const fail = (error: AppError): never => {
  throw new DbError(error);
};

export const notFound = (entity: string): never => fail({ kind: 'not_found', entity });

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const flag = (n: unknown) => Number(n) === 1;
export const bit = (b: boolean) => (b ? 1 : 0);

/** Escapes LIKE wildcards in user search text. */
export const likePattern = (s: string) => `%${s.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
