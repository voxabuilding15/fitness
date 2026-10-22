import type { LastPerformance, SessionSet } from './models';
import { emptySetDraft, nextDraft, type SetDraft } from './setEntry';
import type { TrackingType } from './schemas/enums';

/** The set a new workout starts from: the last working set of last time (a warm-up only if there was nothing else). */
export function referenceSet(last: LastPerformance): SessionSet | undefined {
  const sets = last.sets.filter((s) => s.isCompleted);
  return [...sets].reverse().find((s) => !s.isWarmup) ?? sets[sets.length - 1];
}

/** The values to type in for a first set, from last time. Empty if last time has nothing usable. */
export const draftFromLast = (tracking: TrackingType, last: LastPerformance): SetDraft => nextDraft(tracking, referenceSet(last));

/**
 * "Use last values" is offered only while it cannot overwrite anything: no set of this exercise is logged yet in this
 * workout (after that, the next set already starts from your own last set) and nothing is typed.
 */
export const canUseLast = (draft: SetDraft, loggedHere: number) => loggedHere === 0 && (Object.keys(emptySetDraft()) as (keyof SetDraft)[]).every((k) => draft[k].trim() === '');

/** At most `max` sets are listed; the rest are counted. */
export const listedSets = (sets: SessionSet[], max = 5) => ({ shown: sets.slice(0, max), more: Math.max(0, sets.length - max) });
