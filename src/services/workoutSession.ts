export type SessionStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface SessionState {
  status: SessionStatus;
  elapsed: number;
  exerciseIndex: number;
  /** zero-based index of the set currently being performed */
  setIndex: number;
  restLeft: number;
}

export type SessionAction =
  | { type: 'TOGGLE' }
  | { type: 'TICK' }
  | { type: 'COMPLETE_SET' }
  | { type: 'SKIP_REST' }
  | { type: 'RESET' };

export interface PlanStep {
  sets: number;
  restSec: number;
}

export const initialSession: SessionState = {
  status: 'idle',
  elapsed: 0,
  exerciseIndex: 0,
  setIndex: 0,
  restLeft: 0,
};

/** Pure reducer driving the workout session; the timer only advances while `running`. */
export function reduceSession(state: SessionState, action: SessionAction, plan: PlanStep[]): SessionState {
  switch (action.type) {
    case 'TOGGLE':
      if (state.status === 'running') return { ...state, status: 'paused' };
      if (state.status === 'idle' || state.status === 'paused') return { ...state, status: 'running' };
      return state;
    case 'TICK':
      if (state.status !== 'running') return state;
      return { ...state, elapsed: state.elapsed + 1, restLeft: Math.max(0, state.restLeft - 1) };
    case 'COMPLETE_SET': {
      if (state.status !== 'running' || state.restLeft > 0) return state;
      const step = plan[state.exerciseIndex];
      if (!step) return state;
      if (state.setIndex + 1 < step.sets) {
        return { ...state, setIndex: state.setIndex + 1, restLeft: step.restSec };
      }
      if (state.exerciseIndex + 1 < plan.length) {
        return { ...state, exerciseIndex: state.exerciseIndex + 1, setIndex: 0, restLeft: step.restSec };
      }
      return { ...state, status: 'finished', restLeft: 0 };
    }
    case 'SKIP_REST':
      return { ...state, restLeft: 0 };
    case 'RESET':
      return initialSession;
  }
}
