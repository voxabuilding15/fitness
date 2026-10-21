import type { Clock } from '../domain/clock';
import type { Result } from '../domain/result';
import { runSeed, type SeedPack } from './seedRunner';
import type { Db } from './sqlDatabase';

/**
 * Applies the built-in content (the exercise library) when the database becomes ready: at most once at a time, and
 * once per app run unless something transient went wrong. `runSeed` itself only changes anything when the pack is NEWER
 * than the stored version, in one transaction, keeping every row's id, hidden flag and history links.
 * A failure is reported, never thrown, and never makes the database unavailable: the app keeps working without new built-ins.
 */
export interface SeedStartup {
  run(db: Db): Promise<Result<{ applied: boolean; version: number }>>;
  last(): Result<{ applied: boolean; version: number }> | null;
}

export function createSeedStartup(pack: SeedPack, opts: { clock?: Clock } = {}): SeedStartup {
  type Out = Result<{ applied: boolean; version: number }>;
  let inflight: Promise<Out> | null = null;
  let last: Out | null = null;
  return {
    run(db) {
      if (inflight) return inflight;
      const attempt = runSeed(db, pack, opts.clock).then((r) => {
        last = r;
        if (!r.ok && r.error.kind !== 'validation' && inflight === attempt) inflight = null; // a database error may pass: try again next time
        return r;
      });
      inflight = attempt;
      return attempt;
    },
    last: () => last,
  };
}
