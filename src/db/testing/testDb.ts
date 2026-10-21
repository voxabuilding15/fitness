import { Database, type DatabaseOptions } from '../database';
import { runMigrations } from '../migrations/runner';
import { NodeSqliteDriver } from './nodeSqliteDriver';

/** A fresh, fully migrated in-memory database (TEST-ONLY). */
export async function createTestDb(opts?: DatabaseOptions): Promise<Database> {
  const db = await Database.open(new NodeSqliteDriver(), opts);
  const r = await runMigrations(db);
  if (!r.ok) throw new Error(`test database failed to migrate: ${JSON.stringify(r.error)}`);
  return db;
}

/** Opens (or creates) a file-backed database and migrates it (TEST-ONLY; used for persistence tests). */
export async function openFileTestDb(path: string, opts?: DatabaseOptions): Promise<Database> {
  const db = await Database.open(new NodeSqliteDriver(path), opts);
  const r = await runMigrations(db);
  if (!r.ok) throw new Error(`test database failed to migrate: ${JSON.stringify(r.error)}`);
  return db;
}
