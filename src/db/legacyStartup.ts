import type { Clock } from '../domain/clock';
import type { Result } from '../domain/result';
import { importLegacyProfile, type LegacyImportOutcome, type ReadOnlyKeyValueStore } from './legacyImport';
import type { Db } from './sqlDatabase';

/**
 * Runs the one-time legacy profile import when the database becomes ready, at most once at a time and (unless something
 * transient went wrong) at most once per app run:
 *  - overlapping callers (a retry, a double effect) share one run;
 *  - a finished run - imported, already imported, nothing to import, or an unreadable legacy blob - is remembered;
 *  - a database error (busy, closed ...) is NOT remembered, so the next call tries again.
 * Never throws; the result is for diagnostics and for telling the person when the old profile could not be read.
 */
export interface LegacyStartup {
  run(db: Db): Promise<Result<LegacyImportOutcome>>;
  /** The most recent finished result, or null before any run. */
  last(): Result<LegacyImportOutcome> | null;
}

export function createLegacyStartup(store: ReadOnlyKeyValueStore, opts: { clock?: Clock } = {}): LegacyStartup {
  let inflight: Promise<Result<LegacyImportOutcome>> | null = null;
  let last: Result<LegacyImportOutcome> | null = null;
  return {
    run(db) {
      if (inflight) return inflight;
      const attempt = importLegacyProfile(store, db, opts).then((r) => {
        last = r;
        if (!r.ok && r.error.kind !== 'legacy_data_invalid' && inflight === attempt) inflight = null; // transient: allow another try
        return r;
      });
      inflight = attempt;
      return attempt;
    },
    last: () => last,
  };
}
