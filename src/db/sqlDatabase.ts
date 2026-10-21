export type SqlValue = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

/**
 * The only thing a platform has to implement: one raw connection.
 * Serialization, transactions, foreign-key enforcement and error mapping live in `Database`,
 * so the same code runs against Expo SQLite (device) and node:sqlite (tests).
 */
export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  close(): Promise<void>;
}

export interface SqlExecutor {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T | null>;
}

export interface Db extends SqlExecutor {
  /** Runs `fn` atomically. Nothing else touches the connection until it commits or rolls back. */
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
