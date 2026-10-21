import { ExpoBackupStrategy, type ExpoSqliteApi } from './expoBackup';
import { ExpoSqliteDriver } from './expoSqliteDriver';
import { loadExpoSqlite, type ExpoSqliteModule } from './expoSqliteModule';
import { createDatabaseInitializer } from './initDatabase';

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

/** The app's single database initializer (iOS / Android). See appDatabase.web.ts for the web build. */
const initializer = createAppDatabaseInitializer();

export const getAppDatabase = () => initializer.get();
export const retryAppDatabase = () => initializer.retry();
