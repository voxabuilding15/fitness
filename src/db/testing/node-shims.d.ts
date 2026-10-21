/**
 * Minimal ambient typings for the Node built-ins used by the test adapter and tests.
 * Declared locally (instead of adding @types/node to the whole project) so Node globals do not leak
 * into app code and the test-only modules stay isolated in src/db/testing.
 */
declare module 'node:sqlite' {
  export interface StatementSync {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...params: unknown[]): Record<string, unknown>[];
  }
  export class DatabaseSync {
    constructor(path: string, options?: { enableForeignKeyConstraints?: boolean; open?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
  export function existsSync(path: string): boolean;
  export function copyFileSync(src: string, dest: string): void;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string): { length: number; toString(enc?: string): string };
  export function writeFileSync(path: string, data: string): void;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
