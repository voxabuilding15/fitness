import type { Migration } from './types';

export const m004: Migration = {
  version: 4,
  name: 'foods, meal entries',
  sql: `
CREATE TABLE foods(
  id INTEGER PRIMARY KEY NOT NULL,
  slug TEXT UNIQUE,
  source TEXT NOT NULL CHECK(source IN('seed','user')),
  custom_name TEXT CHECK(custom_name IS NULL OR length(trim(custom_name)) BETWEEN 1 AND 80),
  brand TEXT CHECK(brand IS NULL OR length(brand)<=60),
  unit TEXT NOT NULL CHECK(unit IN('g','ml')),
  kcal_per_100 REAL NOT NULL CHECK(kcal_per_100 BETWEEN 0 AND 950),
  protein_per_100 REAL NOT NULL CHECK(protein_per_100 BETWEEN 0 AND 100),
  carbs_per_100 REAL NOT NULL CHECK(carbs_per_100 BETWEEN 0 AND 100),
  fat_per_100 REAL NOT NULL CHECK(fat_per_100 BETWEEN 0 AND 100),
  fiber_per_100 REAL CHECK(fiber_per_100 IS NULL OR fiber_per_100 BETWEEN 0 AND 100),
  default_serving REAL NOT NULL CHECK(default_serving>0 AND default_serving<=5000),
  is_favorite INTEGER NOT NULL DEFAULT 0 CHECK(is_favorite IN(0,1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN(0,1)),
  data_label TEXT NOT NULL CHECK(data_label IN('approximate','user_entered')),
  created_at INTEGER NOT NULL CHECK(created_at>0),
  CHECK((source='seed' AND slug IS NOT NULL AND custom_name IS NULL) OR (source='user' AND slug IS NULL AND custom_name IS NOT NULL))
) STRICT;
CREATE TRIGGER foods_no_delete_seed BEFORE DELETE ON foods WHEN OLD.source='seed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SEED_IMMUTABLE'); END;

CREATE TABLE meal_entries(
  id INTEGER PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(local_date) IS local_date),
  meal_type TEXT NOT NULL CHECK(meal_type IN('breakfast','lunch','dinner','snack')),
  food_id INTEGER REFERENCES foods(id) ON DELETE RESTRICT,
  quick_label TEXT CHECK(quick_label IS NULL OR length(trim(quick_label)) BETWEEN 1 AND 80),
  amount REAL NOT NULL CHECK(amount>0 AND amount<=5000),
  kcal REAL NOT NULL CHECK(kcal BETWEEN 0 AND 20000),
  protein_g REAL NOT NULL CHECK(protein_g BETWEEN 0 AND 2000),
  carbs_g REAL NOT NULL CHECK(carbs_g BETWEEN 0 AND 3000),
  fat_g REAL NOT NULL CHECK(fat_g BETWEEN 0 AND 2000),
  logged_at INTEGER NOT NULL CHECK(logged_at>0),
  CHECK(food_id IS NOT NULL OR quick_label IS NOT NULL)
) STRICT;
CREATE INDEX idx_meals_date ON meal_entries(local_date);
`,
};
