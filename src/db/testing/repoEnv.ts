import { ManualClock } from '../../domain/clock';
import type { Result } from '../../domain/result';
import type { Repositories } from '../../domain/repositories';
import type { Database } from '../database';
import { createRepositories } from '../repositories';
import { createTestDb } from './testDb';

/** 2026-10-21 10:00:00 UTC. With a zero UTC offset the local date is 2026-10-21. */
export const T0 = Date.UTC(2026, 9, 21, 10, 0, 0);
export const H = 3_600_000;
export const MIN = 60_000;

export interface RepoEnv {
  db: Database;
  clock: ManualClock;
  repos: Repositories;
}

/** A migrated in-memory database plus repositories driven by a manual clock (TEST-ONLY). */
export async function createRepoEnv(utcOffsetMinutes = 0): Promise<RepoEnv> {
  const db = await createTestDb();
  const clock = new ManualClock(T0);
  return { db, clock, repos: createRepositories({ db, clock, utcOffsetMinutes: () => utcOffsetMinutes }) };
}

/** Unwraps a Result, failing the test with the full error if it is not ok. */
export function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
}

/** Returns the error of a Result that is expected to have failed. */
export function errorOf<T>(r: Result<T>) {
  if (r.ok) throw new Error(`expected an error, got ok: ${JSON.stringify(r.value)}`);
  return r.error;
}
