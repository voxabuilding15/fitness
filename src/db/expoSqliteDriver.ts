import type { SQLiteDatabase } from 'expo-sqlite';
import { loadExpoSqlite, type ExpoSqliteModule } from './expoSqliteModule';
import type { RunResult, SqlDriver, SqlValue } from './sqlDatabase';

/**
 * expo-sqlite driver (iOS / Android). It does not import expo-sqlite itself (types only); the module is obtained through
 * the guarded loader in expoSqliteModule.ts.
 * Deliberately does not use `withTransactionAsync` (interleaves with other queries) or
 * `withExclusiveTransactionAsync` (opens a second connection with foreign keys off); `Database`
 * issues BEGIN IMMEDIATE / COMMIT on this single connection instead.
 */
export class ExpoSqliteDriver implements SqlDriver {
  constructor(private readonly db: SQLiteDatabase) {}

  /** `sqlite` is injectable for tests; by default the real module is loaded lazily (and may fail with `unavailable`). */
  static async open(name: string, sqlite: Pick<ExpoSqliteModule, 'openDatabaseAsync'> = loadExpoSqlite()): Promise<ExpoSqliteDriver> {
    return new ExpoSqliteDriver(await sqlite.openDatabaseAsync(name));
  }

  exec(sql: string) {
    return this.db.execAsync(sql);
  }
  async run(sql: string, params: SqlValue[] = []): Promise<RunResult> {
    const r = await this.db.runAsync(sql, params);
    return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
  }
  all<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []) {
    return this.db.getAllAsync<T>(sql, params);
  }
  close() {
    return this.db.closeAsync();
  }
  /** Raw handle for the backup strategy only. */
  get raw() {
    return this.db;
  }
}
