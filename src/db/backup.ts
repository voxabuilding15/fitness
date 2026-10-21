import type { Db } from './sqlDatabase';

export interface BackupRecord {
  name: string;
}
export interface BackupContext {
  fromVersion: number;
  toVersion: number;
  timestamp: number;
}
export interface PruneResult {
  removed: string[];
  failed: { name: string; message: string }[];
}

/**
 * Pre-migration safety copies. Implementations MUST:
 *  - `create`: never overwrite an existing backup (use a fresh destination or throw) and return a name that satisfies `isBackupName`;
 *  - `validate`: refuse names that fail `isBackupName`, then prove the copy is a readable SQLite database at the expected schema version;
 *  - `prune`: delete ONLY names that satisfy `isBackupName` (anything else is reported as failed, never touched),
 *    reporting (not throwing) per-file failures.
 */
export interface BackupStrategy {
  create(source: Db, ctx: BackupContext): Promise<BackupRecord>;
  validate(record: BackupRecord, expected: { userVersion: number }): Promise<void>;
  prune(names: string[]): Promise<PruneResult>;
}

export const MAX_BACKUP_NAME_ATTEMPTS = 50;

/**
 * The ONLY file names this app will ever treat as a backup. Backup names are read back from storage (the list lives in
 * the database itself) and handed to code that deletes files, so anything that is not exactly this shape is refused:
 * no path separators, no "..", no live-database name, no other extension, no unicode look-alikes, no trailing newline.
 */
export const BACKUP_NAME_PATTERN = /^fitness-premigrate-v[0-9]{1,6}-to-v[0-9]{1,6}-[0-9]{1,16}(-[0-9]{1,3})?\.db$/;
export const isBackupName = (name: unknown): name is string => typeof name === 'string' && name.length <= 80 && BACKUP_NAME_PATTERN.test(name);

export const MIN_KEEP_BACKUPS = 2; // the new backup plus the previous valid one
export const MAX_KEEP_BACKUPS = 10;
export const clampKeep = (n: number | undefined) => Math.min(MAX_KEEP_BACKUPS, Math.max(MIN_KEEP_BACKUPS, Math.trunc(Number.isFinite(n) ? (n as number) : 3)));

/** Reads the stored backup list defensively: only valid, unique names survive; everything else is counted and dropped. */
export function parseBackupList(raw: string | null | undefined): { names: string[]; ignored: number } {
  if (raw == null) return { names: [], ignored: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { names: [], ignored: 1 };
  }
  if (!Array.isArray(parsed)) return { names: [], ignored: 1 };
  const names: string[] = [];
  let ignored = 0;
  for (const entry of parsed) {
    if (isBackupName(entry) && !names.includes(entry)) names.push(entry);
    else ignored++;
  }
  return { names, ignored };
}

/** What a strategy reports when asked to delete something that is not a backup name. */
export const refusedPrune = (name: unknown) => ({ name: String(name).slice(0, 80), message: 'refused: not a backup file name' });

/** Unique by construction (versions + timestamp); `attempt` adds a suffix if that name is already taken. */
export const backupName = (ctx: BackupContext, attempt = 0) =>
  `fitness-premigrate-v${ctx.fromVersion}-to-v${ctx.toVersion}-${ctx.timestamp}${attempt ? `-${attempt}` : ''}.db`;

export const BACKUPS_META_KEY = 'premigrate_backups';
