export type SessionStatus = 'in_progress' | 'completed' | 'discarded';

/** The only permitted status changes. `completed` and `discarded` are terminal. */
const ALLOWED: Record<SessionStatus, readonly SessionStatus[]> = {
  in_progress: ['completed', 'discarded'],
  completed: [],
  discarded: [],
};

export const canTransition = (from: SessionStatus, to: SessionStatus) => ALLOWED[from].includes(to);

/** Only completed sessions count as workouts (never in_progress or discarded). */
export const countsAsWorkout = (status: SessionStatus) => status === 'completed';

/**
 * In-progress sessions are edited live. Completed and discarded sessions are frozen as far as their exercises and sets
 * go (enforced by triggers); a completed session's own name / rpe / end time can still be corrected, a discarded one's cannot.
 */
export const isEditable = (status: SessionStatus) => status !== 'discarded';
