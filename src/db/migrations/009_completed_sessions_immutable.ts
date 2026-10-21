import type { Migration } from './types';

/** Status of the session that owns an exercise row / a set row (looked up through the exercise row for sets). */
const OF_SESSION = (ref: string) => `(SELECT status FROM workout_sessions WHERE id=${ref})`;
const OF_SET_PARENT = (ref: string) =>
  `(SELECT ws.status FROM session_exercises se JOIN workout_sessions ws ON ws.id=se.session_id WHERE se.id=${ref})`;

/**
 * A completed workout's exercises and sets are immutable.
 *
 * Until now they could be "corrected" after completion, which let a stale screen, a repeated tap or a concurrent write
 * change a finished workout (with a made-up timestamp clamped to the end time). From this migration on, once a session is
 * `completed`, the database rejects every INSERT, UPDATE and DELETE of its `session_exercises` and `session_sets` rows -
 * including an UPDATE that moves a row into or out of a completed session (both the old and the new parent are checked).
 * This sits next to the existing protection of `discarded` sessions and does not touch `in_progress` ones.
 *
 * Still allowed on a completed session: its own metadata (`name`, `rpe`, `ended_at` - the latter still cannot precede a
 * set or the start; see 003). Deleting a whole session (explicit history removal, which cascades to its rows) is also
 * unchanged: SQLite's foreign-key cascade does not fire the child tables' triggers, and an existing test pins that behaviour.
 *
 * Purely additive apart from dropping three triggers that this one makes unreachable: the "keep >= 1 completed set when a
 * completed session is corrected" guards of 003 only ever applied to completed sessions, whose children can no longer
 * change at all. Removing them also keeps the error for such a write predictable (always FITNESS_SESSION_COMPLETED).
 * No table is rebuilt and no row is touched, so existing history is preserved exactly.
 */
export const m009: Migration = {
  version: 9,
  name: 'completed sessions: exercises and sets are immutable',
  sql: `
DROP TRIGGER session_exercises_keep_completed_del;
DROP TRIGGER session_sets_keep_completed_upd;
DROP TRIGGER session_sets_keep_completed_del;

CREATE TRIGGER session_exercises_completed_ins BEFORE INSERT ON session_exercises
WHEN ${OF_SESSION('NEW.session_id')}='completed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_COMPLETED'); END;
CREATE TRIGGER session_exercises_completed_upd BEFORE UPDATE ON session_exercises
WHEN ${OF_SESSION('OLD.session_id')}='completed' OR ${OF_SESSION('NEW.session_id')}='completed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_COMPLETED'); END;
CREATE TRIGGER session_exercises_completed_del BEFORE DELETE ON session_exercises
WHEN ${OF_SESSION('OLD.session_id')}='completed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_COMPLETED'); END;

CREATE TRIGGER session_sets_completed_ins BEFORE INSERT ON session_sets
WHEN ${OF_SET_PARENT('NEW.session_exercise_id')}='completed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_COMPLETED'); END;
CREATE TRIGGER session_sets_completed_upd BEFORE UPDATE ON session_sets
WHEN ${OF_SET_PARENT('OLD.session_exercise_id')}='completed' OR ${OF_SET_PARENT('NEW.session_exercise_id')}='completed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_COMPLETED'); END;
CREATE TRIGGER session_sets_completed_del BEFORE DELETE ON session_sets
WHEN ${OF_SET_PARENT('OLD.session_exercise_id')}='completed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_COMPLETED'); END;
`,
};
