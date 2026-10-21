import type { AppError } from './errors';
import type { WorkoutTemplate } from './models';

/** A workout with no exercises is never started: the session would be empty and could not be worked through. */
export const canStartFromTemplate = (t: Pick<WorkoutTemplate, 'exercises'>) => t.exercises.length > 0;

/**
 * Translation key for why a start failed. A second workout cannot be started while one is in progress (the database
 * allows one), and a template deleted after the screen loaded is reported as such rather than as a generic failure.
 */
export function startFailureKey(e: AppError): string {
  if (e.kind === 'conflict' && e.reason === 'active_session') return 'liveSession.alreadyActive';
  if (e.kind === 'not_found') return 'liveSession.templateGone';
  return 'liveSession.startFailed';
}
