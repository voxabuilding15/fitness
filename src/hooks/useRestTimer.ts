import { useCallback, useEffect, useState } from 'react';
import { IDLE, remainingSec, startRest, tickRest, type RestTimer } from '../domain/restTimer';

/** Runs a `RestTimer` and re-renders once a second while it is running. `now` is read in handlers and the interval, never in render. */
export function useRestTimer(nowFn: () => number = Date.now) {
  const [timer, setTimer] = useState<RestTimer>(IDLE);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (timer.phase !== 'running') return;
    const id = setInterval(() => {
      const t = nowFn();
      setNow(t);
      setTimer((cur) => tickRest(cur, t));
    }, 250);
    return () => clearInterval(id);
  }, [timer.phase, nowFn]);

  const start = useCallback((seconds: number, exerciseKey: number) => {
    const t = nowFn();
    setNow(t);
    setTimer(startRest(t, seconds, exerciseKey));
  }, [nowFn]);
  const stop = useCallback(() => setTimer(IDLE), []);
  return { timer, secondsLeft: remainingSec(timer, now), start, stop };
}
