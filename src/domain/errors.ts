/** Every failure the data layer can report. The UI maps `kind` to a translated message. */
export type AppError =
  | { kind: 'validation'; issues: Record<string, string> }
  | { kind: 'not_found'; entity: string }
  | { kind: 'constraint'; constraint: 'unique' | 'foreign_key' | 'check' | 'not_null'; message: string }
  | { kind: 'conflict'; reason: 'active_session' }
  | { kind: 'invalid_transition'; from: string; to: string; reason: string }
  | { kind: 'immutable'; reason: string }
  | { kind: 'db_too_new'; found: number; supported: number }
  | { kind: 'migration'; version: number; message: string }
  | { kind: 'backup_failed'; message: string }
  | { kind: 'busy'; message: string }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'legacy_data_invalid'; key: string }
  | { kind: 'unknown'; message: string };

export type AppErrorKind = AppError['kind'];

/** Translation key (present in both locales) for each error kind. */
export const ERROR_MESSAGE_KEYS: Record<AppErrorKind, string> = {
  validation: 'errors.validation',
  not_found: 'errors.notFound',
  constraint: 'errors.constraint',
  conflict: 'errors.conflict',
  invalid_transition: 'errors.invalidTransition',
  immutable: 'errors.immutable',
  db_too_new: 'errors.dbTooNew',
  migration: 'errors.migration',
  backup_failed: 'errors.backupFailed',
  busy: 'errors.busy',
  unavailable: 'errors.unavailable',
  legacy_data_invalid: 'errors.legacyDataInvalid',
  unknown: 'errors.unknown',
};

export const errorMessageKey = (e: AppError) => ERROR_MESSAGE_KEYS[e.kind];

/** Thrown inside the data layer; repositories convert it into a `Result`. */
export class DbError extends Error {
  constructor(public readonly appError: AppError) {
    super(`${appError.kind}: ${JSON.stringify(appError)}`);
    this.name = 'DbError';
  }
}
