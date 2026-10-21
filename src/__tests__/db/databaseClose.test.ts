import { LATEST_VERSION } from '../../db/migrations';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../../db/database';
import { createDatabaseInitializer } from '../../db/initDatabase';
import type { RunResult, SqlDriver, SqlValue } from '../../db/sqlDatabase';
import { NodeFileBackupStrategy } from '../../db/testing/nodeFileBackup';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { DbError } from '../../domain/errors';

/** A real driver wrapped so failures can be injected and every call is recorded in order. */
class InjectedDriver implements SqlDriver {
  events: string[] = [];
  closeCalls = 0;
  failRollback = false;
  failCloseTimes = 0;
  failWhen: RegExp | null = null;
  private closedForReal = false;
  constructor(private inner = new NodeSqliteDriver()) {}
  private note(sql: string) { const m = /^(BEGIN|COMMIT|ROLLBACK)/.exec(sql); if (m) this.events.push(m[1]); }
  async exec(sql: string) {
    this.note(sql);
    if (this.closedForReal) throw new Error('driver is closed');
    if (this.failRollback && /^ROLLBACK/.test(sql)) throw new Error('disk I/O error');
    if (this.failWhen?.test(sql)) throw new Error('injected failure');
    return this.inner.exec(sql);
  }
  run(sql: string, p?: SqlValue[]): Promise<RunResult> { if (this.closedForReal) throw new Error('driver is closed'); return this.inner.run(sql, p); }
  async all<T>(sql: string, p?: SqlValue[]) { if (this.closedForReal) throw new Error('driver is closed'); return this.inner.all<T>(sql, p); }
  async close() {
    this.closeCalls++;
    this.events.push('DRIVER.CLOSE');
    if (this.failCloseTimes > 0) { this.failCloseTimes--; throw new Error('close failed'); }
    this.closedForReal = true;
    return this.inner.close();
  }
}
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => (open = r)); return { p, open }; };
const kind = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof DbError ? e.appError.kind : `non-DbError:${e}`));
const reason = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof DbError ? (e.appError as { reason?: string }).reason : String(e)));

async function open(driver: InjectedDriver, queueTimeoutMs = 200) {
  const db = await Database.open(driver, { queueTimeoutMs });
  await db.exec('CREATE TABLE t(x INTEGER)');
  return db;
}

describe('F5: close() after a failed ROLLBACK (poisoned connection)', () => {
  it('releases the driver exactly once instead of rejecting and leaking it', async () => {
    const d = new InjectedDriver();
    const db = await open(d);
    d.failRollback = true;
    await db.transaction(async () => { throw new Error('boom'); }).catch(() => undefined);
    expect(await reason(db.run('INSERT INTO t VALUES (1)'))).toBe('rollback_failed'); // poisoned: ordinary operations are refused
    await expect(db.close()).resolves.toBeUndefined();
    expect(d.closeCalls).toBe(1);
    expect(await reason(db.all('SELECT 1'))).toBe('database_closed');
    await expect(db.close()).resolves.toBeUndefined(); // idempotent
    expect(d.closeCalls).toBe(1);
  });
  it('the initializer closes a connection poisoned during a failed migration (no leak), and reports unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fitness-f5-'));
    try {
      const d = new InjectedDriver(new NodeSqliteDriver(join(dir, 'fitness.db')));
      d.failWhen = new RegExp(`PRAGMA user_version = ${LATEST_VERSION}`); // makes the upgrade transaction fail...
      d.failRollback = true; // ...and the ROLLBACK fail too
      const r = await createDatabaseInitializer({ open: async () => ({ driver: d, backup: new NodeFileBackupStrategy(dir) }) }).get();
      expect(r.status).toBe('unavailable');
      expect(d.closeCalls).toBe(1); // before the fix: close() rejected and the driver was never closed
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('F5: close() while a transaction is active', () => {
  it('if the transaction outlasts the wait, close() rejects `busy`, does NOT close the driver, and the transaction commits normally', async () => {
    const d = new InjectedDriver();
    const db = await open(d, 40);
    const g = gate();
    const tx = db.transaction(async (t) => { await t.run('INSERT INTO t VALUES (1)'); await g.p; await t.run('INSERT INTO t VALUES (2)'); });
    await new Promise((r) => setTimeout(r, 5));
    expect(await kind(db.close())).toBe('busy');
    expect(d.closeCalls).toBe(0); // before the fix: the driver was closed mid-transaction
    g.open();
    await tx;
    expect(d.events.filter((e) => /BEGIN|COMMIT|ROLLBACK|DRIVER/.test(e))).toEqual(['BEGIN', 'COMMIT']); // BEGIN IMMEDIATE .. COMMIT, no ROLLBACK, no close
    expect((await db.all<{ c: number }>('SELECT count(*) c FROM t'))[0].c).toBe(2);
    await db.close(); // once the work is done, closing succeeds
    expect(d.events.slice(-2)).toEqual(['COMMIT', 'DRIVER.CLOSE']);
  });
  it('if the transaction finishes within the wait, close() waits for the COMMIT and only then closes', async () => {
    const d = new InjectedDriver();
    const db = await open(d, 500);
    const g = gate();
    const tx = db.transaction(async (t) => { await t.run('INSERT INTO t VALUES (1)'); await g.p; });
    await new Promise((r) => setTimeout(r, 5));
    const closing = db.close();
    setTimeout(g.open, 20);
    await tx;
    await closing;
    expect(d.events.filter((e) => /BEGIN|COMMIT|ROLLBACK|DRIVER/.test(e))).toEqual(['BEGIN', 'COMMIT', 'DRIVER.CLOSE']);
    expect(d.closeCalls).toBe(1);
  });
  it('operations and transactions queued BEHIND a close fail cleanly and never touch the closed driver', async () => {
    const d = new InjectedDriver();
    const db = await open(d, 500);
    const g = gate();
    const tx = db.transaction(async () => { await g.p; });
    await new Promise((r) => setTimeout(r, 5));
    const closing = db.close();
    const lateRead = kind(db.all('SELECT 1'));
    const lateTx = kind(db.transaction(async () => undefined));
    g.open();
    await tx; await closing;
    expect(await lateRead).toBe('unavailable');
    expect(await lateTx).toBe('unavailable');
    expect(d.events.filter((e) => e === 'BEGIN')).toHaveLength(1); // the queued transaction never issued BEGIN on a closed driver
  });
  it('a transaction callback that ignores the lock cannot make close() hang: it times out as busy', async () => {
    const d = new InjectedDriver();
    const db = await open(d, 30);
    db.transaction(() => new Promise(() => undefined)).catch(() => undefined); // never settles
    await new Promise((r) => setTimeout(r, 5));
    expect(await kind(db.close())).toBe('busy');
    expect(d.closeCalls).toBe(0);
  });
});

describe('F5: failure and repetition of close() itself', () => {
  it('if the driver fails to close, close() rejects, the connection stays refused, and a retry can finish the job', async () => {
    const d = new InjectedDriver();
    const db = await open(d);
    d.failCloseTimes = 1;
    expect(await kind(db.close())).toBe('unknown');
    expect(await reason(db.all('SELECT 1'))).toBe('close_failed'); // not usable, not silently "closed"
    await expect(db.close()).resolves.toBeUndefined(); // retry
    expect(d.closeCalls).toBe(2);
    expect(await reason(db.all('SELECT 1'))).toBe('database_closed');
  });
  it('concurrent close() calls close the driver once', async () => {
    const d = new InjectedDriver();
    const db = await open(d);
    await Promise.all([db.close(), db.close(), db.close()]);
    expect(d.closeCalls).toBe(1);
  });
  it('close() never throws synchronously (always a promise), even on a poisoned connection', async () => {
    const d = new InjectedDriver();
    const db = await open(d);
    d.failRollback = true;
    await db.transaction(async () => { throw new Error('x'); }).catch(() => undefined);
    let p: Promise<void> | undefined;
    expect(() => { p = db.close(); }).not.toThrow();
    await p;
  });
});
