import { DatabaseSync } from 'node:sqlite';
import type { RunResult, SqlDriver, SqlValue } from '../sqlDatabase';

/**
 * TEST-ONLY driver backed by Node's built-in SQLite. Never import this from app code (ESLint enforces it).
 * It deliberately starts with foreign keys OFF (node:sqlite would default them ON) so that tests exercise the
 * same "enable and verify" path as production, where expo-sqlite leaves them OFF.
 */
export class NodeSqliteDriver implements SqlDriver {
  private db: DatabaseSync | null;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  }
  private get h() {
    if (!this.db) throw new Error('NodeSqliteDriver: closed');
    return this.db;
  }
  async exec(sql: string) {
    this.h.exec(sql);
  }
  async run(sql: string, params: SqlValue[] = []): Promise<RunResult> {
    const r = this.h.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
  }
  async all<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []) {
    return this.h.prepare(sql).all(...params) as T[];
  }
  async close() {
    this.db?.close();
    this.db = null;
  }
}
