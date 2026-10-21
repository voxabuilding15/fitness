import { DbError } from '../domain/errors';
import { systemClock, type Clock } from '../domain/clock';
import { deviceUtcOffsetMinutes, toLocalDate } from '../domain/dates';
import { err, ok, type Result } from '../domain/result';
import { parseInput, profileInput, weightInput } from '../domain/schemas';
import { mapDbError } from './mapDbError';
import type { Db } from './sqlDatabase';

/**
 * The ONLY capability legacy import is given: reading. There is no setItem/removeItem on this type, so the import
 * cannot modify or delete AsyncStorage data (and the tests hand it an object that throws if anything else is called).
 */
export interface ReadOnlyKeyValueStore {
  getItem(key: string): Promise<string | null>;
}

export const LEGACY_PROFILE_KEY = 'fitness.profile.v1';
export const LEGACY_IMPORT_META_KEY = 'legacy_import_v1';

export type LegacyImportOutcome =
  | { status: 'nothing_to_import' }
  | { status: 'already_imported' }
  | { status: 'imported'; profileImported: boolean; weightImported: boolean };

/**
 * One-way, idempotent COPY of the old AsyncStorage profile into SQLite:
 *  - never writes to or deletes AsyncStorage; never overwrites an existing database profile/weight;
 *  - a missing key means nothing to import (the built-in demo profile is never persisted, so it is never imported);
 *  - malformed or out-of-range data is rejected as a whole (`legacy_data_invalid`) and nothing is written;
 *  - everything (including the "already imported" marker) happens in one transaction.
 * Settings (language, sound, reminders ...) stay in AsyncStorage and are not touched here.
 * NOT called anywhere in Phase 1.
 */
export async function importLegacyProfile(
  store: ReadOnlyKeyValueStore,
  db: Db,
  opts: { clock?: Clock; utcOffsetMinutes?: (ms: number) => number } = {},
): Promise<Result<LegacyImportOutcome>> {
  const clock = opts.clock ?? systemClock;
  const offset = opts.utcOffsetMinutes ?? deviceUtcOffsetMinutes;
  try {
    const marker = await db.first('SELECT 1 AS x FROM app_meta WHERE key=?', [LEGACY_IMPORT_META_KEY]);
    if (marker) return ok({ status: 'already_imported' });

    const raw = await store.getItem(LEGACY_PROFILE_KEY);
    if (raw === null) return ok({ status: 'nothing_to_import' });

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return err({ kind: 'legacy_data_invalid', key: LEGACY_PROFILE_KEY });
    }
    const o = data as Record<string, unknown> | null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return err({ kind: 'legacy_data_invalid', key: LEGACY_PROFILE_KEY });

    // legacy shape: { name, location, age, heightCm, weightKg } -> validated with the same rules as new input
    const profile = parseInput(profileInput, {
      displayName: o.name, location: typeof o.location === 'string' && o.location.trim() ? o.location : undefined,
      ageYears: o.age, heightCm: o.heightCm,
    });
    const weight = parseInput(weightInput, { weightKg: o.weightKg });
    if (!profile.ok || !weight.ok) return err({ kind: 'legacy_data_invalid', key: LEGACY_PROFILE_KEY });

    const now = clock.now();
    const today = toLocalDate(now, offset(now));
    const p = profile.value;
    return ok(await db.transaction(async (tx) => {
      const hasProfile = !!(await tx.first('SELECT 1 AS x FROM profile WHERE id=1'));
      if (!hasProfile) {
        await tx.run(
          'INSERT INTO profile(id,display_name,location,age_years,age_set_on,height_cm,updated_at) VALUES (1,?,?,?,?,?,?)',
          [p.displayName, p.location || null, p.ageYears ?? null, p.ageYears === undefined ? null : today, p.heightCm ?? null, now]);
      }
      // the old profile's weight becomes the first weight entry, labelled as coming from the legacy profile
      const w = await tx.run(
        "INSERT INTO weight_entries(local_date,weight_kg,note,source,logged_at) VALUES (?,?,NULL,'legacy_profile',?) ON CONFLICT(local_date) DO NOTHING",
        [today, Math.round(weight.value.weightKg * 10) / 10, now]);
      await tx.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [LEGACY_IMPORT_META_KEY, JSON.stringify({ at: now, from: LEGACY_PROFILE_KEY })]);
      const outcome: LegacyImportOutcome = { status: 'imported', profileImported: !hasProfile, weightImported: w.changes === 1 };
      return outcome;
    }));
  } catch (e) {
    return err(e instanceof DbError ? e.appError : mapDbError(e));
  }
}
