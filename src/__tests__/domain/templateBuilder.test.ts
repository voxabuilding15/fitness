import type { WorkoutTemplate } from '../../domain/models';
import {
  MAX_TEMPLATE_EXERCISES, addExercise, countOf, draftFromTemplate, isDirty, moveItemTo, emptyTemplateDraft, findDuplicateTemplate, itemIssueKey, moveItem, orderedIssueKeys,
  planTemplateSave, removeItem, uniqueCopyName, updateItem, type TemplateDraft,
} from '../../domain/templateBuilder';

const strength = (id: number) => ({ id, trackingType: 'weight_reps' as const });
const timedEx = (id: number) => ({ id, trackingType: 'duration' as const });
const withItems = (name = 'Push day', n = 2): TemplateDraft => {
  let d: TemplateDraft = { ...emptyTemplateDraft(), name };
  for (let i = 1; i <= n; i++) d = addExercise(d, strength(i));
  return d;
};
const saved = (id: number, name: string): WorkoutTemplate => ({ id, name, notes: null, createdAt: 1, updatedAt: 1, exercises: [] });
const issuesOf = (r: ReturnType<typeof planTemplateSave>) => (r.ok ? {} : r.error.kind === 'validation' ? r.error.issues : { kind: r.error.kind });

describe('draft operations', () => {
  it('adds exercises in order with ordinary starting targets, by tracking type', () => {
    let d = addExercise(emptyTemplateDraft(), strength(5));
    d = addExercise(d, timedEx(9));
    expect(d.items.map((i) => i.exerciseId)).toEqual([5, 9]);
    expect(d.items[0]).toMatchObject({ kind: 'reps', sets: '3', repsMin: '8', repsMax: '12', durationSec: '', restSec: '60' });
    expect(d.items[1]).toMatchObject({ kind: 'duration', repsMin: '', durationSec: '30' });
    expect(new Set(d.items.map((i) => i.key)).size).toBe(2);
  });

  it('allows the same exercise twice, but never more than the limit', () => {
    let d = emptyTemplateDraft();
    for (let i = 0; i < MAX_TEMPLATE_EXERCISES + 5; i++) d = addExercise(d, strength(1));
    expect(d.items).toHaveLength(MAX_TEMPLATE_EXERCISES);
    expect(planTemplateSave({ ...d, name: 'x' }, []).ok).toBe(true);
  });

  it('moves a row up or down and does nothing at either end or for an unknown row', () => {
    const d = withItems('A', 3);
    const [a, b, c] = d.items.map((i) => i.key);
    expect(moveItem(d, b, -1).items.map((i) => i.key)).toEqual([b, a, c]);
    expect(moveItem(d, b, 1).items.map((i) => i.key)).toEqual([a, c, b]);
    expect(moveItem(d, a, -1)).toBe(d);
    expect(moveItem(d, c, 1)).toBe(d);
    expect(moveItem(d, 999, 1)).toBe(d);
  });

  it('removes only the named row and updates only the named field', () => {
    const d = withItems('A', 3);
    const [a, b, c] = d.items.map((i) => i.key);
    expect(removeItem(d, b).items.map((i) => i.key)).toEqual([a, c]);
    const u = updateItem(d, b, { sets: '5' });
    expect(u.items.map((i) => i.sets)).toEqual(['3', '5', '3']);
    expect(d.items[1].sets).toBe('3'); // the old draft is untouched
  });
});

describe('planTemplateSave', () => {
  it('builds the repository input in row order', () => {
    const d = updateItem(withItems('  Push   day '), 2, { sets: '4', repsMin: '5', repsMax: '', restSec: '90' });
    const r = planTemplateSave(d, []);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.value.name).toBe('Push day');
    expect(r.value.exercises.map((e) => e.exerciseId)).toEqual([1, 2]);
    expect(r.value.exercises[1]).toMatchObject({ targetSets: 4, targetRepsMin: 5, targetRepsMax: undefined, restSec: 90 });
  });

  it('a timed row needs a duration and a rep row needs reps', () => {
    const t = addExercise({ ...emptyTemplateDraft(), name: 'x' }, timedEx(1));
    const r = planTemplateSave(t, []);
    expect(r.ok && r.value.exercises[0].targetDurationSec).toBe(30);
    const cleared = updateItem(t, 1, { durationSec: '' });
    expect(issuesOf(planTemplateSave(cleared, []))).toEqual({ [itemIssueKey(1, 'durationSec')]: 'validation.required' });
    const noReps = updateItem(withItems('x', 1), 1, { repsMin: '' });
    expect(issuesOf(planTemplateSave(noReps, []))).toEqual({ [itemIssueKey(1, 'repsMin')]: 'validation.required' });
  });

  it('requires a name and at least one exercise', () => {
    expect(issuesOf(planTemplateSave(emptyTemplateDraft(), []))).toEqual({ name: 'validation.required', exercises: 'templates.needExercise' });
    expect(issuesOf(planTemplateSave({ ...withItems(), name: '   ' }, [])).name).toBe('validation.required');
    expect(issuesOf(planTemplateSave({ ...withItems(), name: 'x'.repeat(61) }, [])).name).toBe('validation.tooLong');
    expect(issuesOf(planTemplateSave({ ...withItems(), notes: 'x'.repeat(501) }, [])).notes).toBe('validation.tooLong');
  });

  it.each([
    ['sets', '0', 'validation.outOfRange'], ['sets', '21', 'validation.outOfRange'], ['sets', '2.5', 'validation.invalid'], ['sets', 'abc', 'validation.invalid'], ['sets', '', 'validation.required'],
    ['restSec', '901', 'validation.outOfRange'], ['restSec', '-5', 'validation.invalid'], ['repsMin', '1001', 'validation.outOfRange'], ['repsMin', '0', 'validation.outOfRange'],
  ] as const)('rejects %s = "%s"', (field, value, issue) => {
    const r = planTemplateSave(updateItem(withItems('x', 1), 1, { [field]: value }), []);
    expect(issuesOf(r)).toEqual({ [itemIssueKey(1, field)]: issue });
  });

  it('accepts zero rest, and Arabic-Indic digits', () => {
    const r = planTemplateSave(updateItem(withItems('x', 1), 1, { restSec: '0', sets: '٤' }), []);
    expect(r.ok && r.value.exercises[0]).toMatchObject({ restSec: 0, targetSets: 4 });
  });

  it('rejects a maximum below the minimum and reports each bad row separately', () => {
    let d = withItems('x', 2);
    d = updateItem(d, 1, { repsMin: '10', repsMax: '5' });
    d = updateItem(d, 2, { sets: '' });
    expect(issuesOf(planTemplateSave(d, []))).toEqual({ [itemIssueKey(1, 'repsMax')]: 'validation.outOfRange', [itemIssueKey(2, 'sets')]: 'validation.required' });
    expect(orderedIssueKeys(d, issuesOf(planTemplateSave(d, [])))).toEqual([itemIssueKey(1, 'repsMax'), itemIssueKey(2, 'sets')]);
  });

  it('rejects a name another workout already has, however it is spelled, but not its own name when editing', () => {
    const others = [saved(1, 'Push Day'), saved(2, 'Legs')];
    expect(issuesOf(planTemplateSave(withItems('push  day'), others)).name).toBe('templates.duplicateName');
    expect(issuesOf(planTemplateSave(withItems('PUSH-DAY'), others)).name).toBe('templates.duplicateName');
    expect(planTemplateSave(withItems('Push Day'), others, 1).ok).toBe(true);
    expect(issuesOf(planTemplateSave(withItems('Legs'), others, 1)).name).toBe('templates.duplicateName');
  });
});

describe('draftFromTemplate', () => {
  it('reads rows in position order and keeps blanks for absent targets', () => {
    const t: WorkoutTemplate = {
      ...saved(1, 'T'), notes: 'n',
      exercises: [
        { id: 12, exerciseId: 8, position: 2, targetSets: 2, targetRepsMin: null, targetRepsMax: null, targetDurationSec: 45, restSec: 30 },
        { id: 11, exerciseId: 7, position: 1, targetSets: 4, targetRepsMin: 6, targetRepsMax: 10, targetDurationSec: null, restSec: 120 },
      ],
    };
    const d = draftFromTemplate(t);
    expect(d.items.map((i) => i.exerciseId)).toEqual([7, 8]);
    expect(d.items[0]).toMatchObject({ kind: 'reps', sets: '4', repsMin: '6', repsMax: '10', durationSec: '', restSec: '120' });
    expect(d.items[1]).toMatchObject({ kind: 'duration', repsMin: '', durationSec: '45' });
    expect(d.notes).toBe('n');
    // an unchanged draft round-trips to the same input
    const r = planTemplateSave(d, []);
    expect(r.ok && r.value.exercises.map((e) => [e.exerciseId, e.targetSets, e.targetRepsMin, e.targetRepsMax, e.targetDurationSec, e.restSec])).toEqual([
      [7, 4, 6, 10, undefined, 120], [8, 2, undefined, undefined, 45, 30],
    ]);
  });
});

describe('names', () => {
  it('finds duplicates ignoring case and punctuation, and nothing for a blank name', () => {
    expect(findDuplicateTemplate('LEGS.', [saved(1, 'Legs')])?.id).toBe(1);
    expect(findDuplicateTemplate('   ', [saved(1, 'Legs')])).toBeUndefined();
  });
  it('makes the first free copy name and respects the length limit', () => {
    expect(uniqueCopyName('Legs', [saved(1, 'Legs')], 'copy')).toBe('Legs (copy)');
    expect(uniqueCopyName('Legs', [saved(1, 'Legs'), saved(2, 'Legs (copy)')], 'copy')).toBe('Legs (copy 2)');
    const long = 'x'.repeat(60);
    const copy = uniqueCopyName(long, [saved(1, long)], 'copy');
    expect(copy.length).toBeLessThanOrEqual(60);
    expect(copy.endsWith('(copy)')).toBe(true);
    expect(planTemplateSave(withItems(copy), [saved(1, long)]).ok).toBe(true);
  });
});

describe('moveItemTo / countOf / isDirty', () => {
  it('moves a row to the top or bottom, and does nothing when it is already there or unknown', () => {
    const d = withItems('A', 5);
    const keys = d.items.map((i) => i.key);
    expect(moveItemTo(d, keys[3], 'top').items.map((i) => i.key)).toEqual([keys[3], keys[0], keys[1], keys[2], keys[4]]);
    expect(moveItemTo(d, keys[1], 'bottom').items.map((i) => i.key)).toEqual([keys[0], keys[2], keys[3], keys[4], keys[1]]);
    expect(moveItemTo(d, keys[0], 'top')).toBe(d);
    expect(moveItemTo(d, keys[4], 'bottom')).toBe(d);
    expect(moveItemTo(d, 999, 'top')).toBe(d);
    expect(d.items.map((i) => i.key)).toEqual(keys); // the old draft is untouched
  });
  it('counts how many rows use an exercise', () => {
    let d = withItems('A', 2); // exercises 1 and 2
    d = addExercise(d, strength(1));
    expect([countOf(d, 1), countOf(d, 2), countOf(d, 3)]).toEqual([2, 1, 0]);
  });
  it('is dirty only when something really differs, and changing then reverting is not a change', () => {
    const base = withItems('Push', 2);
    expect(isDirty(base, base)).toBe(false);
    expect(isDirty({ ...base, name: 'Push day' }, base)).toBe(true);
    expect(isDirty({ ...base, notes: 'x' }, base)).toBe(true);
    expect(isDirty(updateItem(base, 1, { sets: '4' }), base)).toBe(true);
    expect(isDirty(updateItem(updateItem(base, 1, { sets: '4' }), 1, { sets: '3' }), base)).toBe(false);
    expect(isDirty(moveItem(base, 1, 1), base)).toBe(true);
    expect(isDirty(removeItem(base, 2), base)).toBe(true);
    expect(isDirty(addExercise(base, strength(9)), base)).toBe(true);
    // the same rows with different internal keys are the same workout
    const rekeyed = { ...base, items: base.items.map((i) => ({ ...i, key: i.key + 10 })) };
    expect(isDirty(rekeyed, base)).toBe(false);
  });
});
