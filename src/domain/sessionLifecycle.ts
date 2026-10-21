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

/** Completed sessions may be corrected; in-progress ones are edited live; discarded ones are frozen. */
export const isEditable = (status: SessionStatus) => status !== 'discarded';
