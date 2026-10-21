import type { Migration } from './types';

export const m002: Migration = {
  version: 2,
  name: 'exercises, workout templates',
  sql: `
CREATE TABLE exercises(
  id INTEGER PRIMARY KEY NOT NULL,
  slug TEXT UNIQUE,
  source TEXT NOT NULL CHECK(source IN('seed','user')),
  custom_name TEXT CHECK(custom_name IS NULL OR length(trim(custom_name)) BETWEEN 1 AND 60),
  category TEXT NOT NULL CHECK(category IN('strength','cardio','mobility')),
  primary_muscle TEXT NOT NULL CHECK(primary_muscle IN('chest','back','shoulders','biceps','triceps','forearms','quads','hamstrings','glutes','calves','core','full_body','cardio')),
  secondary_muscles TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(secondary_muscles) AND json_type(secondary_muscles)='array'),
  equipment TEXT NOT NULL CHECK(equipment IN('bodyweight','dumbbell','barbell','machine','cable','kettlebell','band','cardio_machine','other')),
  tracking_type TEXT NOT NULL CHECK(tracking_type IN('weight_reps','reps_only','duration','distance_duration')),
  met_value REAL CHECK(met_value IS NULL OR met_value BETWEEN 1 AND 25),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN(0,1)),
  created_at INTEGER NOT NULL CHECK(created_at>0),
  CHECK((source='seed' AND slug IS NOT NULL AND custom_name IS NULL) OR (source='user' AND slug IS NULL AND custom_name IS NOT NULL))
) STRICT;

CREATE TRIGGER exercises_no_delete_seed BEFORE DELETE ON exercises WHEN OLD.source='seed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SEED_IMMUTABLE'); END;

CREATE TABLE workout_templates(
  id INTEGER PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 60),
  notes TEXT CHECK(notes IS NULL OR length(notes)<=500),
  created_at INTEGER NOT NULL CHECK(created_at>0),
  updated_at INTEGER NOT NULL CHECK(updated_at>0)
) STRICT;

CREATE TABLE template_exercises(
  id INTEGER PRIMARY KEY NOT NULL,
  template_id INTEGER NOT NULL REFERENCES workout_templates(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK(position>=1),
  target_sets INTEGER NOT NULL CHECK(target_sets BETWEEN 1 AND 20),
  target_reps_min INTEGER CHECK(target_reps_min IS NULL OR target_reps_min BETWEEN 1 AND 1000),
  target_reps_max INTEGER CHECK(target_reps_max IS NULL OR target_reps_max BETWEEN 1 AND 1000),
  target_duration_sec INTEGER CHECK(target_duration_sec IS NULL OR target_duration_sec BETWEEN 1 AND 7200),
  rest_sec INTEGER NOT NULL CHECK(rest_sec BETWEEN 0 AND 900),
  UNIQUE(template_id, position),
  CHECK(target_reps_min IS NULL OR target_reps_max IS NULL OR target_reps_min<=target_reps_max)
) STRICT;
CREATE INDEX idx_template_exercises_exercise ON template_exercises(exercise_id);
`,
};
