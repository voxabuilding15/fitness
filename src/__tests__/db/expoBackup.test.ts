import { LATEST_VERSION } from '../../db/migrations';
import { copyFileSync, mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SQLiteDatabase } from 'expo-sqlite';
import { backupName } from '../../db/backup';
import { ExpoBackupStrategy, type ExpoSqliteApi } from '../../db/expoBackup';
import { Database } from '../../db/database';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';

/**
 * A FAKE of the expo-sqlite module backed by Node SQLite files. It lets us verify ExpoBackupStrategy's own safety
 * logic (fresh-destination check, no overwrite, cleanup rules). It does NOT prove the real native calls work.
 */
function fakeApi(dir: string, opts: { failBackup?: boolean; failDelete?: boolean } = {}) {
  const deleted: string[] = [];
  const open: string[] = [];
  const wrap = (name: string): SQLiteDatabase => {
    const d = new NodeSqliteDriver(join(dir, name));
    open.push(name);
    return {
      getAllAsync: (sql: string) => d.all(sql),
      closeAsync: async () => { await d.close(); open.splice(open.indexOf(name), 1); },
      __driver: d,
      __name: name,
    } as unknown as SQLiteDatabase;
  };
  const api: ExpoSqliteApi = {
    openDatabaseAsync: async (name) => wrap(name),
    backupDatabaseAsync: async ({ sourceDatabase, destDatabase }) => {
      if (opts.failBackup) throw new Error('backup exploded');
      const dst = (destDatabase as any).__name as string;
      await (sourceDatabase as any).__driver.all(`VACUUM INTO '${join(dir, dst)}.tmp'`);
      // emulate sqlite3_backup: destination content is REPLACED by the source
      await (destDatabase as any).__driver.close();
      copyFileSync(join(dir, `${dst}.tmp`), join(dir, dst));
      rmSync(join(dir, `${dst}.tmp`));
    },
    deleteDatabaseAsync: async (name) => {
      if (opts.failDelete) throw new Error('EBUSY');
      deleted.push(name);
      rmSync(join(dir, name), { force: true });
    },
  };
  return { api, deleted, open };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fitness-expo-bk-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function sourceDb() {
  const driver = new NodeSqliteDriver(join(dir, 'source.db'));
  await driver.exec("CREATE TABLE t(x TEXT); INSERT INTO t VALUES ('data'); PRAGMA user_version = 3;");
  const raw = { __driver: driver, __name: 'source.db' } as unknown as SQLiteDatabase;
  return { raw, db: await Database.open(new NodeSqliteDriver(':memory:')) };
}
const ctx = { fromVersion: 3, toVersion: LATEST_VERSION, timestamp: 1_800_000_000_000 };

describe('ExpoBackupStrategy (logic against a fake expo-sqlite API)', () => {
  it('creates a fresh backup, validates it, and closes every connection it opened', async () => {
    const { api, open } = fakeApi(dir);
    const { raw, db } = await sourceDb();
    const s = new ExpoBackupStrategy(api, raw);
    const rec = await s.create(db, ctx);
    expect(rec.name).toBe(backupName(ctx));
    await expect(s.validate(rec, { userVersion: 3 })).resolves.toBeUndefined();
    await expect(s.validate(rec, { userVersion: 4 })).rejects.toThrow(/wrong schema version/);
    expect(open).toEqual([]);
  });
  it('NEVER overwrites a destination that already contains data: it moves on to the next name', async () => {
    const { api } = fakeApi(dir);
    const { raw, db } = await sourceDb();
    const taken = new NodeSqliteDriver(join(dir, backupName(ctx)));
    await taken.exec("CREATE TABLE precious(x TEXT); INSERT INTO precious VALUES ('mine')");
    await taken.close();
    const rec = await new ExpoBackupStrategy(api, raw).create(db, ctx);
    expect(rec.name).toBe(backupName(ctx, 1));
    const check = new NodeSqliteDriver(join(dir, backupName(ctx)));
    expect(await check.all('SELECT x FROM precious')).toEqual([{ x: 'mine' }]);
    await check.close();
  });
  it('removes only its own half-written file when the backup call fails, and reports the failure', async () => {
    const { api, deleted } = fakeApi(dir, { failBackup: true });
    const { raw, db } = await sourceDb();
    await expect(new ExpoBackupStrategy(api, raw).create(db, ctx)).rejects.toThrow('backup exploded');
    expect(deleted).toEqual([backupName(ctx)]);
  });
  it('does not delete a pre-existing (non-fresh) file even when later attempts fail', async () => {
    const { api, deleted } = fakeApi(dir, { failBackup: true });
    const { raw, db } = await sourceDb();
    const taken = new NodeSqliteDriver(join(dir, backupName(ctx)));
    await taken.exec('CREATE TABLE precious(x TEXT)');
    await taken.close();
    await expect(new ExpoBackupStrategy(api, raw).create(db, ctx)).rejects.toThrow();
    expect(deleted).not.toContain(backupName(ctx)); // the existing backup was never touched
    expect(existsSync(join(dir, backupName(ctx)))).toBe(true);
  });
  it('validation rejects a corrupt file', async () => {
    const { api } = fakeApi(dir);
    const { raw } = await sourceDb();
    writeFileSync(join(dir, 'bad.db'), 'definitely not a database');
    await expect(new ExpoBackupStrategy(api, raw).validate({ name: 'bad.db' }, { userVersion: 3 })).rejects.toThrow();
  });
  it('prune deletes the given names and reports per-file failures without throwing', async () => {
    const ok = fakeApi(dir);
    const { raw } = await sourceDb();
    const a = 'fitness-premigrate-v1-to-v2-1001.db';
    const b = 'fitness-premigrate-v1-to-v2-1002.db';
    writeFileSync(join(dir, a), 'x');
    expect(await new ExpoBackupStrategy(ok.api, raw).prune([a])).toEqual({ removed: [a], failed: [] });
    const bad = fakeApi(dir, { failDelete: true });
    expect(await new ExpoBackupStrategy(bad.api, raw).prune([b])).toEqual({ removed: [], failed: [{ name: b, message: 'EBUSY' }] });
    expect(readFileSync(join(dir, 'source.db')).length).toBeGreaterThan(0);
  });
});
