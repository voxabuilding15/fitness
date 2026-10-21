import type { Migration } from './types';

export const m001: Migration = {
  version: 1,
  name: 'meta, profile, goals',
  sql: `
CREATE TABLE app_meta(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;

CREATE TABLE profile(
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 40),
  location TEXT CHECK(location IS NULL OR length(location)<=60),
  sex TEXT CHECK(sex IS NULL OR sex IN('female','male')),
  age_years INTEGER CHECK(age_years IS NULL OR age_years BETWEEN 10 AND 100),
  age_set_on TEXT CHECK(age_set_on IS NULL OR (age_set_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(age_set_on) IS age_set_on)),
  height_cm REAL CHECK(height_cm IS NULL OR height_cm BETWEEN 100 AND 250),
  activity_level TEXT CHECK(activity_level IS NULL OR activity_level IN('sedentary','light','moderate','active','very_active')),
  updated_at INTEGER NOT NULL CHECK(updated_at>0),
  CHECK((age_years IS NULL) = (age_set_on IS NULL))
) STRICT;

CREATE TABLE goals(
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  goal_type TEXT NOT NULL CHECK(goal_type IN('lose_fat','maintain','build_muscle')),
  target_weight_kg REAL CHECK(target_weight_kg IS NULL OR target_weight_kg BETWEEN 20 AND 500),
  kcal_target INTEGER CHECK(kcal_target IS NULL OR kcal_target BETWEEN 800 AND 6000),
  protein_g REAL CHECK(protein_g IS NULL OR protein_g BETWEEN 0 AND 600),
  carbs_g REAL CHECK(carbs_g IS NULL OR carbs_g BETWEEN 0 AND 1500),
  fat_g REAL CHECK(fat_g IS NULL OR fat_g BETWEEN 0 AND 600),
  water_ml_target INTEGER NOT NULL CHECK(water_ml_target BETWEEN 500 AND 8000),
  weekly_workout_target INTEGER NOT NULL CHECK(weekly_workout_target BETWEEN 0 AND 14),
  source TEXT NOT NULL CHECK(source IN('calculated','manual')),
  updated_at INTEGER NOT NULL CHECK(updated_at>0)
) STRICT;
`,
};
