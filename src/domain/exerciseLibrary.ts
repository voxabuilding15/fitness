import type { Exercise } from './models';
import { err, type Result } from './result';
import { exerciseInput, parseInput } from './schemas';
import type { Equipment, ExerciseCategory, Muscle, TrackingType } from './schemas/enums';
import type { ExerciseInput } from './schemas/inputs';

/**
 * Pure logic of the exercise library: how an exercise is named, searched, filtered and validated.
 * Built-in exercises have no stored name - their name comes from the translation files, keyed by slug - so search,
 * sorting and duplicate checks all work on the DISPLAYED (translated) name, never on the database row.
 */
export type NameLookup = (translationKey: string) => string | undefined;
type Named = Pick<Exercise, 'slug' | 'customName' | 'source'>;

/** `bench_press` -> `exercises.benchPress` (the key of its English / Arabic name). */
export const exerciseNameKey = (slug: string) => `exercises.${slug.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())}`;

const humanizeSlug = (slug: string) => slug.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** The name to show. A built-in exercise whose translation is missing falls back to its slug, spelled out - never to an empty string. */
export function exerciseDisplayName(ex: Named, lookup: NameLookup): string {
  if (ex.source === 'user') return ex.customName ?? '';
  const name = ex.slug ? lookup(exerciseNameKey(ex.slug)) : undefined;
  return name && name.trim() ? name : humanizeSlug(ex.slug ?? '');
}

/**
 * Makes two spellings of the same words comparable: case, Arabic diacritics and tatweel, the alef / yaa / taa-marbuta
 * variants, and punctuation ("Step-up" = "step up"). Used for search and for duplicate-name detection.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[-_'’.,/()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface LibraryFilter {
  query: string;
  muscle: Muscle | null;
  equipment: Equipment | null;
  category: ExerciseCategory | null;
  /** Show exercises the person has hidden (archived). */
  includeHidden: boolean;
}
export const NO_FILTER: LibraryFilter = { query: '', muscle: null, equipment: null, category: null, includeHidden: false };
export const hasActiveFilter = (f: LibraryFilter) => f.query.trim() !== '' || f.muscle !== null || f.equipment !== null || f.category !== null || f.includeHidden;

/** Alphabetical by displayed name (ties by id, so the order never jumps around). */
export function sortExercises(list: readonly Exercise[], nameOf: (e: Exercise) => string): Exercise[] {
  const keyed = list.map((e) => ({ e, k: normalizeForSearch(nameOf(e)) }));
  keyed.sort((a, b) => a.k.localeCompare(b.k) || a.e.id - b.e.id);
  return keyed.map((x) => x.e);
}

/** Every word of the query must appear in the displayed name; muscle / equipment / category filters are exact. */
export function filterExercises(list: readonly Exercise[], filter: LibraryFilter, nameOf: (e: Exercise) => string): Exercise[] {
  const tokens = normalizeForSearch(filter.query).split(' ').filter(Boolean);
  const kept = list.filter((e) => {
    if (e.isArchived && !filter.includeHidden) return false;
    if (filter.muscle && e.primaryMuscle !== filter.muscle) return false;
    if (filter.equipment && e.equipment !== filter.equipment) return false;
    if (filter.category && e.category !== filter.category) return false;
    if (tokens.length) {
      const name = normalizeForSearch(nameOf(e));
      if (!tokens.every((t) => name.includes(t))) return false;
    }
    return true;
  });
  return sortExercises(kept, nameOf);
}

/** An existing exercise (hidden ones too) whose displayed name equals `name` once spelling variants are ignored. */
export function findDuplicateName(name: string, exercises: readonly Exercise[], nameOf: (e: Exercise) => string, excludeId?: number): Exercise | null {
  const wanted = normalizeForSearch(name);
  if (!wanted) return null;
  return exercises.find((e) => e.id !== excludeId && normalizeForSearch(nameOf(e)) === wanted) ?? null;
}

// ---- the create / edit form -------------------------------------------------------------------------------------

export const MAX_SECONDARY_MUSCLES = 5;

export interface ExerciseForm {
  name: string;
  /** `null` = not chosen yet. Nothing is chosen on the person's behalf. */
  category: ExerciseCategory | null;
  primaryMuscle: Muscle | null;
  equipment: Equipment | null;
  trackingType: TrackingType | null;
  secondaryMuscles: Muscle[];
}
export type ExerciseFormIssues = Partial<Record<keyof ExerciseForm, string>>;

export const emptyExerciseForm = (): ExerciseForm => ({ name: '', category: null, primaryMuscle: null, equipment: null, trackingType: null, secondaryMuscles: [] });

/** A form pre-filled from an existing exercise (to edit it, or to start a copy of it). */
export function formFromExercise(ex: Exercise, nameOf: (e: Exercise) => string): ExerciseForm {
  return {
    name: nameOf(ex), category: ex.category, primaryMuscle: ex.primaryMuscle, equipment: ex.equipment, trackingType: ex.trackingType,
    secondaryMuscles: [...ex.secondaryMuscles],
  };
}

/** Choosing the main muscle removes it from the "also works" list, so the two can never overlap. */
export const setPrimaryMuscle = (f: ExerciseForm, m: Muscle): ExerciseForm => ({ ...f, primaryMuscle: m, secondaryMuscles: f.secondaryMuscles.filter((x) => x !== m) });

/** Adds / removes a secondary muscle. The main muscle cannot be one, and at most five can be chosen. */
export function toggleSecondaryMuscle(f: ExerciseForm, m: Muscle): ExerciseForm {
  if (m === f.primaryMuscle) return f;
  if (f.secondaryMuscles.includes(m)) return { ...f, secondaryMuscles: f.secondaryMuscles.filter((x) => x !== m) };
  if (f.secondaryMuscles.length >= MAX_SECONDARY_MUSCLES) return f;
  return { ...f, secondaryMuscles: [...f.secondaryMuscles, m] };
}

const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Validates the form and builds the repository input. `others` are the exercises that already exist (for the duplicate
 * check); `editingId` excludes the exercise being edited from it.
 */
export function planExerciseSave(form: ExerciseForm, others: readonly Exercise[], nameOf: (e: Exercise) => string, editingId?: number): Result<ExerciseInput> {
  const issues: ExerciseFormIssues = {};
  const name = cleanName(form.name);
  if (!name) issues.name = 'validation.required';
  else if (name.length > 60) issues.name = 'validation.tooLong';
  else if (findDuplicateName(name, others, nameOf, editingId)) issues.name = 'library.duplicateName';
  if (!form.category) issues.category = 'library.chooseOne';
  if (!form.primaryMuscle) issues.primaryMuscle = 'library.chooseOne';
  if (!form.equipment) issues.equipment = 'library.chooseOne';
  if (!form.trackingType) issues.trackingType = 'library.chooseOne';
  if (Object.keys(issues).length) return err({ kind: 'validation', issues: issues as Record<string, string> });

  const parsed = parseInput(exerciseInput, {
    name, category: form.category, primaryMuscle: form.primaryMuscle, equipment: form.equipment, trackingType: form.trackingType, secondaryMuscles: form.secondaryMuscles,
  });
  return parsed.ok ? parsed : err(parsed.error);
}
