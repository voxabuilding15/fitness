/**
 * Dates are stored as a UTC timestamp plus a `local_date` (YYYY-MM-DD) used to group a user's day.
 * Conversion is a pure function of (timestamp, UTC offset in minutes) so it can be tested for any zone/DST case.
 */
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function toLocalDate(ms: number, utcOffsetMinutes: number): string {
  const d = new Date(ms + utcOffsetMinutes * 60_000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The device's UTC offset at the given instant (east of UTC is positive, DST included). */
export const deviceUtcOffsetMinutes = (ms: number) => -new Date(ms).getTimezoneOffset();

export const deviceLocalDate = (ms: number) => toLocalDate(ms, deviceUtcOffsetMinutes(ms));

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for real calendar dates (rejects 2026-02-30, 2026-13-01, 2026-2-3 ...). */
export function isValidLocalDate(s: string): boolean {
  if (!SHAPE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDays(localDate: string, days: number): string {
  const [y, m, d] = localDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
