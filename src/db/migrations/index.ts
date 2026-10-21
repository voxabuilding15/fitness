import { m001 } from './001_profile_goals';
import { m002 } from './002_exercises_templates';
import { m003 } from './003_sessions';
import { m004 } from './004_nutrition';
import { m005 } from './005_water_weight';
import { m006 } from './006_habits';
import type { Migration } from './types';

export type { Migration } from './types';

/** Append-only. Never edit a migration that has shipped; add a new one. Versions must be 1..N with no gaps. */
export const MIGRATIONS: readonly Migration[] = [m001, m002, m003, m004, m005, m006];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
