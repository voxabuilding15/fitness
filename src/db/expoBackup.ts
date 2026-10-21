import type { SQLiteDatabase } from 'expo-sqlite';
import { MAX_BACKUP_NAME_ATTEMPTS, backupName, isBackupName, refusedPrune, type BackupContext, type BackupRecord, type BackupStrategy, type PruneResult } from './backup';
import type { Db } from './sqlDatabase';

/** The subset of the expo-sqlite module used for backups (injectable so the safety logic can be unit-tested). */
export interface ExpoSqliteApi {
  openDatabaseAsync(name: string, options?: { useNewConnection?: boolean }): Promise<SQLiteDatabase>;
  backupDatabaseAsync(args: { sourceDatabase: SQLiteDatabase; destDatabase: SQLiteDatabase }): Promise<void>;
  deleteDatabaseAsync(name: string): Promise<void>;
}

/**
 * Backup via SQLite's online backup API. expo-sqlite's `backupDatabaseAsync` REPLACES the destination's contents,
 * so a destination is only used after proving it is brand new (no tables); otherwise the next name is tried.
 * NOTE: exercised against a fake API in unit tests; the real native call still needs an on-device test.
 */
export class ExpoBackupStrategy implements BackupStrategy {
  constructor(
    private readonly api: ExpoSqliteApi,
    private readonly source: SQLiteDatabase,
  ) {}

  async create(_source: Db, ctx: BackupContext): Promise<BackupRecord> {
    for (let attempt = 0; attempt < MAX_BACKUP_NAME_ATTEMPTS; attempt++) {
      const name = backupName(ctx, attempt);
      const dest = await this.api.openDatabaseAsync(name, { useNewConnection: true });
      let fresh = false;
      try {
        const rows = await dest.getAllAsync<{ c: number }>("SELECT count(*) AS c FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
        fresh = Number(rows[0]?.c ?? 1) === 0;
        if (!fresh) continue; // somebody's backup is already here: never touch it
        await this.api.backupDatabaseAsync({ sourceDatabase: this.source, destDatabase: dest });
        return { name };
      } catch (e) {
        if (fresh) await this.api.deleteDatabaseAsync(name).catch(() => undefined); // remove our own half-written file only
        throw e;
      } finally {
        await dest.closeAsync().catch(() => undefined);
      }
    }
    throw new Error('could not find an unused backup name');
  }

  async validate(record: BackupRecord, expected: { userVersion: number }): Promise<void> {
    if (!isBackupName(record.name)) throw new Error('refusing to open a file that is not a backup name');
    const db = await this.api.openDatabaseAsync(record.name, { useNewConnection: true });
    try {
      const check = await db.getAllAsync<{ integrity_check: string }>('PRAGMA integrity_check');
      if (check.length !== 1 || check[0].integrity_check !== 'ok') throw new Error('backup failed integrity_check');
      const v = await db.getAllAsync<{ user_version: number }>('PRAGMA user_version');
      if (Number(v[0]?.user_version) !== expected.userVersion) throw new Error('backup has the wrong schema version');
    } finally {
      await db.closeAsync().catch(() => undefined);
    }
  }

  async prune(names: string[]): Promise<PruneResult> {
    const result: PruneResult = { removed: [], failed: [] };
    for (const name of names) {
      if (!isBackupName(name)) {
        result.failed.push(refusedPrune(name));
        continue;
      }
      try {
        await this.api.deleteDatabaseAsync(name);
        result.removed.push(name);
      } catch (e) {
        result.failed.push({ name, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return result;
  }
}
