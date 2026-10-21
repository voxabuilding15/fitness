import type * as ExpoSqlite from 'expo-sqlite';
import { DbError } from '../domain/errors';

export type ExpoSqliteModule = typeof ExpoSqlite;

let cached: ExpoSqliteModule | undefined;

/**
 * The ONE place the app loads expo-sqlite at runtime, and it does so lazily.
 *
 * expo-sqlite's entry point is `requireNativeModule('ExpoSQLite')`, which THROWS when evaluated if the native module is
 * not part of the binary (for example a development build made before the dependency was added). A top-level
 * `import` of it on the app's startup path would turn that into a crash before any screen renders. Loading it here, inside
 * a function the initializer already guards, turns it into a typed `unavailable` result instead.
 */
export function loadExpoSqlite(): ExpoSqliteModule {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate lazy load (see above); an `import` would run at app start
    cached = require('expo-sqlite') as ExpoSqliteModule;
    return cached;
  } catch {
    throw new DbError({ kind: 'unavailable', reason: 'native_module_missing' }); // deliberately drops the raw error text
  }
}
