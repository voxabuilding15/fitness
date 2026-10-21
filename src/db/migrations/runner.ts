import { DbError, type AppError } from '../../domain/errors';
import { systemClock, type Clock } from '../../domain/clock';
import { err, ok, type Result } from '../../domain/result';
import { BACKUPS_META_KEY, clampKeep, isBackupName, parseBackupList, type BackupStrategy } from '../backup';
import type { Db, SqlExecutor } from '../sqlDatabase';
import { MIGRATIONS, type Migration } from './index';

export interface RunMigrationsOptions {
  migrations?: readonly Migration[];
  /** Required whenever the database already contains data. */
  backup?: BackupStrategy;
  /** How many pre-migration backups to retain, newest first (clamped to 2..10). */
  keepBackups?: number;
  clock?: Clock;
}

export interface MigrationReport {
  fromVersion: number;
  toVersion: number;
  applied: number[];
  backup: string | null;
  pruned: string[];
  /** Non-fatal problems (e.g. old backups that could not be removed). Never affect the migrated data. */
  warnings: string[];
}

const message = (e: unknown): string => {
  if (e instanceof DbError) return 'message' in e.appError ? e.appError.message : e.appError.kind; // unwrap, don't print the JSON envelope
  return e instanceof Error ? e.message : String(e);
};
const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function validateMigrationList(list: readonly Migration[]): string | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i].version !== i + 1) return `migration #${i + 1} has version ${list[i].version}; versions must be 1..N without gaps`;
  }
  return null;
}

/**
 * Records a freshly VALIDATED backup and trims the retention list.
 *  - Only called after the new backup passed validation, so no older recovery copy is ever removed before its replacement is proven.
 *  - Runs on the success AND the failure path of a migration, so repeated failed launches cannot accumulate backups.
 *  - The stored list is data inside the database: it is sanitized, and only allowlisted backup names can ever reach `prune`.
 * Returns false (with a warning) if the bookkeeping table does not exist yet; the caller may retry after the upgrade.
 */
async function trackAndTrim(db: Db, backup: BackupStrategy, newName: string, keep: number, report: MigrationReport): Promise<boolean> {
  try {
    const row = await db.first<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [BACKUPS_META_KEY]);
    const { names, ignored } = parseBackupList(row?.value);
    if (ignored) report.warnings.push(`ignored ${ignored} invalid entr${ignored === 1 ? 'y' : 'ies'} in the stored backup list`);
    const known = names.filter((n) => n !== newName);
    known.push(newName); // newest last; the new backup is always retained
    const surplus = known.slice(0, Math.max(0, known.length - keep)).filter((n) => n !== newName && isBackupName(n));
    const result = surplus.length ? await backup.prune(surplus) : { removed: [], failed: [] };
    report.pruned.push(...result.removed);
    for (const f of result.failed) report.warnings.push(`could not remove old backup ${f.name}: ${f.message}`);
    const remaining = known.filter((n) => !result.removed.includes(n)); // failed removals stay tracked for a later retry
    await db.run('INSERT INTO app_meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [BACKUPS_META_KEY, JSON.stringify(remaining)]);
    return true;
  } catch (e) {
    report.warnings.push(`backup bookkeeping failed: ${message(e)}`);
    return false;
  }
}

async function userTableCounts(tx: SqlExecutor): Promise<Map<string, number>> {
  const tables = await tx.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
  const counts = new Map<string, number>();
  for (const t of tables) counts.set(t.name, Number((await tx.first<{ c: number }>(`SELECT count(*) c FROM ${quoteIdent(t.name)}`))!.c));
  return counts;
}

/**
 * Upgrades the schema to the latest version.
 *  - Never touches a database that is NEWER than this app (`db_too_new`).
 *  - A database that already holds data is backed up (and the backup validated) BEFORE anything changes;
 *    if that fails, nothing is changed and `backup_failed` is returned.
 *  - All pending migrations plus the `user_version` bump run in ONE transaction: all or nothing.
 *  - Unless a migration declares `allowRowLoss`, the upgrade is rolled back if any existing table loses rows.
 */
export async function runMigrations(db: Db, opts: RunMigrationsOptions = {}): Promise<Result<MigrationReport>> {
  const migrations = opts.migrations ?? MIGRATIONS;
  const clock = opts.clock ?? systemClock;
  const keep = clampKeep(opts.keepBackups);

  const listProblem = validateMigrationList(migrations);
  if (listProblem) return err({ kind: 'migration', version: 0, message: listProblem });
  const latest = migrations.length ? migrations[migrations.length - 1].version : 0;

  let current: number;
  let populated: boolean;
  try {
    current = Number((await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0);
    const tables = await db.first<{ c: number }>("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    populated = current > 0 || Number(tables?.c ?? 0) > 0;
  } catch (e) {
    return err(e instanceof DbError ? e.appError : { kind: 'unknown', message: message(e) });
  }

  if (current > latest) return err({ kind: 'db_too_new', found: current, supported: latest });

  const report: MigrationReport = { fromVersion: current, toVersion: current, applied: [], backup: null, pruned: [], warnings: [] };
  if (current === latest) return ok(report);

  const pending = migrations.filter((m) => m.version > current);
  let trackingDeferred = false;

  if (populated) {
    if (!opts.backup) return err({ kind: 'backup_failed', message: 'a backup strategy is required to migrate a database that contains data' });
    try {
      const record = await opts.backup.create(db, { fromVersion: current, toVersion: latest, timestamp: clock.now() });
      if (!isBackupName(record?.name)) throw new Error('the backup strategy returned a name that is not a valid backup name'); // nothing is deleted on this path
      try {
        await opts.backup.validate(record, { userVersion: current });
      } catch (validationError) {
        await opts.backup.prune([record.name]).catch(() => undefined); // best effort: remove only the unusable copy we just made
        throw validationError;
      }
      report.backup = record.name;
    } catch (e) {
      return err({ kind: 'backup_failed', message: message(e) });
    }
    // The new backup is proven valid: only now may older ones be trimmed. Done BEFORE migrating so a migration that
    // keeps failing cannot pile up one backup per launch.
    trackingDeferred = !(await trackAndTrim(db, opts.backup, report.backup, keep, report));
  }

  let at = current;
  try {
    await db.transaction(async (tx) => {
      const guardRows = !pending.some((m) => m.allowRowLoss);
      const before = guardRows ? await userTableCounts(tx) : null;
      for (const m of pending) {
        at = m.version;
        await tx.exec(m.sql);
      }
      await tx.exec(`PRAGMA user_version = ${latest}`);
      const violations = await tx.all('PRAGMA foreign_key_check');
      if (violations.length) throw new Error(`foreign_key_check reported ${violations.length} violation(s)`);
      if (before) {
        const after = await userTableCounts(tx);
        for (const [table, n] of before) {
          const m = after.get(table) ?? 0; // a table that vanished while holding rows counts as losing them all
          if (m < n) throw new Error(`the migration would delete rows from "${table}" (${n} -> ${m}); declare allowRowLoss if that is intended`);
        }
      }
    });
  } catch (e) {
    const appError: AppError = e instanceof DbError && (e.appError.kind === 'busy' || e.appError.kind === 'unavailable') ? e.appError : { kind: 'migration', version: at, message: message(e) };
    return err(appError);
  }

  report.toVersion = latest;
  report.applied = pending.map((m) => m.version);
  if (report.backup && trackingDeferred) await trackAndTrim(db, opts.backup!, report.backup, keep, report); // app_meta only exists after migration 001
  return ok(report);
}
