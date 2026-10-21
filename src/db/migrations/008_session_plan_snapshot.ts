import type { Migration } from './types';

/**
 * A session keeps the targets it was started with.
 *
 * Until now a session_exercise was only (session, exercise, position); its planned sets / reps / rest were read back
 * from the template, so editing or deleting the template changed what an old session appeared to have planned.
 * Purely additive: five nullable plan columns, the name of a custom exercise as it was when the session used it, and
 * `plan_captured`, which says whether a plan was recorded for the row.
 *  - Rows that already exist keep NULLs and `plan_captured = 0` ("not recorded"): their original targets cannot be
 *    reconstructed (the template may have been edited or deleted since), so nothing is invented or back-filled.
 *  - Rows added later by hand (`addExercise`) also have no plan; only a start from a template records one.
 *  - A recorded plan is complete (sets, rest, and reps or a duration) and uses the same ranges as a template row.
 *  - Plan and name are write-once: a trigger rejects any later change, so history cannot drift.
 * The columns are added to the existing table, so no row is copied or dropped and no foreign key can cascade.
 */
export const m008: Migration = {
  version: 8,
  name: 'session exercises: planned targets snapshot',
  sql: `
ALTER TABLE session_exercises ADD COLUMN exercise_name TEXT CHECK(exercise_name IS NULL OR length(trim(exercise_name)) BETWEEN 1 AND 60);
ALTER TABLE session_exercises ADD COLUMN plan_sets INTEGER CHECK(plan_sets IS NULL OR plan_sets BETWEEN 1 AND 20);
ALTER TABLE session_exercises ADD COLUMN plan_reps_min INTEGER CHECK(plan_reps_min IS NULL OR plan_reps_min BETWEEN 1 AND 1000);
ALTER TABLE session_exercises ADD COLUMN plan_reps_max INTEGER CHECK(plan_reps_max IS NULL OR plan_reps_max BETWEEN 1 AND 1000);
ALTER TABLE session_exercises ADD COLUMN plan_duration_sec INTEGER CHECK(plan_duration_sec IS NULL OR plan_duration_sec BETWEEN 1 AND 7200);
ALTER TABLE session_exercises ADD COLUMN plan_rest_sec INTEGER CHECK(plan_rest_sec IS NULL OR plan_rest_sec BETWEEN 0 AND 900);
ALTER TABLE session_exercises ADD COLUMN plan_captured INTEGER NOT NULL DEFAULT 0 CHECK(
  (plan_captured=0 AND plan_sets IS NULL AND plan_reps_min IS NULL AND plan_reps_max IS NULL AND plan_duration_sec IS NULL AND plan_rest_sec IS NULL)
  OR (plan_captured=1 AND plan_sets IS NOT NULL AND plan_rest_sec IS NOT NULL
      AND (plan_reps_min IS NOT NULL OR plan_reps_max IS NOT NULL OR plan_duration_sec IS NOT NULL)
      AND (plan_reps_min IS NULL OR plan_reps_max IS NULL OR plan_reps_min<=plan_reps_max))
);

CREATE TRIGGER session_exercises_plan_immutable BEFORE UPDATE OF exercise_name, plan_sets, plan_reps_min, plan_reps_max, plan_duration_sec, plan_rest_sec, plan_captured ON session_exercises
WHEN NEW.exercise_name IS NOT OLD.exercise_name OR NEW.plan_sets IS NOT OLD.plan_sets OR NEW.plan_reps_min IS NOT OLD.plan_reps_min
  OR NEW.plan_reps_max IS NOT OLD.plan_reps_max OR NEW.plan_duration_sec IS NOT OLD.plan_duration_sec
  OR NEW.plan_rest_sec IS NOT OLD.plan_rest_sec OR NEW.plan_captured IS NOT OLD.plan_captured
BEGIN SELECT RAISE(ABORT,'FITNESS_SESSION_PLAN_IMMUTABLE'); END;
`,
};
