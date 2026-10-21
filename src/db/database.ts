import { DbError } from '../domain/errors';
import { mapDbError } from './mapDbError';
import type { Db, RunResult, SqlDriver, SqlExecutor, SqlValue } from './sqlDatabase';

export interface DatabaseOptions {
  /** How long an operation may wait for its turn before failing with `busy` (no silent hangs). */
  queueTimeoutMs?: number;
}

const unavailable = (reason: string) => new DbError({ kind: 'unavailable', reason });

class Executor implements SqlExecutor {
  constructor(
    protected readonly driver: SqlDriver,
    protected readonly guard: () => void,
  ) {}
  async exec(sql: string) {
    this.guard();
    await this.run_(() => this.driver.exec(sql));
  }
  async run(sql: string, params: SqlValue[] = []): Promise<RunResult> {
    this.guard();
    return this.run_(() => this.driver.run(sql, params));
  }
  async all<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    this.guard();
    return this.run_(() => this.driver.all<T>(sql, params));
  }
  async first<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T | null> {
    const rows = await this.all<T>(sql, params);
    return rows[0] ?? null;
  }
  private async run_<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      throw new DbError(mapDbError(e));
    }
  }
}

/** Reads the pragma back from the connection that will be used. Throws unless it is really ON. */
async function readForeignKeys(driver: SqlDriver): Promise<number> {
  const rows = await driver.all<{ foreign_keys: number }>('PRAGMA foreign_keys');
  return Number(rows[0]?.foreign_keys ?? 0);
}

/**
 * One connection, one operation at a time.
 *
 * - Foreign keys are switched on and *read back* when opening, and re-checked at the start of every
 *   transaction. (SQLite's `PRAGMA foreign_keys` is per-connection and a silent no-op inside a transaction,
 *   and expo-sqlite never enables it, so it must be verified, not assumed.)
 * - All operations pass through a FIFO lock; a transaction holds the lock from BEGIN to COMMIT/ROLLBACK,
 *   so nothing can interleave with it.
 */
export class Database implements Db {
  private locked = false;
  private waiters: { grant: () => void; cancel: () => void }[] = [];
  private closed = false;
  private broken: string | null = null;
  private txActive = false;
  private readonly timeoutMs: number;
  private readonly plain: Executor;

  private constructor(
    private readonly driver: SqlDriver,
    opts: DatabaseOptions,
  ) {
    this.timeoutMs = opts.queueTimeoutMs ?? 10_000;
    this.plain = new Executor(driver, () => this.assertUsable());
  }

  static async open(driver: SqlDriver, opts: DatabaseOptions = {}): Promise<Database> {
    try {
      await driver.exec('PRAGMA foreign_keys = ON');
      if ((await readForeignKeys(driver)) !== 1) {
        throw unavailable('foreign_keys_not_enforced');
      }
      await driver.exec('PRAGMA busy_timeout = 5000');
      await driver.all('PRAGMA journal_mode = WAL'); // returns a row; 'memory' for in-memory DBs
    } catch (e) {
      try {
        await driver.close();
      } catch {
        /* ignore */
      }
      throw e instanceof DbError ? e : new DbError(mapDbError(e));
    }
    return new Database(driver, opts);
  }

  private assertUsable() {
    if (this.closed) throw unavailable('database_closed');
    if (this.broken) throw unavailable(this.broken);
  }

  /**
   * Waits for the connection's turn. `forClose` lets `close()` wait for in-flight work even on a connection that was
   * marked broken (a failed ROLLBACK), so such a connection can still be released instead of leaked.
   * Rejections are always promise rejections (never a synchronous throw).
   */
  private async acquire(opts: { forClose?: boolean } = {}): Promise<void> {
    if (this.closed) throw unavailable('database_closed');
    if (this.broken && !opts.forClose) throw unavailable(this.broken);
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        grant: () => {
          clearTimeout(timer);
          resolve();
        },
        cancel: () => {
          this.waiters = this.waiters.filter((w) => w !== entry);
          reject(new DbError({ kind: 'busy', message: `waited more than ${this.timeoutMs}ms for the database` }));
        },
      };
      const timer = setTimeout(entry.cancel, this.timeoutMs);
      this.waiters.push(entry);
    });
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next.grant(); // lock stays held and is handed to the next waiter in order
    else this.locked = false;
  }

  private async serial<T>(op: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await op();
    } finally {
      this.release();
    }
  }

  exec(sql: string) {
    return this.serial(() => this.plain.exec(sql));
  }
  run(sql: string, params?: SqlValue[]) {
    return this.serial(() => this.plain.run(sql, params));
  }
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]) {
    return this.serial(() => this.plain.all<T>(sql, params));
  }
  first<T = Record<string, unknown>>(sql: string, params?: SqlValue[]) {
    return this.serial(() => this.plain.first<T>(sql, params));
  }

  async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    await this.acquire();
    let began = false;
    try {
      this.assertUsable(); // the connection may have been closed (or poisoned) while this call was queued
      this.txActive = true;
      const tx = new Executor(this.driver, () => {
        if (!this.txActive) throw unavailable('transaction_closed');
      });
      try {
        await this.driver.exec('BEGIN IMMEDIATE');
        began = true;
        if ((await readForeignKeys(this.driver)) !== 1) throw unavailable('foreign_keys_not_enforced');
        const value = await fn(tx);
        await this.driver.exec('COMMIT');
        began = false;
        return value;
      } catch (e) {
        if (began) {
          try {
            await this.driver.exec('ROLLBACK');
          } catch {
            // The connection may still be inside a transaction: refuse further use rather than risk partial writes.
            this.broken = 'rollback_failed';
          }
        }
        throw e instanceof DbError ? e : new DbError(mapDbError(e));
      }
    } finally {
      this.txActive = false;
      this.release();
    }
  }

  /**
   * Releases the connection safely:
   *  - waits for in-flight work, including a running transaction (up to the queue timeout); if it cannot get its turn it
   *    rejects with `busy` and leaves the connection OPEN, so a transaction is never torn down underneath itself;
   *  - works on a connection poisoned by a failed ROLLBACK, so that connection is not leaked;
   *  - if the driver itself fails to close, the connection stays refused-but-closable and close() may be retried;
   *  - is idempotent and safe to call concurrently.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    await this.acquire({ forClose: true });
    try {
      if (this.closed) return; // a concurrent close() finished while this one was waiting
      try {
        await this.driver.close();
      } catch (e) {
        this.broken = 'close_failed';
        throw new DbError(mapDbError(e));
      }
      this.closed = true;
    } finally {
      this.release();
    }
  }

  /** Number of operations currently waiting for their turn (diagnostics / tests). */
  get pending() {
    return this.waiters.length;
  }
}
