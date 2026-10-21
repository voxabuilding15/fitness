import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_BACKUP_NAME_ATTEMPTS, backupName, isBackupName, refusedPrune, type BackupContext, type BackupRecord, type BackupStrategy, type PruneResult } from '../backup';
import type { Db } from '../sqlDatabase';
import { NodeSqliteDriver } from './nodeSqliteDriver';

/** TEST-ONLY file-based backup using VACUUM INTO. Same contract as the Expo strategy. */
export class NodeFileBackupStrategy implements BackupStrategy {
  constructor(private readonly dir: string) {}

  async create(source: Db, ctx: BackupContext): Promise<BackupRecord> {
    for (let attempt = 0; attempt < MAX_BACKUP_NAME_ATTEMPTS; attempt++) {
      const name = backupName(ctx, attempt);
      const path = join(this.dir, name);
      if (existsSync(path)) continue; // never overwrite
      await source.run('VACUUM INTO ?', [path]);
      return { name };
    }
    throw new Error('could not find an unused backup name');
  }

  async validate(record: BackupRecord, expected: { userVersion: number }): Promise<void> {
    if (!isBackupName(record.name)) throw new Error('refusing to open a file that is not a backup name');
    const path = join(this.dir, record.name);
    if (!existsSync(path)) throw new Error('backup file is missing');
    const d = new NodeSqliteDriver(path);
    try {
      const check = await d.all<{ integrity_check: string }>('PRAGMA integrity_check');
      if (check.length !== 1 || check[0].integrity_check !== 'ok') throw new Error('backup failed integrity_check');
      const v = await d.all<{ user_version: number }>('PRAGMA user_version');
      if (Number(v[0]?.user_version) !== expected.userVersion) throw new Error('backup has the wrong schema version');
    } finally {
      await d.close();
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
        rmSync(join(this.dir, name));
        result.removed.push(name);
      } catch (e) {
        result.failed.push({ name, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return result;
  }
}
