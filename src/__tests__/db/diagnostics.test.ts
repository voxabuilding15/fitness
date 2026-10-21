import { reportDbInitFailure, summarizeInitFailure } from '../../db/diagnostics';
import type { AppError } from '../../domain/errors';

const g = globalThis as { __DEV__?: boolean };
const original = g.__DEV__;
afterEach(() => {
  g.__DEV__ = original;
});

describe('summarizeInitFailure', () => {
  it('keeps only structural fields', () => {
    expect(summarizeInitFailure({ kind: 'db_too_new', found: 9, supported: 6 })).toEqual({ kind: 'db_too_new', found: 9, supported: 6 });
    expect(summarizeInitFailure({ kind: 'unavailable', reason: 'native_module_missing' })).toEqual({ kind: 'unavailable', reason: 'native_module_missing' });
  });

  it('never includes free-text messages, SQL or values', () => {
    const errs = [
      { kind: 'unknown', message: 'weight 82.5 for ahmed@example.com' },
      { kind: 'backup_failed', message: '/var/mobile/Documents/SQLite/fitness.db' },
      { kind: 'migration', version: 3, message: 'INSERT INTO profile VALUES (Ahmed, 82.5)' },
    ] as unknown as AppError[];
    for (const e of errs) {
      const s = JSON.stringify(summarizeInitFailure(e));
      expect(s).not.toMatch(/ahmed|82\.5|INSERT|\/var|fitness\.db/i);
    }
    expect(summarizeInitFailure(errs[2])).toEqual({ kind: 'migration', version: 3 });
  });

  it('drops a reason that is not a short snake_case code', () => {
    const e = { kind: 'unavailable', reason: 'Ahmed weighs 82.5 kg' } as unknown as AppError;
    expect(summarizeInitFailure(e)).toEqual({ kind: 'unavailable' });
  });
});

describe('reportDbInitFailure', () => {
  const err: AppError = { kind: 'unavailable', reason: 'native_module_missing' };

  it('logs a sanitized summary in development', () => {
    g.__DEV__ = true;
    const log = jest.fn();
    reportDbInitFailure(err, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[db] initialization failed', { kind: 'unavailable', reason: 'native_module_missing' });
  });

  it('logs nothing in production', () => {
    g.__DEV__ = false;
    const log = jest.fn();
    reportDbInitFailure(err, log);
    expect(log).not.toHaveBeenCalled();
  });
});
