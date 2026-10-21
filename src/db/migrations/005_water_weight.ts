import type { Migration } from './types';

export const m005: Migration = {
  version: 5,
  name: 'water and weight entries',
  sql: `
CREATE TABLE water_entries(
  id INTEGER PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(local_date) IS local_date),
  amount_ml INTEGER NOT NULL CHECK(amount_ml BETWEEN 1 AND 5000),
  logged_at INTEGER NOT NULL CHECK(logged_at>0)
) STRICT;
CREATE INDEX idx_water_date ON water_entries(local_date);

CREATE TABLE weight_entries(
  id INTEGER PRIMARY KEY NOT NULL,
  local_date TEXT NOT NULL UNIQUE CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(local_date) IS local_date),
  weight_kg REAL NOT NULL CHECK(weight_kg BETWEEN 20 AND 500),
  note TEXT CHECK(note IS NULL OR length(note)<=200),
  source TEXT NOT NULL CHECK(source IN('manual','legacy_profile')),
  logged_at INTEGER NOT NULL CHECK(logged_at>0)
) STRICT;
`,
};
