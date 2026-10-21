import type { DbInitResult } from './initDatabase';

/**
 * Web build: the database is intentionally NOT available (expo-sqlite on web needs WebAssembly assets and
 * cross-origin isolation, and the product targets iOS/Android). Everything that does not need the database still works.
 */
const result: DbInitResult = { status: 'unavailable', error: { kind: 'unavailable', reason: 'web_unsupported' } };

export const getAppDatabase = async () => result;
export const retryAppDatabase = async () => result;
/** There is no database on web, so there is nothing to import into. */
export const getLegacyImportResult = (): null => null;
