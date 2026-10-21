import type { Migration } from './types';

/**
 * Lets the profile say "I do not know when this was entered".
 *
 * Migration 001 required `age_set_on` whenever an age existed, so data carried over from the old AsyncStorage profile
 * (which never recorded when it was typed) could only be stored by claiming a date - the import day - and would then look
 * current. Now:
 *  - `age_set_on` may be NULL while `age_years` is set (age entered at an UNKNOWN time); a date still requires an age;
 *  - `undated_weight_kg` holds a weight carried over from the old profile whose date is unknown. It is NOT a weight entry
 *    (weight entries always have a real day), so it never appears in history or statistics.
 * SQLite cannot change a CHECK in place, so the table is rebuilt. Nothing references `profile`, so no foreign key can
 * cascade, and the runner's row-count guard (unchanged here) proves no row is lost.
 */
export const m007: Migration = {
  version: 7,
  name: 'profile: age/weight of unknown date',
  sql: `
CREATE TABLE profile_new(
  id INTEGER PRIMARY KEY NOT NULL CHECK(id=1),
  display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 40),
  location TEXT CHECK(location IS NULL OR length(location)<=60),
  sex TEXT CHECK(sex IS NULL OR sex IN('female','male')),
  age_years INTEGER CHECK(age_years IS NULL OR age_years BETWEEN 10 AND 100),
  age_set_on TEXT CHECK(age_set_on IS NULL OR (age_set_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(age_set_on) IS age_set_on)),
  height_cm REAL CHECK(height_cm IS NULL OR height_cm BETWEEN 100 AND 250),
  activity_level TEXT CHECK(activity_level IS NULL OR activity_level IN('sedentary','light','moderate','active','very_active')),
  undated_weight_kg REAL CHECK(undated_weight_kg IS NULL OR undated_weight_kg BETWEEN 20 AND 500),
  updated_at INTEGER NOT NULL CHECK(updated_at>0),
  CHECK(age_set_on IS NULL OR age_years IS NOT NULL)
) STRICT;
INSERT INTO profile_new(id,display_name,location,sex,age_years,age_set_on,height_cm,activity_level,undated_weight_kg,updated_at)
  SELECT id,display_name,location,sex,age_years,age_set_on,height_cm,activity_level,NULL,updated_at FROM profile;
DROP TABLE profile;
ALTER TABLE profile_new RENAME TO profile;
`,
};
