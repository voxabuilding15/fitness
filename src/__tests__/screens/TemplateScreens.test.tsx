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
  await pressLabel(`${tpl.add}: ${name}`);
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
