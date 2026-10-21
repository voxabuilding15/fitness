import { parseNumber, NUMBER_ISSUE_KEY } from './numberText';
import type { SessionExercise, SessionSet, WorkoutSessionDetail } from './models';
import { err, ok, type Result } from './result';
import type { TrackingType } from './schemas/enums';
import type { SetInput } from './schemas/inputs';

/**
 * Logging a set: what is typed for each kind of exercise, and how it becomes the repository input.
 * Weight is kilograms and distance is metres in the database; the form asks for kilograms, and for kilometres and minutes
 * for distance work (so a 20-minute 5 km run is "5" and "20", not 5000 and 1200).
 */
export type SetField = 'weight' | 'reps' | 'durationSec' | 'distanceKm' | 'durationMin';
export interface SetDraft { weight: string; reps: string; durationSec: string; distanceKm: string; durationMin: string }
export type SetIssues = Partial<Record<SetField, string>>;

export const emptySetDraft = (): SetDraft => ({ weight: '', reps: '', durationSec: '', distanceKm: '', durationMin: '' });

/** The fields shown for an exercise, in order. */
export function fieldsFor(tracking: TrackingType): readonly SetField[] {
  switch (tracking) {
    case 'weight_reps': return ['weight', 'reps'];
    case 'reps_only': return ['reps'];
    case 'duration': return ['durationSec'];
    case 'distance_duration': return ['distanceKm', 'durationMin'];
  }
}

const text = (n: number) => String(Math.round(n * 1000) / 1000);

/** The next set starts from the last logged one, so a person repeating a weight only changes what differs. They still have to log it. */
export function nextDraft(tracking: TrackingType, last: SessionSet | undefined): SetDraft {
  const d = emptySetDraft();
  if (!last) return d;
  if (last.weightKg !== null && fieldsFor(tracking).includes('weight')) d.weight = text(last.weightKg);
  if (last.reps !== null && fieldsFor(tracking).includes('reps')) d.reps = String(last.reps);
  if (last.durationSec !== null) {
    if (tracking === 'duration') d.durationSec = String(last.durationSec);
    if (tracking === 'distance_duration') d.durationMin = text(last.durationSec / 60);
  }
  if (last.distanceM !== null && tracking === 'distance_duration') d.distanceKm = text(last.distanceM / 1000);
  return d;
}

function read(raw: string, min: number, max: number, integer: boolean, minExclusive = false): { value: number } | { issue: string } {
  const n = parseNumber(raw);
  if (!n.ok) return { issue: NUMBER_ISSUE_KEY[n.reason] };
  const v = n.value;
  if (!Number.isFinite(v) || (integer && !Number.isInteger(v))) return { issue: 'validation.invalid' };
  if (v > max || v < min || (minExclusive && v === min)) return { issue: 'validation.outOfRange' };
  return { value: v };
}

/** Validates what was typed and builds a completed set. Every field the exercise asks for is required; nothing is guessed. */
export function planSet(tracking: TrackingType, d: SetDraft): Result<SetInput> {
  const issues: SetIssues = {};
  const input: SetInput = { isCompleted: true };
  const take = <K extends keyof SetInput>(field: SetField, raw: string, key: K, parse: (v: number) => SetInput[K], min: number, max: number, integer: boolean, minExclusive = false) => {
    const r = read(raw, min, max, integer, minExclusive);
    if ('issue' in r) issues[field] = r.issue;
    else input[key] = parse(r.value);
  };
  for (const f of fieldsFor(tracking)) {
    if (f === 'weight') take(f, d.weight, 'weightKg', (v) => v, 0, 1000, false);
    if (f === 'reps') take(f, d.reps, 'reps', (v) => v, 1, 1000, true);
    if (f === 'durationSec') take(f, d.durationSec, 'durationSec', (v) => v, 1, 86_400, true);
    if (f === 'distanceKm') take(f, d.distanceKm, 'distanceM', (v) => Math.round(v * 1000), 0, 1000, false, true);
    if (f === 'durationMin') take(f, d.durationMin, 'durationSec', (v) => Math.round(v * 60), 0, 1440, false, true);
  }
  return Object.keys(issues).length ? err({ kind: 'validation', issues: issues as Record<string, string> }) : ok(input);
}

export interface SessionSummary {
  loggedSets: number;
  exercisesWithSets: number;
  exerciseCount: number;
  /** Kilograms x reps over sets that have both, as saved. */
  volumeKg: number;
  totalReps: number;
  /** Start to end, in whole minutes; null while the session has not ended. */
  durationMin: number | null;
}

const done = (s: SessionSet) => s.isCompleted;

/** Everything here is counted from the saved sets of the session; nothing comes from the screen's own state. */
export function summarizeSession(s: Pick<WorkoutSessionDetail, 'exercises' | 'startedAt' | 'endedAt'>): SessionSummary {
  const sets = s.exercises.flatMap((e: SessionExercise) => e.sets.filter(done));
  return {
    loggedSets: sets.length,
    exercisesWithSets: s.exercises.filter((e) => e.sets.some(done)).length,
    exerciseCount: s.exercises.length,
    volumeKg: Math.round(sets.reduce((sum, x) => sum + (x.weightKg !== null && x.reps !== null ? x.weightKg * x.reps : 0), 0) * 10) / 10,
    totalReps: sets.reduce((sum, x) => sum + (x.reps ?? 0), 0),
    durationMin: s.endedAt === null ? null : Math.max(0, Math.round((s.endedAt - s.startedAt) / 60_000)),
  };
}
