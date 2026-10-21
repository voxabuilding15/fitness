import { parseNumber } from './numberText';
import { normalizeForSearch } from './exerciseLibrary';
import type { Exercise, WorkoutTemplate } from './models';
import { err, type Result } from './result';
import { parseInput, templateInput } from './schemas';
import type { TemplateInput } from './schemas/inputs';

/**
 * Pure logic of the workout builder: an editable draft of a template (every number is the text the person typed),
 * the operations on it, and the validation that turns it into the repository input.
 * Nothing here touches the database; a failed read can therefore never reach a write.
 */
export const MAX_TEMPLATE_EXERCISES = 30;
export const MAX_NAME_LENGTH = 60;

/** Which target an exercise is given: a rep range, or a time. */
export type ItemKind = 'reps' | 'duration';
export type ItemField = 'sets' | 'repsMin' | 'repsMax' | 'durationSec' | 'restSec';

export interface DraftItem {
  /** Identity inside the draft only (stable while items are reordered); not stored. */
  key: number;
  exerciseId: number;
  kind: ItemKind;
  sets: string;
  repsMin: string;
  repsMax: string;
  durationSec: string;
  restSec: string;
}
export interface TemplateDraft { name: string; notes: string; items: DraftItem[]; nextKey: number }

export const emptyTemplateDraft = (): TemplateDraft => ({ name: '', notes: '', items: [], nextKey: 1 });

const timed = (e: Pick<Exercise, 'trackingType'>) => e.trackingType === 'duration' || e.trackingType === 'distance_duration';

/** A new row for an exercise, with ordinary starting targets the person can change. */
export function itemForExercise(ex: Pick<Exercise, 'id' | 'trackingType'>, key: number): DraftItem {
  const isTimed = timed(ex);
  return {
    key, exerciseId: ex.id, kind: isTimed ? 'duration' : 'reps', sets: '3',
    repsMin: isTimed ? '' : '8', repsMax: isTimed ? '' : '12', durationSec: isTimed ? '30' : '', restSec: '60',
  };
}

export function draftFromTemplate(t: WorkoutTemplate): TemplateDraft {
  const items = [...t.exercises].sort((a, b) => a.position - b.position).map<DraftItem>((e, i) => ({
    key: i + 1, exerciseId: e.exerciseId,
    kind: e.targetRepsMin === null && e.targetRepsMax === null && e.targetDurationSec !== null ? 'duration' : 'reps',
    sets: String(e.targetSets), repsMin: e.targetRepsMin === null ? '' : String(e.targetRepsMin),
    repsMax: e.targetRepsMax === null ? '' : String(e.targetRepsMax),
    durationSec: e.targetDurationSec === null ? '' : String(e.targetDurationSec), restSec: String(e.restSec),
  }));
  return { name: t.name, notes: t.notes ?? '', items, nextKey: items.length + 1 };
}

/** Adds an exercise at the end. At the limit the draft is returned unchanged. */
export function addExercise(d: TemplateDraft, ex: Pick<Exercise, 'id' | 'trackingType'>): TemplateDraft {
  if (d.items.length >= MAX_TEMPLATE_EXERCISES) return d;
  return { ...d, items: [...d.items, itemForExercise(ex, d.nextKey)], nextKey: d.nextKey + 1 };
}
export const removeItem = (d: TemplateDraft, key: number): TemplateDraft => ({ ...d, items: d.items.filter((i) => i.key !== key) });

/** Moves a row one place up (-1) or down (+1). At either end nothing changes. */
export function moveItem(d: TemplateDraft, key: number, delta: -1 | 1): TemplateDraft {
  const from = d.items.findIndex((i) => i.key === key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= d.items.length) return d;
  const items = [...d.items];
  [items[from], items[to]] = [items[to], items[from]];
  return { ...d, items };
}
/** Moves a row to the very top or bottom. Already there (or unknown row): nothing changes. */
export function moveItemTo(d: TemplateDraft, key: number, where: 'top' | 'bottom'): TemplateDraft {
  const from = d.items.findIndex((i) => i.key === key);
  const to = where === 'top' ? 0 : d.items.length - 1;
  if (from < 0 || from === to) return d;
  const items = d.items.filter((i) => i.key !== key);
  items.splice(to, 0, d.items[from]);
  return { ...d, items };
}

/** How many rows use this exercise (an exercise may be added more than once). */
export const countOf = (d: TemplateDraft, exerciseId: number) => d.items.filter((i) => i.exerciseId === exerciseId).length;

/**
 * True when the draft differs from what it started as: name, notes, or any row's exercise or numbers, in order. Changing
 * something and changing it back is not a change. Row keys are ignored (they are only identities inside one draft).
 */
export function isDirty(current: TemplateDraft, initial: TemplateDraft): boolean {
  const rows = (x: TemplateDraft) => x.items.map(({ key: _key, ...rest }) => rest);
  return current.name !== initial.name || current.notes !== initial.notes || JSON.stringify(rows(current)) !== JSON.stringify(rows(initial));
}

export const updateItem = (d: TemplateDraft, key: number, patch: Partial<Pick<DraftItem, ItemField>>): TemplateDraft => ({
  ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)),
});

const cleanName = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The template that already has this name (spelling, case and punctuation aside), other than `excludeId`. */
export function findDuplicateTemplate(name: string, templates: readonly WorkoutTemplate[], excludeId?: number): WorkoutTemplate | undefined {
  const wanted = normalizeForSearch(cleanName(name));
  if (!wanted) return undefined;
  return templates.find((t) => t.id !== excludeId && normalizeForSearch(t.name) === wanted);
}

/** "Push day" -> "Push day (copy)", then "(copy 2)" ... : the first name that is free and within the length limit. */
export function uniqueCopyName(name: string, templates: readonly WorkoutTemplate[], suffix: string): string {
  const fit = (base: string, tail: string) => `${base.slice(0, Math.max(1, MAX_NAME_LENGTH - tail.length - 1)).trimEnd()} ${tail}`;
  const base = cleanName(name);
  for (let n = 1; ; n++) {
    const candidate = fit(base, n === 1 ? `(${suffix})` : `(${suffix} ${n})`);
    if (!findDuplicateTemplate(candidate, templates)) return candidate;
  }
}

/** Issue keys: `name`, `exercises`, and `<row key>.<field>` for a row's number. Values are translation keys. */
export type TemplateIssues = Record<string, string>;
export const itemIssueKey = (key: number, field: ItemField) => `${key}.${field}`;

function readInt(text: string, min: number, max: number, required: boolean): { ok: true; value: number | undefined } | { ok: false; issue: string } {
  if (text.trim() === '') return required ? { ok: false, issue: 'validation.required' } : { ok: true, value: undefined };
  const n = parseNumber(text);
  if (!n.ok || !Number.isInteger(n.value)) return { ok: false, issue: 'validation.invalid' };
  if (n.value < min || n.value > max) return { ok: false, issue: 'validation.outOfRange' };
  return { ok: true, value: n.value };
}

/** Validates the whole draft and builds the repository input. `others` are the saved templates (for the name check). */
export function planTemplateSave(d: TemplateDraft, others: readonly WorkoutTemplate[], editingId?: number): Result<TemplateInput> {
  const issues: TemplateIssues = {};
  const name = cleanName(d.name);
  if (!name) issues.name = 'validation.required';
  else if (name.length > MAX_NAME_LENGTH) issues.name = 'validation.tooLong';
  else if (findDuplicateTemplate(name, others, editingId)) issues.name = 'templates.duplicateName';
  if (d.notes.length > 500) issues.notes = 'validation.tooLong';
  if (d.items.length === 0) issues.exercises = 'templates.needExercise';
  else if (d.items.length > MAX_TEMPLATE_EXERCISES) issues.exercises = 'templates.tooMany';

  const exercises: TemplateInput['exercises'] = [];
  for (const item of d.items) {
    const reps = item.kind === 'reps';
    const fields: Record<ItemField, ReturnType<typeof readInt>> = {
      sets: readInt(item.sets, 1, 20, true),
      repsMin: readInt(item.repsMin, 1, 1000, reps),
      repsMax: readInt(item.repsMax, 1, 1000, false),
      durationSec: readInt(item.durationSec, 1, 7200, !reps),
      restSec: readInt(item.restSec, 0, 900, true),
    };
    for (const f of Object.keys(fields) as ItemField[]) {
      const r = fields[f];
      if (!r.ok) issues[itemIssueKey(item.key, f)] = r.issue;
    }
    const min = fields.repsMin.ok ? fields.repsMin.value : undefined;
    const max = fields.repsMax.ok ? fields.repsMax.value : undefined;
    if (min !== undefined && max !== undefined && max < min) issues[itemIssueKey(item.key, 'repsMax')] = 'validation.outOfRange';
    const v = (f: ItemField) => { const r = fields[f]; return r.ok ? r.value : undefined; };
    exercises.push({ exerciseId: item.exerciseId, targetSets: v('sets') as number, targetRepsMin: v('repsMin'), targetRepsMax: v('repsMax'), targetDurationSec: v('durationSec'), restSec: v('restSec') as number });
  }
  if (Object.keys(issues).length) return err({ kind: 'validation', issues });

  const parsed = parseInput(templateInput, { name, notes: d.notes.trim() || undefined, exercises });
  return parsed.ok ? { ok: true, value: parsed.value } : err(parsed.error);
}

/** First problem field first, in the order a person meets them on screen: name, exercises, then each row's fields. */
export function orderedIssueKeys(d: TemplateDraft, issues: TemplateIssues): string[] {
  const order = ['name', 'notes', 'exercises', ...d.items.flatMap((i) => (['sets', 'repsMin', 'repsMax', 'durationSec', 'restSec'] as const).map((f) => itemIssueKey(i.key, f)))];
  return order.filter((k) => issues[k]);
}
