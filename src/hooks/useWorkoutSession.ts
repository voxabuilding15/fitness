import { useEffect, useMemo, useReducer } from 'react';
import { initialSession, reduceSession, type SessionAction, type SessionState } from '../services/workoutSession';
import { playSound } from '../services/soundService';
import type { Exercise } from '../types/workout';

/** Runs the pure session reducer and ticks once per second while the session is running. */
export function useWorkoutSession(exercises: Exercise[]) {
  const plan = useMemo(() => exercises.map((e) => ({ sets: e.sets, restSec: e.restSec })), [exercises]);
  const [state, dispatch] = useReducer(
    (s: SessionState, a: SessionAction) => reduceSession(s, a, plan),
    initialSession,
  );

  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => dispatch({ type: 'TICK' }), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if (state.status === 'finished') playSound('success');
  }, [state.status]);

  return { state, dispatch };
}
