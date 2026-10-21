import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppError } from '../domain/errors';
import type { Repositories } from '../domain/repositories';
import { getAppDatabase, getLegacyImportResult, retryAppDatabase } from '../db/appDatabase';
import { reportDbInitFailure } from '../db/diagnostics';

type DatabaseState =
  | { status: 'loading' }
  /** `legacyError`: the old profile could not be read (it was left untouched); null when the import was fine or not needed. */
  | { status: 'ready'; repos: Repositories; legacyError: AppError | null }
  | { status: 'unavailable'; error: AppError };

interface DatabaseContextValue {
  state: DatabaseState;
  retry: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue>({ state: { status: 'loading' }, retry: () => undefined });

/**
 * Starts the database in the background. It never blocks rendering and never throws: while loading, or if the
 * database is unavailable, the rest of the app (which does not use it yet) behaves exactly as before.
 */
export function DatabaseProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DatabaseState>({ status: 'loading' });

  const load = useCallback((fn: typeof getAppDatabase) => {
    let cancelled = false;
    fn().then((r) => {
      if (r.status === 'unavailable') reportDbInitFailure(r.error); // dev builds only; a sanitized summary, never user data
      if (cancelled) return;
      const legacy = getLegacyImportResult();
      setState(r.status === 'ready' ? { status: 'ready', repos: r.repos, legacyError: legacy && !legacy.ok ? legacy.error : null } : { status: 'unavailable', error: r.error });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(getAppDatabase), [load]);
  const retry = useCallback(() => {
    setState({ status: 'loading' });
    load(retryAppDatabase);
  }, [load]);

  const value = useMemo(() => ({ state, retry }), [state, retry]);
  return <DatabaseContext.Provider value={value}>{children}</DatabaseContext.Provider>;
}

export const useDatabase = () => useContext(DatabaseContext);
