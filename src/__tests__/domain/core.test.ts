import { addDays, deviceLocalDate, isValidLocalDate, toLocalDate } from '../../domain/dates';
import { DbError, ERROR_MESSAGE_KEYS, errorMessageKey, type AppErrorKind } from '../../domain/errors';
import { ManualClock, systemClock } from '../../domain/clock';
import { err, ok } from '../../domain/result';
import { canTransition, countsAsWorkout, isEditable, type SessionStatus } from '../../domain/sessionLifecycle';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';

describe('dates', () => {
  it('converts a UTC instant to the local day for different offsets', () => {
    const t = Date.UTC(2026, 9, 21, 23, 30); // 23:30 UTC
    expect(toLocalDate(t, 0)).toBe('2026-10-21');
    expect(toLocalDate(t, 60)).toBe('2026-10-22'); // Morocco-style +01:00 rolls into next day
    expect(toLocalDate(t, -300)).toBe('2026-10-21');
    expect(toLocalDate(Date.UTC(2026, 9, 21, 0, 10), -300)).toBe('2026-10-20');
  });
  it('handles a DST change by using the offset in force at that instant', () => {
    // Europe/Paris 2026-03-29: +01:00 before 01:00Z, +02:00 after. 23:30 local on the 28th is still the 28th.
    expect(toLocalDate(Date.UTC(2026, 2, 28, 22, 30), 60)).toBe('2026-03-28');
    expect(toLocalDate(Date.UTC(2026, 2, 28, 23, 30), 60)).toBe('2026-03-29');
    expect(toLocalDate(Date.UTC(2026, 2, 29, 21, 59), 120)).toBe('2026-03-29');
    expect(toLocalDate(Date.UTC(2026, 2, 29, 22, 0), 120)).toBe('2026-03-30');
  });
  it('handles year boundaries and leap days', () => {
    expect(toLocalDate(Date.UTC(2026, 11, 31, 23, 59), 0)).toBe('2026-12-31');
    expect(toLocalDate(Date.UTC(2026, 11, 31, 23, 59), 60)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('validates real calendar dates only', () => {
    for (const ok_ of ['2026-10-21', '2028-02-29', '2000-02-29']) expect(isValidLocalDate(ok_)).toBe(true);
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-10-32', '2026-2-3', '', '2026-10-21T10:00', ' 2026-10-21'])
      expect(isValidLocalDate(bad)).toBe(false);
  });
  it('deviceLocalDate agrees with the formatting of the same instant', () => {
    expect(deviceLocalDate(Date.now())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('clock, result, errors', () => {
  it('ManualClock only moves when told to', () => {
    const c = new ManualClock(1000);
    c.advance(500);
    expect(c.now()).toBe(1500);
    c.set(10);
    expect(c.now()).toBe(10);
    expect(Math.abs(systemClock.now() - Date.now())).toBeLessThan(50);
  });
  it('Result helpers', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err({ kind: 'busy', message: 'x' })).toEqual({ ok: false, error: { kind: 'busy', message: 'x' } });
  });
  it('DbError carries the AppError', () => {
    const e = new DbError({ kind: 'busy', message: 'locked' });
    expect(e).toBeInstanceOf(Error);
    expect(e.appError.kind).toBe('busy');
  });
  it('every error kind has a translation in both languages', () => {
    const get = (o: any, path: string) => path.split('.').reduce((a, p) => a?.[p], o);
    for (const kind of Object.keys(ERROR_MESSAGE_KEYS) as AppErrorKind[]) {
      expect(typeof get(en, ERROR_MESSAGE_KEYS[kind])).toBe('string');
      expect(typeof get(ar, ERROR_MESSAGE_KEYS[kind])).toBe('string');
    }
    expect(errorMessageKey({ kind: 'busy', message: '' })).toBe('errors.busy');
  });
});

describe('session lifecycle rules', () => {
  const all: SessionStatus[] = ['in_progress', 'completed', 'discarded'];
  it('permits exactly in_progress -> completed|discarded', () => {
    const allowed = all.flatMap((a) => all.filter((b) => canTransition(a, b)).map((b) => `${a}>${b}`));
    expect(allowed.sort()).toEqual(['in_progress>completed', 'in_progress>discarded']);
  });
  it('terminal states cannot move, including completed -> in_progress', () => {
    expect(canTransition('completed', 'in_progress')).toBe(false);
    expect(canTransition('discarded', 'completed')).toBe(false);
    expect(canTransition('in_progress', 'in_progress')).toBe(false);
  });
  it('only completed sessions count as workouts; discarded ones are frozen', () => {
    expect(all.filter(countsAsWorkout)).toEqual(['completed']);
    expect(all.filter(isEditable)).toEqual(['in_progress', 'completed']);
  });
});
