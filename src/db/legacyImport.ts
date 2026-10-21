import { DbError } from '../domain/errors';
import { systemClock, type Clock } from '../domain/clock';
import { err, ok, type Result } from '../domain/result';
import { profileInput, weightInput } from '../domain/schemas';
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

export type LegacyField = 'displayName' | 'location' | 'age' | 'heightCm' | 'weightKg';
export type LegacySkipReason = 'invalid' | 'existing_data';
export interface LegacySkip {
  field: LegacyField;
  reason: LegacySkipReason;
}

export type LegacyImportOutcome =
  | { status: 'nothing_to_import' }
  | { status: 'already_imported' }
  | { status: 'imported'; profileCreated: boolean; imported: LegacyField[]; skipped: LegacySkip[] };

/**
 * One-way, idempotent COPY of the old AsyncStorage profile into SQLite.
 *
 * DATES. The old profile never recorded when its age or weight were typed, so they have NO KNOWN DATE. They are imported
 * as exactly that: `age_set_on` stays NULL (age of unknown date) and the weight goes to `profile.undated_weight_kg`, not to
 * `weight_entries` (whose rows always have a real day). Nothing is dated "today", so an old value can never pass for a
 * current one; the screens ask the person for current values instead.
 *
 * SAFETY.
 *  - Reads only; never writes to or deletes AsyncStorage.
 *  - Never invents anything: without a valid name no profile row can exist (the name is required), so nothing is imported.
 *  - Partial data is imported field by field; an invalid field is skipped and reported, the valid ones still arrive.
 *  - Never overwrites newer data: an existing database profile keeps its name and every value it has; only EMPTY fields are
 *    filled, and a legacy weight is ignored once any dated weight entry exists.
 *  - One transaction covers the writes AND the "already imported" marker (which is re-checked inside it), so an interrupted
 *    import leaves nothing behind and simply runs again next time; two overlapping runs cannot both import.
 *  - A missing key writes no marker (nothing was decided), an unreadable blob writes none either and is retried next launch.
 * Settings (language, sound, reminders ...) stay in AsyncStorage and are not touched here.
 */
export async function importLegacyProfile(store: ReadOnlyKeyValueStore, db: Db, opts: { clock?: Clock } = {}): Promise<Result<LegacyImportOutcome>> {
  const clock = opts.clock ?? systemClock;
  try {
    if (await db.first('SELECT 1 AS x FROM app_meta WHERE key=?', [LEGACY_IMPORT_META_KEY])) return ok({ status: 'already_imported' });

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

    const { values, skipped: invalid } = readLegacyFields(o);
    const now = clock.now();

    return await db.transaction(async (tx): Promise<Result<LegacyImportOutcome>> => {
      if (await tx.first('SELECT 1 AS x FROM app_meta WHERE key=?', [LEGACY_IMPORT_META_KEY])) return ok({ status: 'already_imported' }); // an overlapping run won

      const imported: LegacyField[] = [];
      const skipped: LegacySkip[] = [...invalid];
      const existing = await tx.first<{ display_name: string; location: string | null; age_years: number | null; height_cm: number | null; undated_weight_kg: number | null }>(
        'SELECT display_name, location, age_years, height_cm, undated_weight_kg FROM profile WHERE id=1');
      const hasDatedWeight = !!(await tx.first('SELECT 1 AS x FROM weight_entries LIMIT 1'));

      if (!existing) {
        if (values.displayName === undefined) return err({ kind: 'legacy_data_invalid', key: LEGACY_PROFILE_KEY }); // no name, no profile: nothing is made up
        await tx.run(
          'INSERT INTO profile(id,display_name,location,age_years,age_set_on,height_cm,undated_weight_kg,updated_at) VALUES (1,?,?,?,NULL,?,?,?)',
          [values.displayName, values.location ?? null, values.age ?? null, values.heightCm ?? null, hasDatedWeight ? null : (values.weightKg ?? null), now]);
        imported.push('displayName');
        for (const f of ['location', 'age', 'heightCm'] as const) if (values[f] !== undefined) imported.push(f);
        if (values.weightKg !== undefined) {
          if (hasDatedWeight) skipped.push({ field: 'weightKg', reason: 'existing_data' });
          else imported.push('weightKg');
        }
      } else {
        // newer data wins: fill only what is EMPTY, never replace
        const sets: string[] = [];
        const params: (string | number)[] = [];
        const fill = (field: LegacyField, column: string, current: unknown, value: number | string | undefined, blocked = false) => {
          if (value === undefined) return;
          if (current === null || current === undefined) {
            if (blocked) skipped.push({ field, reason: 'existing_data' });
            else {
              sets.push(`${column}=?`);
              params.push(value);
              imported.push(field);
            }
          } else skipped.push({ field, reason: 'existing_data' });
        };
        if (values.displayName !== undefined) skipped.push({ field: 'displayName', reason: 'existing_data' }); // the name is never replaced
        fill('location', 'location', existing.location, values.location);
        fill('age', 'age_years', existing.age_years, values.age);
        fill('heightCm', 'height_cm', existing.height_cm, values.heightCm);
        fill('weightKg', 'undated_weight_kg', existing.undated_weight_kg, values.weightKg, hasDatedWeight);
        if (sets.length) {
          // an age filled in here has no known date: age_set_on is left as it is (NULL, because the age was empty)
          await tx.run(`UPDATE profile SET ${sets.join(', ')}, updated_at=? WHERE id=1`, [...params, now]);
        }
      }

      await tx.run('INSERT INTO app_meta(key,value) VALUES (?,?)', [
        LEGACY_IMPORT_META_KEY, JSON.stringify({ at: now, from: LEGACY_PROFILE_KEY, imported, skipped }),
      ]);
      return ok({ status: 'imported', profileCreated: !existing, imported, skipped });
    });
  } catch (e) {
    return err(e instanceof DbError ? e.appError : mapDbError(e));
  }
}

type LegacyValues = { displayName?: string; location?: string; age?: number; heightCm?: number; weightKg?: number };
const isAbsent = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Validates each legacy field on its own, with the same rules as new input. Absent (or blank) fields are simply absent; present-but-bad ones are reported. */
function readLegacyFields(o: Record<string, unknown>): { values: LegacyValues; skipped: LegacySkip[] } {
  const values: LegacyValues = {};
  const skipped: LegacySkip[] = [];
  const shape = profileInput.shape;

  if (!isAbsent(o.name)) {
    const r = shape.displayName.safeParse(o.name);
    if (r.success) values.displayName = r.data;
    else skipped.push({ field: 'displayName', reason: 'invalid' });
  }
  if (!isAbsent(o.location)) {
    const r = shape.location.safeParse(o.location);
    if (r.success && r.data) values.location = r.data;
    else skipped.push({ field: 'location', reason: 'invalid' });
  }
  if (!isAbsent(o.age)) {
    const r = shape.ageYears.safeParse(o.age);
    if (r.success && r.data !== undefined) values.age = r.data;
    else skipped.push({ field: 'age', reason: 'invalid' });
  }
  if (!isAbsent(o.heightCm)) {
    const r = shape.heightCm.safeParse(o.heightCm);
    if (r.success && r.data !== undefined) values.heightCm = r.data;
    else skipped.push({ field: 'heightCm', reason: 'invalid' });
  }
  if (!isAbsent(o.weightKg)) {
    const r = weightInput.shape.weightKg.safeParse(o.weightKg);
    if (r.success) values.weightKg = Math.round(r.data * 10) / 10;
    else skipped.push({ field: 'weightKg', reason: 'invalid' });
  }
  return { values, skipped };
}
