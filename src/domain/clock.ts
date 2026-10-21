export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/** A clock you can move by hand (tests, deterministic flows). */
export class ManualClock implements Clock {
  constructor(private current: number) {}
  now() {
    return this.current;
  }
  set(ms: number) {
    this.current = ms;
  }
  advance(ms: number) {
    this.current += ms;
  }
}
