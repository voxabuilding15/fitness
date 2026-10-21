/* eslint-disable @typescript-eslint/no-require-imports -- the tests must re-require modules after jest.resetModules() to exercise import-time behaviour */
/**
 * F2: a missing expo-sqlite native module must produce a typed `unavailable` result, not a crash at import time.
 * The "working module" cases use a FAKE expo-sqlite API backed by Node SQLite; they prove the wiring only, NOT the
 * behaviour of the real Expo SQLite native implementation.
 */
import { NodeSqliteDriver } from '../../db/testing/nodeSqliteDriver';

const throwing = () => {
  throw new Error('Cannot find native module ExpoSQLite /private/path/secret');
};

const fakeExpoSqlite = () => ({
  openDatabaseAsync: async () => {
    const d = new NodeSqliteDriver();
    return {
      execAsync: (sql: string) => d.exec(sql),
      runAsync: (sql: string, p: never[]) => d.run(sql, p),
      getAllAsync: (sql: string, p: never[]) => d.all(sql, p),
      closeAsync: () => d.close(),
    };
  },
});

afterEach(() => {
  jest.resetModules();
  jest.dontMock('expo-sqlite');
});

describe('lazy expo-sqlite loading (missing native module)', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('expo-sqlite', throwing);
  });

  it('importing the app database module does not throw', () => {
    expect(() => require('../../db/appDatabase')).not.toThrow();
    expect(() => require('../../db/expoSqliteDriver')).not.toThrow();
    expect(() => require('../../db/expoBackup')).not.toThrow();
  });

  it('loadExpoSqlite throws a typed unavailable error without leaking the raw message', () => {
    const { loadExpoSqlite } = require('../../db/expoSqliteModule');
    let caught: { appError?: unknown } | undefined;
    try {
      loadExpoSqlite();
    } catch (e) {
      caught = e as { appError?: unknown };
    }
    expect(caught?.appError).toEqual({ kind: 'unavailable', reason: 'native_module_missing' });
    expect(JSON.stringify(caught?.appError)).not.toContain('secret');
  });

  it('getAppDatabase resolves unavailable instead of rejecting, and a retry resolves too', async () => {
    const { getAppDatabase, retryAppDatabase } = require('../../db/appDatabase');
    await expect(getAppDatabase()).resolves.toEqual({
      status: 'unavailable',
      error: { kind: 'unavailable', reason: 'native_module_missing' },
    });
    await expect(retryAppDatabase()).resolves.toMatchObject({ status: 'unavailable' });
  });
});

describe('lazy expo-sqlite loading (fake working module, wiring only)', () => {
  it('createAppDatabaseInitializer reaches ready through the driver and caches the loaded module', async () => {
    jest.resetModules();
    jest.doMock('expo-sqlite', fakeExpoSqlite);
    const { createAppDatabaseInitializer } = require('../../db/appDatabase');
    const { loadExpoSqlite } = require('../../db/expoSqliteModule');
    expect(loadExpoSqlite()).toBe(loadExpoSqlite());
    const r = await createAppDatabaseInitializer().get();
    expect(r.status).toBe('ready');
    await r.db.close();
  });

  it('an injected loader failure maps to unavailable', async () => {
    const { createAppDatabaseInitializer } = require('../../db/appDatabase');
    const { DbError } = require('../../domain/errors');
    const r = await createAppDatabaseInitializer(() => {
      throw new DbError({ kind: 'unavailable', reason: 'native_module_missing' });
    }).get();
    expect(r).toEqual({ status: 'unavailable', error: { kind: 'unavailable', reason: 'native_module_missing' } });
  });
});
