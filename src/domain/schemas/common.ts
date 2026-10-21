import { z } from 'zod';
import { err, ok, type Result } from '../result';
import { isValidLocalDate } from '../dates';

export const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const num = (min: number, max: number) => z.number().finite().min(min).max(max);
export const int = (min: number, max: number) => z.number().int().min(min).max(max);
export const id = z.number().int().positive();
export const localDate = z.string().refine(isValidLocalDate, { message: 'validation.invalidDate' });
/** Epoch milliseconds. */
export const timestamp = z.number().int().positive();

const valueAt = (data: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>((acc, k) => (acc !== null && typeof acc === 'object' ? (acc as Record<PropertyKey, unknown>)[k] : undefined), data);

/** Maps a Zod issue to one of our translation keys; the UI never sees raw Zod messages. */
function keyFor(issue: z.core.$ZodIssue, data: unknown): string {
  // Zod 4 does not echo the offending input, so "missing" is decided from the original data.
  if (valueAt(data, issue.path) === undefined && issue.code !== 'custom' && issue.code !== 'unrecognized_keys') return 'validation.required';
  switch (issue.code) {
    case 'too_small':
      return issue.origin === 'string' && Number(issue.minimum) <= 1 ? 'validation.required' : 'validation.outOfRange';
    case 'too_big':
      return issue.origin === 'string' ? 'validation.tooLong' : 'validation.outOfRange';
    case 'custom':
      return typeof issue.message === 'string' && issue.message.startsWith('validation.') ? issue.message : 'validation.invalid';
    default:
      return 'validation.invalid';
  }
}

/** Validates `data` and returns the parsed value, or `{kind:'validation', issues}` keyed by field path. */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): Result<z.output<S>> {
  const r = schema.safeParse(data);
  if (r.success) return ok(r.data);
  const issues: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const path = issue.path.length ? issue.path.join('.') : '_';
    issues[path] ??= keyFor(issue, data);
  }
  return err({ kind: 'validation', issues });
}
