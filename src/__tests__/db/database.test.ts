import { Database } from '../../db/database';
import { mapDbError } from '../../db/mapDbError';
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';
import { DbError } from '../../domain/errors';
import type { RunResult, SqlDriver, SqlValue } from '../../db/sqlDatabase';

const DDL = `CREATE TABLE parent(id INTEGER PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE);
CREATE TABLE child(id INTEGER PRIMARY KEY NOT NULL, parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE RESTRICT, n INTEGER NOT NULL CHECK(n>=0));
CREATE TABLE counter(id INTEGER PRIMARY KEY, v INTEGER NOT NULL); INSERT INTO counter VALUES (1,0);`;

async function open(opts?: { queueTimeoutMs?: number }) {
  const db = await Database.open(new NodeSqliteDriver(), opts);
  await db.exec(DDL);
  return db;
}
const gate = () => {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
};
const kindOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'no error';
  } catch (e) {
    return e instanceof DbError ? e.appError.kind : `non-DbError: ${String(e)}`;
  }
};

/** Wraps a real driver so individual behaviours can be sabotaged. */
class FaultyDriver implements SqlDriver {
  ignoreForeignKeyPragma = false;
  failRollback = false;
  forceForeignKeysReadAs: number | null = null;
  closed = false;
  constructor(private inner = new NodeSqliteDriver()) {}
  async exec(sql: string) {
    if (this.ignoreForeignKeyPragma && /PRAGMA foreign_keys\s*=\s*ON/i.test(sql)) return;
    if (this.failRollback && /^ROLLBACK/i.test(sql)) throw new Error('disk I/O error');
    return this.inner.exec(sql);
  }
  run(sql: string, p?: SqlValue[]): Promise<RunResult> {
    return this.inner.run(sql, p);
  }
  async all<T>(sql: string, p?: SqlValue[]) {
    if (this.forceForeignKeysReadAs !== null && /^PRAGMA foreign_keys$/i.test(sql)) return [{ foreign_keys: this.forceForeignKeysReadAs }] as T[];
    return this.inner.all<T>(sql, p);
  }
  async close() {
    this.closed = true;
    return this.inner.close();
  }
}

describe('Database: foreign keys are enabled AND verified on the connection in use', () => {
  it('the test driver really starts with FKs off (so the enable path is exercised)', async () => {
    const raw = new NodeSqliteDriver();
    expect((await raw.all<{ foreign_keys: number }>('PRAGMA foreign_keys'))[0].foreign_keys).toBe(0);
  });
  it('open() turns them on and reads the value back', async () => {
    const driver = new NodeSqliteDriver();
    const db = await Database.open(driver);
    expect((await db.first<{ foreign_keys: number }>('PRAGMA foreign_keys'))?.foreign_keys).toBe(1);
  });
  it('open() refuses to continue (and closes the connection) if FKs cannot be enforced', async () => {
    const driver = new FaultyDriver();
    driver.ignoreForeignKeyPragma = true;
    await expect(Database.open(driver)).rejects.toMatchObject({ appError: { kind: 'unavailable', reason: 'foreign_keys_not_enforced' } });
    expect(driver.closed).toBe(true);
  });
  it('enforces FKs for plain statements', async () => {
    const db = await open();
    expect(await kindOf(db.run('INSERT INTO child(parent_id,n) VALUES (99,1)'))).toBe('constraint');
    await expect(db.run('INSERT INTO child(parent_id,n) VALUES (99,1)')).rejects.toMatchObject({ appError: { constraint: 'foreign_key' } });
  });
  it('enforces FKs INSIDE a transaction (the case expo-sqlite exclusive transactions would silently skip)', async () => {
    const db = await open();
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO child(parent_id,n) VALUES (99,1)');
      }),
    ).rejects.toMatchObject({ appError: { kind: 'constraint', constraint: 'foreign_key' } });
    await db.run("INSERT INTO parent(name) VALUES ('p')");
    await db.run('INSERT INTO child(parent_id,n) VALUES (1,1)');
    await expect(
      db.transaction(async (tx) => {
        await tx.run('DELETE FROM parent WHERE id=1'); // RESTRICT must fire inside the transaction too
      }),
    ).rejects.toMatchObject({ appError: { kind: 'constraint', constraint: 'foreign_key' } });
    expect((await db.first<{ c: number }>('SELECT count(*) c FROM parent'))?.c).toBe(1); // nothing was lost
  });
  it('RESTRICT blocks deleting a referenced parent', async () => {
    const db = await open();
    await db.run("INSERT INTO parent(name) VALUES ('p')");
    await db.run('INSERT INTO child(parent_id,n) VALUES (1,1)');
    await expect(db.run('DELETE FROM parent WHERE id=1')).rejects.toMatchObject({ appError: { constraint: 'foreign_key' } });
  });
  it('a transaction re-checks the pragma at start and refuses to run (no writes) if it is not ON', async () => {
    const driver = new FaultyDriver();
    const db = await Database.open(driver);
    await db.exec(DDL);
    driver.forceForeignKeysReadAs = 0;
    let ran = false;
    await expect(
      db.transaction(async () => {
        ran = true;
      }),
    ).rejects.toMatchObject({ appError: { kind: 'unavailable', reason: 'foreign_keys_not_enforced' } });
    expect(ran).toBe(false);
    driver.forceForeignKeysReadAs = null;
    await expect(db.run("INSERT INTO parent(name) VALUES ('after')")).resolves.toBeDefined(); // BEGIN was rolled back, connection usable
  });
});

describe('Database: transactions are atomic', () => {
  it('commits all statements together', async () => {
    const db = await open();
    await db.transaction(async (tx) => {
      await tx.run("INSERT INTO parent(name) VALUES ('a')");
      await tx.run("INSERT INTO parent(name) VALUES ('b')");
    });
    expect((await db.first<{ c: number }>('SELECT count(*) c FROM parent'))?.c).toBe(2);
  });
  it('rolls back everything (rows and user_version) when a later statement fails', async () => {
    const db = await open();
    await db.exec('PRAGMA user_version = 1');
    await expect(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO parent(name) VALUES ('a')");
        await tx.exec('PRAGMA user_version = 2');
        await tx.run("INSERT INTO parent(name) VALUES ('a')"); // UNIQUE violation
      }),
    ).rejects.toMatchObject({ appError: { constraint: 'unique' } });
    expect((await db.first<{ c: number }>('SELECT count(*) c FROM parent'))?.c).toBe(0);
    expect((await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(1);
  });
  it('rolls back when the callback throws a non-SQL error, and rethrows it as a DbError', async () => {
    const db = await open();
    const e = await db
      .transaction(async (tx) => {
        await tx.run("INSERT INTO parent(name) VALUES ('x')");
        throw new Error('boom');
      })
      .catch((x) => x);
    expect(e).toBeInstanceOf(DbError);
    expect(e.appError).toEqual({ kind: 'unknown', message: 'boom' });
    expect((await db.first<{ c: number }>('SELECT count(*) c FROM parent'))?.c).toBe(0);
  });
  it('the connection stays usable after a rollback', async () => {
    const db = await open();
    await db.transaction(async () => {
      throw new Error('x');
    }).catch(() => undefined);
    await db.run("INSERT INTO parent(name) VALUES ('ok')");
    expect((await db.first<{ c: number }>('SELECT count(*) c FROM parent'))?.c).toBe(1);
  });
  it('a failed ROLLBACK poisons the connection instead of risking partial writes', async () => {
    const driver = new FaultyDriver();
    const db = await Database.open(driver);
    await db.exec(DDL);
    driver.failRollback = true;
    await db.transaction(async () => {
      throw new Error('x');
    }).catch(() => undefined);
    await expect(db.run("INSERT INTO parent(name) VALUES ('z')")).rejects.toMatchObject({ appError: { kind: 'unavailable', reason: 'rollback_failed' } });
  });
  it('the tx handle cannot be used after the transaction ended', async () => {
    const db = await open();
    let leaked!: Parameters<Parameters<Database['transaction']>[0]>[0];
    await db.transaction(async (tx) => {
      leaked = tx;
    });
    await expect(leaked.run("INSERT INTO parent(name) VALUES ('late')")).rejects.toMatchObject({ appError: { reason: 'transaction_closed' } });
  });
});

describe('Database: serialization, concurrency and queue timeout', () => {
  it('nothing interleaves with a running transaction', async () => {
    const db = await open();
    const g = gate();
    const log: string[] = [];
    const tx = db.transaction(async (t) => {
      await t.run("INSERT INTO parent(name) VALUES ('in-tx')");
      log.push('tx-inserted');
      await g.p;
      log.push('tx-finishing');
    });
    await new Promise((r) => setTimeout(r, 10));
    const outsider = db.run("INSERT INTO parent(name) VALUES ('outsider')").then(() => log.push('outsider-done'));
    await new Promise((r) => setTimeout(r, 30));
    expect(log).toEqual(['tx-inserted']); // outsider is still waiting
    expect(db.pending).toBe(1);
    g.open();
    await Promise.all([tx, outsider]);
    expect(log).toEqual(['tx-inserted', 'tx-finishing', 'outsider-done']);
  });
  it('concurrent read-modify-write transactions never lose an update', async () => {
    const db = await open();
    await Promise.all(
      Array.from({ length: 40 }, () =>
        db.transaction(async (tx) => {
          const row = await tx.first<{ v: number }>('SELECT v FROM counter WHERE id=1');
          await new Promise((r) => setTimeout(r, 1)); // yield, inviting interleaving
          await tx.run('UPDATE counter SET v=? WHERE id=1', [row!.v + 1]);
        }),
      ),
    );
    expect((await db.first<{ v: number }>('SELECT v FROM counter'))?.v).toBe(40);
  });
  it('concurrent plain writes all land, in FIFO order', async () => {
    const db = await open();
    await Promise.all(Array.from({ length: 25 }, (_, i) => db.run('INSERT INTO parent(name) VALUES (?)', [`p${i}`])));
    const rows = await db.all<{ name: string }>('SELECT name FROM parent ORDER BY id');
    expect(rows.map((r) => r.name)).toEqual(Array.from({ length: 25 }, (_, i) => `p${i}`));
  });
  it('an operation that waits longer than the queue timeout fails with `busy` and is never executed later', async () => {
    const db = await open({ queueTimeoutMs: 40 });
    const g = gate();
    const holder = db.transaction(async () => {
      await g.p;
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(await kindOf(db.run("INSERT INTO parent(name) VALUES ('late')"))).toBe('busy');
    g.open();
    await holder;
    expect((await db.first<{ c: number }>('SELECT count(*) c FROM parent'))?.c).toBe(0);
    await db.run("INSERT INTO parent(name) VALUES ('fine')"); // queue healthy afterwards
  });
  it('using `db` instead of `tx` inside a transaction cannot hang silently: it times out as busy and rolls back', async () => {
    const db = await open({ queueTimeoutMs: 40 });
    const result = db.transaction(async (tx) => {
      await tx.run("INSERT INTO parent(name) VALUES ('a')");
      await db.run("INSERT INTO parent(name) VALUES ('b')"); // would deadlock
    });
    await expect(result).rejects.toMatchObject({ appError: { kind: 'busy' } });
    expect((await db.first<{ c: number }>('SELECT count(*) c FROM parent'))?.c).toBe(0);
  });
  it('close() waits for in-flight work, then every later call is `unavailable`; closing twice is harmless', async () => {
    const db = await open();
    const g = gate();
    const tx = db.transaction(async (t) => {
      await t.run("INSERT INTO parent(name) VALUES ('a')");
      await g.p;
    });
    await new Promise((r) => setTimeout(r, 5));
    const closing = db.close();
    g.open();
    await tx;
    await closing;
    expect(await kindOf(db.all('SELECT 1'))).toBe('unavailable');
    await expect(db.close()).resolves.toBeUndefined();
  });
});

describe('mapDbError', () => {
  const m = (msg: string) => mapDbError(new Error(msg));
  it('maps SQLite constraint messages', () => {
    expect(m('UNIQUE constraint failed: parent.name')).toMatchObject({ kind: 'constraint', constraint: 'unique' });
    expect(m('FOREIGN KEY constraint failed')).toMatchObject({ constraint: 'foreign_key' });
    expect(m('NOT NULL constraint failed: x.y')).toMatchObject({ constraint: 'not_null' });
    expect(m('CHECK constraint failed: n>=0')).toMatchObject({ constraint: 'check' });
  });
  it('maps lock errors and unknown errors', () => {
    expect(m('database is locked').kind).toBe('busy');
    expect(m('SQLITE_BUSY')).toMatchObject({ kind: 'busy' });
    expect(m('disk I/O error')).toEqual({ kind: 'unknown', message: 'disk I/O error' });
    expect(mapDbError('plain string')).toEqual({ kind: 'unknown', message: 'plain string' });
  });
  it('maps our trigger codes', () => {
    expect(m('FITNESS_SEED_IMMUTABLE')).toMatchObject({ kind: 'immutable' });
    expect(m('FITNESS_SESSION_FROZEN')).toMatchObject({ kind: 'immutable' });
    expect(m('FITNESS_SESSION_TRANSITION')).toMatchObject({ kind: 'invalid_transition' });
    expect(m('FITNESS_SESSION_EMPTY')).toMatchObject({ kind: 'invalid_transition', reason: 'no_completed_sets' });
    expect(m('FITNESS_SET_TIME_RANGE')).toMatchObject({ kind: 'constraint' });
  });
  it('recognises the single-active-session index and passes DbError through', () => {
    expect(m('UNIQUE constraint failed: workout_sessions.status')).toEqual({ kind: 'conflict', reason: 'active_session' });
    const original = new DbError({ kind: 'busy', message: 'x' });
    expect(mapDbError(original)).toBe(original.appError);
  });
});
