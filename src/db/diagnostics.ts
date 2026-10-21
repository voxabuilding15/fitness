import type { AppError } from '../domain/errors';

/** Development builds only. React Native defines `__DEV__`; anything else (tests, web) is treated as development unless it is explicitly false. */
const isDev = () => typeof __DEV__ === 'undefined' || __DEV__ === true;

const SAFE_REASON = /^[a-z_]{1,40}$/;

/**
 * A summary of an initialization failure that is safe to print: the error KIND plus a few structural fields (a fixed
 * reason code, schema versions, the constraint type). It never includes free-text messages, SQL, file paths or any
 * stored/user-entered value, so it cannot leak profile, nutrition, weight or other personal data.
 */
export function summarizeInitFailure(error: AppError): Record<string, string | number> {
  const out: Record<string, string | number> = { kind: error.kind };
  switch (error.kind) {
    case 'unavailable':
    case 'conflict':
    case 'immutable':
    case 'invalid_transition':
      if (SAFE_REASON.test(error.reason)) out.reason = error.reason;
      break;
    case 'db_too_new':
      out.found = error.found;
      out.supported = error.supported;
      break;
    case 'migration':
      out.version = error.version;
      break;
    case 'constraint':
      out.constraint = error.constraint;
      break;
    default:
      break; // backup_failed, busy, unknown, validation, ...: kind only (their messages are never logged)
  }
  return out;
}

/** Logs a failed database initialization in development builds only. No-op in production. */
export function reportDbInitFailure(error: AppError, log: (...args: unknown[]) => void = console.warn): void {
  if (!isDev()) return;
  log('[db] initialization failed', summarizeInitFailure(error));
}
