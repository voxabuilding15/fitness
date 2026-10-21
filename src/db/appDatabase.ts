import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Clock } from '../domain/clock';
import { ExpoBackupStrategy, type ExpoSqliteApi } from './expoBackup';
import { ExpoSqliteDriver } from './expoSqliteDriver';
import { loadExpoSqlite, type ExpoSqliteModule } from './expoSqliteModule';
import { createDatabaseInitializer, type DbInitResult } from './initDatabase';
import type { ReadOnlyKeyValueStore } from './legacyImport';
import { createLegacyStartup } from './legacyStartup';

export const DATABASE_FILE = 'fitness.db';

/**
 * Builds the app's initializer. `load` is injectable for tests. Nothing here touches expo-sqlite until `open()` runs,
 * and `open()` runs inside the initializer's guard, so a missing native module yields `unavailable`, never a crash.
 */
export function createAppDatabaseInitializer(load: () => ExpoSqliteModule = loadExpoSqlite) {
  return createDatabaseInitializer({
    open: async () => {
      const sqlite = load();
      const driver = await ExpoSqliteDriver.open(DATABASE_FILE, sqlite);
      return { driver, backup: new ExpoBackupStrategy(sqlite as unknown as ExpoSqliteApi, driver.raw) };
    },
  });
}

/**
 * The app's database: the initializer plus the one-time import of the old AsyncStorage profile. `ready` is only reported
 * after the import has finished (or been ruled out), so every screen sees the imported profile. A failed or unreadable
 * import never makes the database unavailable; its result is available from `legacyResult()`.
 * `store` is read-only by type: nothing here can write to or delete AsyncStorage data.
 */
export function createAppDatabase(opts: { load?: () => ExpoSqliteModule; store?: ReadOnlyKeyValueStore; clock?: Clock } = {}) {
  const initializer = createAppDatabaseInitializer(opts.load);
  const legacy = createLegacyStartup(opts.store ?? { getItem: (key) => AsyncStorage.getItem(key) }, { clock: opts.clock });
  const afterInit = async (r: DbInitResult): Promise<DbInitResult> => {
    if (r.status === 'ready') await legacy.run(r.db);
    return r;
  };
  return {
    get: () => initializer.get().then(afterInit),
    retry: () => initializer.retry().then(afterInit),
    legacyResult: legacy.last,
  };
}

const appDatabase = createAppDatabase();

export const getAppDatabase = () => appDatabase.get();
export const retryAppDatabase = () => appDatabase.retry();
/** The result of the legacy profile import in this run (null before it ran). */
export const getLegacyImportResult = appDatabase.legacyResult;
