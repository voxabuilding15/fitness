import type { Migration } from './types';

/** Parent status of a set, looked up through its session_exercise. */
const SET_PARENT_STATUS = (ref: string) =>
  `(SELECT ws.status FROM session_exercises se JOIN workout_sessions ws ON ws.id=se.session_id WHERE se.id=${ref})`;

export const m003: Migration = {
  version: 3,
  name: 'workout sessions (in_progress | completed | discarded)',
  sql: `
CREATE TABLE workout_sessions(
  id INTEGER PRIMARY KEY NOT NULL,
  template_id INTEGER REFERENCES workout_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  status TEXT NOT NULL CHECK(status IN('in_progress','completed','discarded')),
  started_at INTEGER NOT NULL CHECK(started_at>0),
  ended_at INTEGER,
  discarded_at INTEGER,
  local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(local_date) IS local_date),
  rpe INTEGER CHECK(rpe IS NULL OR rpe BETWEEN 1 AND 10),
  est_kcal REAL CHECK(est_kcal IS NULL OR est_kcal BETWEEN 0 AND 10000),
  est_method TEXT CHECK(est_method IS NULL OR est_method IN('met')),
  CHECK(
    (status='in_progress' AND ended_at IS NULL AND discarded_at IS NULL) OR
    (status='completed'   AND ended_at IS NOT NULL AND ended_at>=started_at AND discarded_at IS NULL) OR
    (status='discarded'   AND discarded_at IS NOT NULL AND discarded_at>=started_at AND ended_at IS NULL)
  ),
  CHECK((est_kcal IS NULL) = (est_method IS NULL)),
  CHECK((rpe IS NULL AND est_kcal IS NULL) OR status='completed')
) STRICT;
CREATE UNIQUE INDEX one_active_session ON workout_sessions(status) WHERE status='in_progress';
CREATE INDEX idx_sessions_date ON workout_sessions(local_date);

CREATE TABLE session_exercises(
  id INTEGER PRIMARY KEY NOT NULL,
  session_id INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(position>=1),
  UNIQUE(session_id, position)
) STRICT;
CREATE INDEX idx_session_exercises_exercise ON session_exercises(exercise_id);

CREATE TABLE session_sets(
  id INTEGER PRIMARY KEY NOT NULL,
  session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  set_number INTEGER NOT NULL CHECK(set_number>=1),
  weight_kg REAL CHECK(weight_kg IS NULL OR weight_kg BETWEEN 0 AND 1000),
  reps INTEGER CHECK(reps IS NULL OR reps BETWEEN 0 AND 1000),
  duration_sec INTEGER CHECK(duration_sec IS NULL OR duration_sec BETWEEN 0 AND 86400),
  distance_m REAL CHECK(distance_m IS NULL OR distance_m BETWEEN 0 AND 1000000),
  rpe REAL CHECK(rpe IS NULL OR rpe BETWEEN 1 AND 10),
  is_warmup INTEGER NOT NULL DEFAULT 0 CHECK(is_warmup IN(0,1)),
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK(is_completed IN(0,1)),
  completed_at INTEGER CHECK(completed_at IS NULL OR completed_at>0),
  UNIQUE(session_exercise_id, set_number),
  CHECK((is_completed=1) = (completed_at IS NOT NULL)),
  CHECK(is_completed=0 OR reps IS NOT NULL OR duration_sec IS NOT NULL OR distance_m IS NOT NULL)
) STRICT;

-- ---- lifecycle: a session is always CREATED in progress; in_progress -> completed | discarded; both are terminal ----
-- (A completed session with no sets, or a pre-discarded one, could otherwise be inserted directly: the CHECKs only
-- describe a row, and the "needs a completed set" rule is enforced on the status transition, which an INSERT bypasses.)
CREATE TRIGGER sessions_insert_in_progress BEFORE INSERT ON workout_sessions
WHEN NEW.status<>'in_progress'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_INSERT_STATUS'); END;

CREATE TRIGGER sessions_transition BEFORE UPDATE OF status ON workout_sessions
WHEN NEW.status<>OLD.status AND NOT (OLD.status='in_progress' AND NEW.status IN('completed','discarded'))
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_TRANSITION'); END;

CREATE TRIGGER sessions_frozen BEFORE UPDATE ON workout_sessions
WHEN OLD.status='discarded'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_FROZEN'); END;

CREATE TRIGGER sessions_start_immutable BEFORE UPDATE OF started_at ON workout_sessions
WHEN NEW.started_at<>OLD.started_at
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_START_IMMUTABLE'); END;

CREATE TRIGGER sessions_need_completed_set BEFORE UPDATE OF status ON workout_sessions
WHEN OLD.status='in_progress' AND NEW.status='completed'
 AND NOT EXISTS(SELECT 1 FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id
                WHERE se.session_id=NEW.id AND ss.is_completed=1)
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_EMPTY'); END;

CREATE TRIGGER sessions_end_after_sets BEFORE UPDATE OF status, ended_at ON workout_sessions
WHEN NEW.status='completed' AND EXISTS(SELECT 1 FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id
                                       WHERE se.session_id=NEW.id AND ss.completed_at>NEW.ended_at)
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_END_BEFORE_SET'); END;

-- ---- discarded sessions are frozen (their rows are kept as history) ----
CREATE TRIGGER session_exercises_frozen_ins BEFORE INSERT ON session_exercises
WHEN (SELECT status FROM workout_sessions WHERE id=NEW.session_id)='discarded'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_FROZEN'); END;
CREATE TRIGGER session_exercises_frozen_upd BEFORE UPDATE ON session_exercises
WHEN (SELECT status FROM workout_sessions WHERE id=OLD.session_id)='discarded'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_FROZEN'); END;
CREATE TRIGGER session_exercises_frozen_del BEFORE DELETE ON session_exercises
WHEN (SELECT status FROM workout_sessions WHERE id=OLD.session_id)='discarded'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_FROZEN'); END;
CREATE TRIGGER session_sets_frozen_ins BEFORE INSERT ON session_sets
WHEN ${SET_PARENT_STATUS('NEW.session_exercise_id')}='discarded'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_FROZEN'); END;
CREATE TRIGGER session_sets_frozen_upd BEFORE UPDATE ON session_sets
WHEN ${SET_PARENT_STATUS('OLD.session_exercise_id')}='discarded'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_FROZEN'); END;
CREATE TRIGGER session_sets_frozen_del BEFORE DELETE ON session_sets
WHEN ${SET_PARENT_STATUS('OLD.session_exercise_id')}='discarded'
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_FROZEN'); END;

-- ---- timestamps of sets must lie within their session ----
CREATE TRIGGER session_sets_time_ins BEFORE INSERT ON session_sets
WHEN NEW.completed_at IS NOT NULL AND EXISTS(SELECT 1 FROM session_exercises WHERE id=NEW.session_exercise_id) AND NOT EXISTS(
  SELECT 1 FROM session_exercises se JOIN workout_sessions ws ON ws.id=se.session_id
  WHERE se.id=NEW.session_exercise_id AND NEW.completed_at>=ws.started_at AND (ws.ended_at IS NULL OR NEW.completed_at<=ws.ended_at))
BEGIN SELECT RAISE(ABORT,'FITNESS_SET_TIME_RANGE'); END;
CREATE TRIGGER session_sets_time_upd BEFORE UPDATE ON session_sets
WHEN NEW.completed_at IS NOT NULL AND EXISTS(SELECT 1 FROM session_exercises WHERE id=NEW.session_exercise_id) AND NOT EXISTS(
  SELECT 1 FROM session_exercises se JOIN workout_sessions ws ON ws.id=se.session_id
  WHERE se.id=NEW.session_exercise_id AND NEW.completed_at>=ws.started_at AND (ws.ended_at IS NULL OR NEW.completed_at<=ws.ended_at))
BEGIN SELECT RAISE(ABORT,'FITNESS_SET_TIME_RANGE'); END;

-- ---- a completed session must keep at least one completed set when it is corrected ----
CREATE TRIGGER session_exercises_keep_completed_del BEFORE DELETE ON session_exercises
WHEN (SELECT status FROM workout_sessions WHERE id=OLD.session_id)='completed' AND NOT EXISTS(
  SELECT 1 FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id
  WHERE se.session_id=OLD.session_id AND se.id<>OLD.id AND ss.is_completed=1)
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_EMPTY'); END;
CREATE TRIGGER session_sets_keep_completed_upd AFTER UPDATE ON session_sets
WHEN ${SET_PARENT_STATUS('NEW.session_exercise_id')}='completed' AND NOT EXISTS(
  SELECT 1 FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id
  WHERE se.session_id=(SELECT session_id FROM session_exercises WHERE id=NEW.session_exercise_id) AND ss.is_completed=1)
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_EMPTY'); END;
CREATE TRIGGER session_sets_keep_completed_del AFTER DELETE ON session_sets
WHEN ${SET_PARENT_STATUS('OLD.session_exercise_id')}='completed' AND NOT EXISTS(
  SELECT 1 FROM session_sets ss JOIN session_exercises se ON se.id=ss.session_exercise_id
  WHERE se.session_id=(SELECT session_id FROM session_exercises WHERE id=OLD.session_exercise_id) AND ss.is_completed=1)
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_EMPTY'); END;
`,
};
