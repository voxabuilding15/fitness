import type { Migration } from './types';

export const m006: Migration = {
  version: 6,
  name: 'habits and habit logs',
  sql: `
CREATE TABLE habits(
  id INTEGER PRIMARY KEY NOT NULL,
  slug TEXT UNIQUE,
  source TEXT NOT NULL CHECK(source IN('seed','user')),
  custom_name TEXT CHECK(custom_name IS NULL OR length(trim(custom_name)) BETWEEN 1 AND 60),
  kind TEXT NOT NULL CHECK(kind IN('boolean','count')),
  target_count INTEGER CHECK(target_count IS NULL OR target_count BETWEEN 1 AND 1000),
  schedule_days INTEGER NOT NULL DEFAULT 127 CHECK(schedule_days BETWEEN 1 AND 127),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN(0,1)),
  created_at INTEGER NOT NULL CHECK(created_at>0),
  CHECK((source='seed' AND slug IS NOT NULL AND custom_name IS NULL) OR (source='user' AND slug IS NULL AND custom_name IS NOT NULL)),
  CHECK((kind='count') = (target_count IS NOT NULL))
) STRICT;
CREATE TRIGGER habits_no_delete_seed BEFORE DELETE ON habits WHEN OLD.source='seed'
BEGIN SELECT RAISE(ABORT,'FITNESS_SEED_IMMUTABLE'); END;

CREATE TABLE habit_logs(
  id INTEGER PRIMARY KEY NOT NULL,
  habit_id INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(local_date) IS local_date),
  value INTEGER NOT NULL CHECK(value BETWEEN 0 AND 100000),
  UNIQUE(habit_id, local_date)
) STRICT;
`,
};
