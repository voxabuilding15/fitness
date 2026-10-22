/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real workout list, detail and builder screens against a real in-memory SQLite database
 * (Node SQLite through the repositories). This tests screen logic and persistence wiring, NOT the Expo SQLite
 * native driver, NOT screen-reader output on a device and NOT the visual layout.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { createRepoEnv, errorOf, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';
import TemplateDetailScreen from '../../screens/TemplateDetailScreen';
import TemplateFormScreen from '../../screens/TemplateFormScreen';
import WorkoutsScreen from '../../screens/WorkoutsScreen';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

let mockSettings: { experience: 'beginner' | 'intermediate' | 'advanced'; cautionAreas: string[] } = { experience: 'intermediate', cautionAreas: [] };
let mockDb: { state: unknown; retry: () => void };
let mockParams: Record<string, string> = {};
let mockLocale: 'en' | 'ar' = 'en';
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockGoBack = jest.fn();
jest.mock('react-i18next', () => {
  const messages = { en: require('../../locales/en.json'), ar: require('../../locales/ar.json') };
  const tFor = (locale: 'en' | 'ar') => (key: string, options?: Record<string, string>) => {
    const text: string = key.split('.').reduce((o: any, p) => (o == null ? undefined : o[p]), messages[locale]) ?? key;
    return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
  };
  const values = { en: { t: tFor('en') }, ar: { t: tFor('ar') } };
  return { useTranslation: () => values[mockLocale] };
});
jest.mock('../../context/AppContext', () => ({ useApp: () => ({ isRTL: mockLocale === 'ar', settings: mockSettings }) }));
jest.mock('../../context/DatabaseContext', () => ({ useDatabase: () => mockDb }));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a) },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});
jest.mock('../../services/soundService', () => ({ playSound: jest.fn() }));
jest.mock('../../components/Screen', () => ({ Screen: (props: { children: unknown }) => props.children }));
jest.mock('../../components/AppHeader', () => ({ AppHeader: () => null, goBack: () => mockGoBack() }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

jest.setTimeout(30_000);

let env: RepoEnv;
let tree: any;
let announced: string[];
const tpl = en.templates;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async (Screen: React.ComponentType, state: unknown = { status: 'ready', repos: env.repos }) => {
  mockDb = { state, retry: jest.fn() };
  await act(async () => { tree = TestRenderer.create(<Screen />); });
  await flush();
};
const textOf = (node: any): string => (node.children as any[]).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const allText = () => tree.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map(textOf);
const has = (s: string) => allText().some((x: string) => x.includes(s));
const input = (label: string) => tree.root.find((n: any) => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
const type = async (label: string, v: string) => { await act(async () => { input(label).props.onChangeText(v); }); };
const press = async (match: (n: any) => boolean) => {
  const node = tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && !n.props.disabled && match(n))[0];
  if (!node) throw new Error('no pressable matched');
  await act(async () => { await node.props.onPress(); });
  await flush();
};
const pressText = (label: string) => press((n) => textOf(n) === label);
const pressLabel = (label: string) => press((n) => n.props.accessibilityLabel === label);
const rowNames = () => allText().filter((x: string) => /^\d+\. /.test(x));

const ids = async () => {
  const all = unwrap(await env.repos.exercises.list({ includeArchived: true }));
  return (slug: string) => all.find((e) => e.slug === slug)!.id;
};
const makeTemplate = async (name = 'Push day', slugs = ['bench_press', 'overhead_press']) => {
  const id = await ids();
  return unwrap(await env.repos.templates.create({ name, exercises: slugs.map((s) => ({ exerciseId: id(s), targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSec: 60 })) }));
};
const addByName = async (name: string) => {
  await type(tpl.pickerSearch, name);
  // the label may carry hints after the name ("..., Already added: 1")
  const pattern = new RegExp(`^${tpl.add}: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`);
  await press((n) => pattern.test(String(n.props.accessibilityLabel ?? '')));
};

beforeEach(async () => {
  mockSettings = { experience: 'intermediate', cautionAreas: [] };
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  mockParams = {};
  mockLocale = 'en';
  mockPush.mockClear();
  mockReplace.mockClear();
  mockGoBack.mockClear();
  announced = [];
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => { announced.push(m); });
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('WorkoutsScreen (the saved-workout list)', () => {
  it('shows the empty state with a way to create the first workout', async () => {
    await mount(WorkoutsScreen);
    expect(has(tpl.empty)).toBe(true);
    await pressText(tpl.create);
    expect(mockPush).toHaveBeenCalledWith('/templates/form');
    expect(announced).toEqual([tpl.loading, tpl.loaded]);
  });

  it('lists saved workouts with their exercise counts and opens one', async () => {
    const t = await makeTemplate();
    await mount(WorkoutsScreen);
    expect(has('Push day')).toBe(true);
    expect(has('2 exercises')).toBe(true);
    await press((n) => n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel).startsWith('Push day'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: String(t.id) } });
  });

  it('says so when the database is unavailable and retries through the database context', async () => {
    await mount(WorkoutsScreen, { status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(tpl.unavailable)).toBe(true);
    await pressText(tpl.reload);
    expect(mockDb.retry).toHaveBeenCalled();
  });

  it('a failed read is reported as a failure, never as "no workouts"', async () => {
    const repos = { ...env.repos, templates: { ...env.repos.templates, list: async () => ({ ok: false, error: { kind: 'unknown', message: 'boom' } }) } };
    await mount(WorkoutsScreen, { status: 'ready', repos });
    expect(has(tpl.readFailed)).toBe(true);
    expect(has(tpl.empty)).toBe(false);
  });
});

describe('TemplateFormScreen (the builder)', () => {
  it('builds a workout of five library exercises, saves it, and it is stored in that order with its targets', async () => {
    await mount(TemplateFormScreen);
    await type(tpl.name, 'Full body');
    await pressText(tpl.add);
    for (const name of ['Barbell bench press', 'Pull-up', 'Barbell back squat', 'Plank', 'Running']) await addByName(name);
    expect(rowNames()).toEqual(['1. Barbell bench press', '2. Pull-up', '3. Barbell back squat', '4. Plank', '5. Running']);
    expect(announced).toContain('Running added.');
    await type(`${tpl.sets}, Pull-up`, '5');
    await type(`${tpl.repsMin}, Pull-up`, '4');
    await type(`${tpl.repsMax}, Pull-up`, '6');
    await type(`${tpl.rest}, Pull-up`, '120');
    await pressText(tpl.save);

    expect(announced).toContain(tpl.created);
    expect(mockGoBack).toHaveBeenCalled();
    const saved = unwrap(await env.repos.templates.list());
    expect(saved).toHaveLength(1);
    const lookup = await ids();
    expect(saved[0].exercises.map((e) => e.exerciseId)).toEqual(['bench_press', 'pull_up', 'back_squat', 'plank', 'running'].map(lookup));
    expect(saved[0].exercises[1]).toMatchObject({ position: 2, targetSets: 5, targetRepsMin: 4, targetRepsMax: 6, restSec: 120 });
    expect(saved[0].exercises[3]).toMatchObject({ targetDurationSec: 30, targetRepsMin: null }); // plank is timed
  });

  it('reorders and removes rows, and announces each change', async () => {
    await mount(TemplateFormScreen);
    await pressText(tpl.add);
    for (const name of ['Pull-up', 'Plank', 'Running']) await addByName(name);
    await pressLabel(`${tpl.moveUp}: Running`);
    expect(rowNames()).toEqual(['1. Pull-up', '2. Running', '3. Plank']);
    expect(announced).toContain('Running moved to position 2 of 3.');
    await pressLabel(`${tpl.remove}: Pull-up`);
    expect(rowNames()).toEqual(['1. Running', '2. Plank']);
    expect(announced).toContain('Pull-up removed.');
    // the top row cannot move up
    const first = tree.root.findAll((n: any) => n.props.accessibilityLabel === `${tpl.moveUp}: Running`)[0];
    expect(first.props.accessibilityState.disabled).toBe(true);
  });

  it('will not save an empty workout, a missing name, or invalid numbers, and writes nothing', async () => {
    await mount(TemplateFormScreen);
    await pressText(tpl.save);
    expect(has(en.validation.required)).toBe(true);
    expect(has(tpl.noExercises) || has(tpl.needExercise)).toBe(true);
    expect(announced.some((a) => a.includes(tpl.fieldName) && a.includes(tpl.fieldExercises))).toBe(true);

    await type(tpl.name, 'X');
    await pressText(tpl.add);
    await addByName('Pull-up');
    await type(`${tpl.sets}, Pull-up`, '0');
    await type(`${tpl.rest}, Pull-up`, 'abc');
    await pressText(tpl.save);
    expect(has(en.validation.outOfRange)).toBe(true);
    expect(has(en.validation.invalid)).toBe(true);
    expect(announced.some((a) => a.includes('Pull-up'))).toBe(true);
    expect(unwrap(await env.repos.templates.list())).toEqual([]);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('rejects a name that another workout already has', async () => {
    await makeTemplate('Push day');
    await mount(TemplateFormScreen);
    await type(tpl.name, 'push DAY');
    await pressText(tpl.add);
    await addByName('Pull-up');
    await pressText(tpl.save);
    expect(has(tpl.duplicateName)).toBe(true);
    expect(unwrap(await env.repos.templates.list())).toHaveLength(1);
  });

  it('the picker leaves out hidden exercises and reports when nothing matches', async () => {
    const lookup = await ids();
    unwrap(await env.repos.exercises.setArchived(lookup('pull_up'), true));
    await mount(TemplateFormScreen);
    await pressText(tpl.add);
    await type(tpl.pickerSearch, 'pull');
    expect(has('Pull-up')).toBe(false);
    await type(tpl.pickerSearch, 'zzzzz');
    expect(has(tpl.pickerEmpty)).toBe(true);
  });

  it('edits an existing workout in place: rename, drop a row, change a target', async () => {
    const t = await makeTemplate('Push day');
    const other = await makeTemplate('Legs', ['back_squat']);
    mockParams = { id: String(t.id) };
    await mount(TemplateFormScreen);
    expect(input(tpl.name).props.value).toBe('Push day');
    await type(tpl.name, 'Push day v2');
    await pressLabel(`${tpl.remove}: Barbell overhead press`);
    await type(`${tpl.sets}, Barbell bench press`, '4');
    await pressText(tpl.save);
    const after = unwrap(await env.repos.templates.get(t.id));
    expect(after.name).toBe('Push day v2');
    expect(after.exercises).toHaveLength(1);
    expect(after.exercises[0].targetSets).toBe(4);
    expect(announced).toContain(tpl.saved);
    expect(unwrap(await env.repos.templates.get(other.id))).toEqual(other);
  });

  it('keeps its own name when saved unchanged', async () => {
    const t = await makeTemplate('Push day');
    mockParams = { id: String(t.id) };
    await mount(TemplateFormScreen);
    await pressText(tpl.save);
    expect(has(tpl.duplicateName)).toBe(false);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  it('a failed save keeps what was typed and leaves the saved workout untouched', async () => {
    const t = await makeTemplate('Push day');
    const repos = { ...env.repos, templates: { ...env.repos.templates, update: async () => ({ ok: false, error: { kind: 'busy', message: 'locked' } }) } };
    mockParams = { id: String(t.id) };
    await mount(TemplateFormScreen, { status: 'ready', repos });
    await type(tpl.name, 'Renamed');
    await pressText(tpl.save);
    expect(has(en.errors.busy)).toBe(true);
    expect(input(tpl.name).props.value).toBe('Renamed');
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(unwrap(await env.repos.templates.get(t.id))).toEqual(t);
  });

  it('a failed read offers no form at all, so nothing can be saved over unread data', async () => {
    const t = await makeTemplate('Push day');
    const update = jest.fn();
    const repos = { ...env.repos, templates: { ...env.repos.templates, list: async () => ({ ok: false, error: { kind: 'unknown', message: 'boom' } }), update } };
    mockParams = { id: String(t.id) };
    await mount(TemplateFormScreen, { status: 'ready', repos });
    expect(has(tpl.readFailed)).toBe(true);
    expect(tree.root.findAll((n: any) => typeof n.props.onChangeText === 'function')).toHaveLength(0);
    expect(tree.root.findAll((n: any) => textOf(n) === tpl.save && typeof n.props.onPress === 'function')).toHaveLength(0);
    expect(update).not.toHaveBeenCalled();
  });

  it('reports an unknown workout id and an unavailable database', async () => {
    mockParams = { id: '999999' };
    await mount(TemplateFormScreen);
    expect(has(tpl.notFound)).toBe(true);
    act(() => tree.unmount());
    mockParams = {};
    await mount(TemplateFormScreen, { status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(tpl.unavailable)).toBe(true);
  });
});

describe('TemplateFormScreen: selection, ordering and validation UX', () => {
  const group = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityRole === 'radiogroup' && n.props.accessibilityLabel === label)[0];
  const pickChip = async (groupLabel: string, option: string) => {
    const radio = group(groupLabel).findAll((n: any) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function' && textOf(n) === option)[0];
    await act(async () => { await radio.props.onPress(); });
    await flush();
  };
  const offered = (): string[] => [...new Set<string>(tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel ?? '').startsWith(`${tpl.add}: `)).map((n: any) => String(n.props.accessibilityLabel).slice(tpl.add.length + 2).split(',')[0]))];
  const problemLines = () => allText().filter((x: string) => /^(Workout name|Exercises|Notes|.*, (Sets|Rest|Reps|Seconds).*): /.test(x));

  it('a fresh form shows no errors; after a failed Save it lists every problem, and each disappears as soon as it is fixed', async () => {
    await mount(TemplateFormScreen);
    expect(has(tpl.fixTitle)).toBe(false);
    await pressText(tpl.save);
    expect(has(tpl.fixTitle)).toBe(true);
    expect(problemLines()).toEqual([`${tpl.name}: ${en.validation.required}`, `${tpl.exercises}: ${tpl.needExercise}`]);
    await type(tpl.name, 'Legs');
    expect(problemLines()).toEqual([`${tpl.exercises}: ${tpl.needExercise}`]);
    await pressText(tpl.add);
    await addByName('Pull-up');
    expect(has(tpl.fixTitle)).toBe(false); // nothing left to fix, without pressing Save again
    expect(unwrap(await env.repos.templates.list())).toEqual([]); // and nothing was saved by that
  });

  it('a bad number is named by exercise and field, and is cleared by typing a good one', async () => {
    await mount(TemplateFormScreen);
    await type(tpl.name, 'Legs');
    await pressText(tpl.add);
    await addByName('Pull-up');
    await type(`${tpl.sets}, Pull-up`, '0');
    await pressText(tpl.save);
    expect(problemLines()).toEqual([`Pull-up, ${tpl.sets}: ${en.validation.outOfRange}`]);
    await type(`${tpl.sets}, Pull-up`, '3');
    expect(has(tpl.fixTitle)).toBe(false);
    await pressText(tpl.save);
    expect(unwrap(await env.repos.templates.list())).toHaveLength(1);
  });

  it('a duplicate name is reported with the others, and fixed by renaming', async () => {
    await makeTemplate('Push day');
    await mount(TemplateFormScreen);
    await type(tpl.name, 'push day');
    await pressText(tpl.add);
    await addByName('Pull-up');
    await pressText(tpl.save);
    expect(problemLines()).toEqual([`${tpl.name}: ${tpl.duplicateName}`]);
    await type(tpl.name, 'Pull day');
    expect(has(tpl.fixTitle)).toBe(false);
  });

  it('Cancel leaves at once when nothing changed, and when a change was undone', async () => {
    await mount(TemplateFormScreen);
    await pressText(tpl.cancel);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await type(tpl.name, 'x');
    await type(tpl.name, '');
    await pressText(tpl.cancel);
    expect(mockGoBack).toHaveBeenCalledTimes(2);
  });

  it('Cancel with unsaved changes asks first; keep editing keeps them, discard leaves without saving', async () => {
    await mount(TemplateFormScreen);
    await type(tpl.name, 'Draft');
    await pressText(tpl.cancel);
    expect(has(tpl.discardTitle)).toBe(true);
    expect(mockGoBack).not.toHaveBeenCalled();
    await pressText(tpl.keepEditing);
    expect(input(tpl.name).props.value).toBe('Draft');
    expect(has(tpl.discardTitle)).toBe(false);
    await pressText(tpl.cancel);
    await pressText(tpl.discardYes);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(unwrap(await env.repos.templates.list())).toEqual([]);
  });

  it('editing an existing workout: changing it makes Cancel ask, an untouched form does not, and saving does not ask', async () => {
    const t = await makeTemplate('Push day');
    mockParams = { id: String(t.id) };
    await mount(TemplateFormScreen);
    await pressText(tpl.cancel);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await type(`${tpl.sets}, Barbell bench press`, '5');
    await pressText(tpl.save);
    expect(mockGoBack).toHaveBeenCalledTimes(2);
    expect(has(tpl.discardTitle)).toBe(false);
    expect(unwrap(await env.repos.templates.get(t.id)).exercises[0].targetSets).toBe(5);
  });

  it('the picker can be narrowed by muscle and equipment, shows how many match, and a filter with no match says so', async () => {
    await mount(TemplateFormScreen);
    await pressText(tpl.add);
    const all = offered();
    expect(has(`Matches: ${all.length}`)).toBe(true);
    await pressText(en.library.filters);
    await pickChip(en.library.muscle, en.library.muscles.chest);
    const chest = offered();
    expect(chest.length).toBeGreaterThan(0);
    expect(chest.length).toBeLessThan(all.length);
    expect(chest).toContain('Barbell bench press');
    expect(chest).not.toContain('Pull-up');
    await pickChip(en.library.equipment, en.library.equipmentNames.cable);
    expect(offered().every((n) => chest.includes(n))).toBe(true);
    await type(tpl.pickerSearch, 'zzzzz');
    expect(has(tpl.pickerEmpty)).toBe(true);
    await pressText(en.library.clearFilters); // clears the filters and the search text together
    expect(has(tpl.pickerEmpty)).toBe(false);
    expect(offered()).toEqual(all);
  });

  it('an exercise already in the workout says how many times, and can still be added again', async () => {
    await mount(TemplateFormScreen);
    await pressText(tpl.add);
    await addByName('Pull-up');
    await addByName('Pull-up');
    expect(tree.root.findAll((n: any) => String(n.props.accessibilityLabel ?? '').startsWith(`${tpl.add}: Pull-up`)).some((n: any) => String(n.props.accessibilityLabel).includes('Already added: 2'))).toBe(true);
    expect(rowNames()).toEqual(['1. Pull-up', '2. Pull-up']);
  });

  it('with many exercises, rows can be sent straight to the top or bottom', async () => {
    await mount(TemplateFormScreen);
    await pressText(tpl.add);
    for (const name of ['Pull-up', 'Plank', 'Running', 'Walking']) await addByName(name);
    expect(tree.root.findAll((n: any) => String(n.props.accessibilityLabel ?? '').startsWith(`${tpl.moveTop}:`))).toHaveLength(0); // four rows: not needed
    await addByName('Burpee');
    await pressLabel(`${tpl.moveTop}: Burpee`);
    expect(rowNames()).toEqual(['1. Burpee', '2. Pull-up', '3. Plank', '4. Running', '5. Walking']);
    expect(announced).toContain('Burpee moved to position 1 of 5.');
    await pressLabel(`${tpl.moveBottom}: Burpee`);
    expect(rowNames()).toEqual(['1. Pull-up', '2. Plank', '3. Running', '4. Walking', '5. Burpee']);
    const first = tree.root.findAll((n: any) => n.props.accessibilityLabel === `${tpl.moveTop}: Pull-up`)[0];
    expect(first.props.accessibilityState.disabled).toBe(true);
  });

  it('uses the Arabic strings for the new messages', async () => {
    mockLocale = 'ar';
    await mount(TemplateFormScreen);
    await pressText(ar.templates.save);
    expect(has(ar.templates.fixTitle)).toBe(true);
    await type(ar.templates.name, 'x');
    await pressText(ar.templates.cancel);
    expect(has(ar.templates.discardTitle)).toBe(true);
  });
});

describe('TemplateDetailScreen: the overview before starting', () => {
  const ov = en.overview;
  const overviewTemplate = async () => {
    const id = await ids();
    return unwrap(await env.repos.templates.create({
      name: 'Mixed',
      exercises: [
        { exerciseId: id('bench_press'), targetSets: 4, targetRepsMin: 6, restSec: 90 },
        { exerciseId: id('overhead_press'), targetSets: 3, targetRepsMin: 8, restSec: 90 },
        { exerciseId: id('plank'), targetSets: 2, targetDurationSec: 45, restSec: 30 },
        { exerciseId: id('pull_up'), targetSets: 3, targetRepsMin: 5, restSec: 120 },
      ],
    }));
  };

  it('shows how many exercises and sets, the equipment, and the main and supporting muscles', async () => {
    const t = await overviewTemplate();
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(has(ov.title)).toBe(true);
    expect(has('Exercises: 4')).toBe(true);
    expect(has('Sets in total: 12')).toBe(true);
    expect(has('Equipment: Barbell, Bodyweight')).toBe(true);
    expect(has('Main muscles: Chest, Shoulders, Core, Back')).toBe(true);
    expect(has('Also works: Triceps, Biceps, Forearms')).toBe(true); // shoulders is a main muscle here, so it is not repeated
  });

  it('each exercise shows its targets and its muscle and equipment', async () => {
    const t = await overviewTemplate();
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(rowNames()).toEqual(['1. Barbell bench press', '2. Barbell overhead press', '3. Plank', '4. Pull-up']);
    expect(has('Chest · Barbell')).toBe(true);
    expect(has('Core · Bodyweight')).toBe(true);
    expect(has('2 × 45 s · rest 30 s')).toBe(true);
    const row = tree.root.findAll((n: any) => n.props.accessible && String(n.props.accessibilityLabel ?? '').startsWith('3. Plank'))[0];
    expect(row.props.accessibilityLabel).toBe('3. Plank, 2 × 45 s · rest 30 s, Core · Bodyweight');
  });

  it('offers Start as the main action, with Edit beside it, and neither changes the saved workout', async () => {
    const t = await overviewTemplate();
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    const start = tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && textOf(n) === en.liveSession.start)[0];
    expect(start.props.accessibilityHint).toBe(ov.startHint);
    const edit = tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && textOf(n) === tpl.edit)[0];
    expect(edit.props.accessibilityHint).toBe(ov.editHint);
    await pressText(tpl.edit);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/templates/form', params: { id: String(t.id) } });
    expect(unwrap(await env.repos.templates.get(t.id))).toEqual(t);
  });

  it('starting from the overview creates one real session whose exercises follow the overview, then opens it', async () => {
    const t = await overviewTemplate();
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    await pressText(en.liveSession.start);
    const active = unwrap(await env.repos.sessions.getActive())!;
    expect(active.exercises.map((e) => e.exerciseId)).toEqual(t.exercises.map((e) => e.exerciseId));
    expect(active.exercises.reduce((n, e) => n + (e.plan?.sets ?? 0), 0)).toBe(12);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: String(active.id) } });
    expect((await env.db.first<{ n: number }>('SELECT COUNT(*) n FROM workout_sessions'))!.n).toBe(1);
  });

  it('an exercise used twice adds its sets twice and lists its equipment once', async () => {
    const id = await ids();
    const t = unwrap(await env.repos.templates.create({ name: 'Twice', exercises: [
      { exerciseId: id('pull_up'), targetSets: 3, targetRepsMin: 5, restSec: 60 }, { exerciseId: id('pull_up'), targetSets: 2, targetRepsMin: 8, restSec: 60 },
    ] }));
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(has('Exercises: 2')).toBe(true);
    expect(has('Sets in total: 5')).toBe(true);
    expect(has('Equipment: Bodyweight')).toBe(true);
  });

  it('a hidden exercise still appears in the overview with its details', async () => {
    const t = await overviewTemplate();
    const id = await ids();
    unwrap(await env.repos.exercises.setArchived(id('plank'), true));
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(has('3. Plank')).toBe(true);
    expect(has('Core · Bodyweight')).toBe(true);
  });

  it('uses the Arabic strings and exercise names', async () => {
    const t = await overviewTemplate();
    mockLocale = 'ar';
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(has(ar.overview.title)).toBe(true);
    expect(has(`${ar.overview.exercises.replace('{{count}}', '4')}`)).toBe(true);
    expect(has(`${ar.library.equipmentNames.barbell}`)).toBe(true);
    expect(rowNames()[0]).toBe(`1. ${ar.exercises.benchPress}`);
  });
});

describe('TemplateDetailScreen', () => {
  it('opens a saved workout showing its exercises in order with their targets', async () => {
    const t = await makeTemplate('Push day');
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(rowNames()).toEqual(['1. Barbell bench press', '2. Barbell overhead press']);
    expect(has('3 × 8–12 · rest 60 s')).toBe(true);
  });

  it('shows exercise names and the summary in Arabic', async () => {
    const t = await makeTemplate('Push day');
    mockLocale = 'ar';
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(rowNames()).toEqual([`1. ${ar.exercises.benchPress}`, `2. ${ar.exercises.overheadPress}`]);
    expect(has('راحة 60 ث')).toBe(true);
    expect(ar.exercises.benchPress).not.toBe(en.exercises.benchPress);
  });

  it('the Arabic builder searches by Arabic name', async () => {
    mockLocale = 'ar';
    await mount(TemplateFormScreen);
    await pressText(ar.templates.add);
    await type(ar.templates.pickerSearch, ar.exercises.pullUp);
    expect(has(ar.exercises.pullUp)).toBe(true);
    await pressLabel(`${ar.templates.add}: ${ar.exercises.pullUp}`);
    expect(rowNames()).toEqual([`1. ${ar.exercises.pullUp}`]);
  });

  it('duplicates without changing the original, with a free name, and opens the copy', async () => {
    const t = await makeTemplate('Push day');
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    await pressText(tpl.duplicate);
    const all = unwrap(await env.repos.templates.list());
    expect(all.map((x) => x.name).sort()).toEqual(['Push day', 'Push day (copy)']);
    expect(unwrap(await env.repos.templates.get(t.id))).toEqual(t);
    const copy = all.find((x) => x.name === 'Push day (copy)')!;
    expect(copy.exercises.map((e) => e.exerciseId)).toEqual(t.exercises.map((e) => e.exerciseId));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: String(copy.id) } });
    await pressText(tpl.duplicate);
    expect(unwrap(await env.repos.templates.list()).map((x) => x.name)).toContain('Push day (copy 2)');
  });

  it('deletes only after confirmation; the exercises and other workouts stay', async () => {
    const t = await makeTemplate('Push day');
    const keep = await makeTemplate('Legs', ['back_squat']);
    const before = unwrap(await env.repos.exercises.list({ includeArchived: true })).length;
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    await pressText(tpl.delete);
    expect(unwrap(await env.repos.templates.list())).toHaveLength(2);
    await pressText(tpl.keep);
    await pressText(tpl.delete);
    await pressText(tpl.deleteConfirmYes);
    expect(unwrap(await env.repos.templates.list()).map((x) => x.id)).toEqual([keep.id]);
    expect(unwrap(await env.repos.exercises.list({ includeArchived: true })).length).toBe(before);
    expect(announced).toContain(tpl.deleted);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('a failed delete reports the failure and keeps the workout', async () => {
    const t = await makeTemplate('Push day');
    const repos = { ...env.repos, templates: { ...env.repos.templates, delete: async () => ({ ok: false, error: { kind: 'busy', message: 'locked' } }) } };
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen, { status: 'ready', repos });
    await pressText(tpl.delete);
    await pressText(tpl.deleteConfirmYes);
    expect(has(en.errors.busy)).toBe(true);
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(errorOf(await env.repos.templates.get(999))).toMatchObject({ kind: 'not_found' });
    expect(unwrap(await env.repos.templates.get(t.id)).name).toBe('Push day');
  });

  it('reports an unknown or malformed id as not found', async () => {
    mockParams = { id: '999999' };
    await mount(TemplateDetailScreen);
    expect(has(tpl.notFound)).toBe(true);
    act(() => tree.unmount());
    mockParams = { id: 'abc' };
    await mount(TemplateDetailScreen);
    expect(has(tpl.notFound)).toBe(true);
  });
});
