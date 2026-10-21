/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real exercise library, detail and form screens against a real in-memory SQLite database
 * (Node SQLite through the repositories). This tests screen logic and persistence wiring, NOT the Expo SQLite
 * native driver, NOT screen-reader output on a device and NOT the visual layout.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { createRepoEnv, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import ExerciseDetailScreen from '../../screens/ExerciseDetailScreen';
import ExerciseFormScreen from '../../screens/ExerciseFormScreen';
import ExerciseLibraryScreen from '../../screens/ExerciseLibraryScreen';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

let mockDb: { state: unknown; retry: () => void };
let mockParams: Record<string, string> = {};
const mockPush = jest.fn();
const mockGoBack = jest.fn();
jest.mock('react-i18next', () => {
  const messages = require('../../locales/en.json');
  const t = (key: string, options?: Record<string, string>) => {
    const text: string = key.split('.').reduce((o: any, p) => (o == null ? undefined : o[p]), messages) ?? key;
    return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
  };
  const value = { t };
  return { useTranslation: () => value };
});
jest.mock('../../context/AppContext', () => ({ useApp: () => ({ isRTL: false }) }));
jest.mock('../../context/DatabaseContext', () => ({ useDatabase: () => mockDb }));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a) },
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
const has = (s: string) => allText().some((t: string) => t.includes(s));
const input = (label: string) => tree.root.find((n: any) => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
const type = async (label: string, v: string) => { await act(async () => { input(label).props.onChangeText(v); }); };
const press = async (match: (n: any) => boolean) => {
  const node = tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && match(n))[0];
  if (!node) throw new Error('no pressable matched');
  await act(async () => { await node.props.onPress(); });
  await flush();
};
const pressText = (label: string) => press((n) => textOf(n) === label);
const pickOne = async (group: string, label: string) => {
  const g = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radiogroup' && n.props.accessibilityLabel === group)[0];
  if (!g) throw new Error(`no radio group "${group}"`);
  const radio = g.findAll((n: any) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function' && textOf(n) === label)[0];
  if (!radio) throw new Error(`"${group}" has no option "${label}"`);
  await act(async () => { await radio.props.onPress(); });
};
const toggle = async (group: string, label: string) => {
  const g = tree.root.findAll((n: any) => n.props.role === 'group' && n.props.accessibilityLabel === group)[0];
  const box = g.findAll((n: any) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function' && textOf(n) === label)[0];
  await act(async () => { await box.props.onPress(); });
};
const checked = (group: string, label: string) => {
  const g = tree.root.findAll((n: any) => n.props.role === 'group' && n.props.accessibilityLabel === group)[0];
  return g.findAll((n: any) => n.props.accessibilityRole === 'checkbox' && textOf(n) === label)[0].props.accessibilityState.checked;
};

const custom = (name = 'Cable woodchop') =>
  env.repos.exercises.create({ name, category: 'strength', primaryMuscle: 'core', equipment: 'cable', trackingType: 'reps_only' }).then(unwrap);
const seeded = async (slug: string) => unwrap(await env.repos.exercises.list({ includeArchived: true })).find((e) => e.slug === slug)!;

beforeEach(async () => {
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  mockParams = {};
  mockPush.mockClear();
  mockGoBack.mockClear();
  announced = [];
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => { announced.push(m); });
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('ExerciseLibraryScreen', () => {
  it('lists the seeded exercises by their English names and says how many there are', async () => {
    await mount(ExerciseLibraryScreen);
    expect(has('Barbell bench press')).toBe(true);
    expect(has(`${SEED_PACK.exercises?.length} exercises`)).toBe(true);
    expect(announced).toEqual([en.library.loading, en.library.loaded]); // each state change is spoken once
  });

  it('searches by name and reports when nothing matches, then clears the search', async () => {
    await mount(ExerciseLibraryScreen);
    await type(en.library.searchLabel, 'bench');
    expect(has('Barbell bench press')).toBe(true);
    expect(has('Pull-up')).toBe(false);
    await type(en.library.searchLabel, 'zzzzzz');
    expect(has(en.library.noResults)).toBe(true);
    await type(en.library.searchLabel, '');
    expect(has('Pull-up')).toBe(true);
  });

  it('opens an exercise on press', async () => {
    await mount(ExerciseLibraryScreen);
    await type(en.library.searchLabel, 'pull-up');
    await press((n) => n.props.accessibilityRole === 'button' && textOf(n).startsWith('Pull-up'));
    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/exercises/[id]' }));
  });

  it('hides hidden exercises until asked, and labels custom ones', async () => {
    const mine = await custom();
    unwrap(await env.repos.exercises.setArchived((await seeded('pull_up')).id, true));
    await mount(ExerciseLibraryScreen);
    expect(has('Pull-up')).toBe(false);
    expect(has('Cable woodchop')).toBe(true);
    expect(has(en.library.custom)).toBe(true);
    await pressText(en.library.filters);
    await press((n) => n.props.accessibilityRole === 'checkbox' && textOf(n) === en.library.showArchived);
    expect(has('Pull-up')).toBe(true);
    expect(mine.id).toBeGreaterThan(0);
  });

  it('shows the empty state when the library has no rows', async () => {
    const fresh = await createRepoEnv();
    await mount(ExerciseLibraryScreen, { status: 'ready', repos: fresh.repos });
    expect(has(en.library.empty)).toBe(true);
  });

  it('reports an unavailable database and retries through the database context', async () => {
    await mount(ExerciseLibraryScreen, { status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(en.library.unavailable)).toBe(true);
    expect(announced.some((a) => a.includes(en.library.unavailable))).toBe(true);
    await pressText(en.library.reload);
    expect(mockDb.retry).toHaveBeenCalled();
  });

  it('reports a failed read instead of an empty list', async () => {
    const repos = { ...env.repos, exercises: { ...env.repos.exercises, list: async () => ({ ok: false, error: { kind: 'unknown', message: 'boom' } }) } };
    await mount(ExerciseLibraryScreen, { status: 'ready', repos });
    expect(has(en.library.readFailed)).toBe(true);
    expect(has(en.library.empty)).toBe(false);
  });
});

describe('ExerciseDetailScreen', () => {
  it('built-in: offers duplicate and hide, but no edit or delete', async () => {
    mockParams = { id: String((await seeded('pull_up')).id) };
    await mount(ExerciseDetailScreen);
    expect(has(en.library.builtInNote)).toBe(true);
    expect(has(en.library.duplicate)).toBe(true);
    expect(has(en.library.edit)).toBe(false);
    expect(has(en.library.delete)).toBe(false);
    await pressText(en.library.duplicate);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/exercises/form', params: { copyFrom: mockParams.id } });
  });

  it('hides and shows again a built-in exercise, keeping the row', async () => {
    const ex = await seeded('pull_up');
    mockParams = { id: String(ex.id) };
    await mount(ExerciseDetailScreen);
    await pressText(en.library.hide);
    expect(unwrap(await env.repos.exercises.get(ex.id)).isArchived).toBe(true);
    expect(announced).toContain(en.library.hiddenDone);
    await pressText(en.library.unhide);
    expect(unwrap(await env.repos.exercises.get(ex.id)).isArchived).toBe(false);
  });

  it('custom: deletes only after confirmation', async () => {
    const mine = await custom();
    mockParams = { id: String(mine.id) };
    await mount(ExerciseDetailScreen);
    await pressText(en.library.delete);
    expect(unwrap(await env.repos.exercises.list({ includeArchived: true })).some((e) => e.id === mine.id)).toBe(true);
    await pressText(en.library.keep);
    await pressText(en.library.delete);
    await pressText(en.library.deleteConfirmYes);
    expect(unwrap(await env.repos.exercises.list({ includeArchived: true })).some((e) => e.id === mine.id)).toBe(false);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('custom: refuses to delete an exercise a workout uses and says to hide it', async () => {
    const mine = await custom();
    unwrap(await env.repos.templates.create({ name: 'Mine', exercises: [{ exerciseId: mine.id, targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSec: 60 }] }));
    mockParams = { id: String(mine.id) };
    await mount(ExerciseDetailScreen);
    await pressText(en.library.delete);
    await pressText(en.library.deleteConfirmYes);
    expect(has(en.library.inUse)).toBe(true);
    expect(mockGoBack).not.toHaveBeenCalled();
    expect(unwrap(await env.repos.exercises.get(mine.id)).id).toBe(mine.id);
  });

  it('reports an unknown or malformed id as not found', async () => {
    mockParams = { id: '999999' };
    await mount(ExerciseDetailScreen);
    expect(has(en.library.notFound)).toBe(true);
    act(() => tree.unmount());
    mockParams = { id: 'abc' };
    await mount(ExerciseDetailScreen);
    expect(has(en.library.notFound)).toBe(true);
  });
});

describe('ExerciseFormScreen', () => {
  const fillValid = async (name: string) => {
    await type(en.library.name, name);
    await pickOne(en.library.category, 'Strength');
    await pickOne(en.library.primary, 'Chest');
    await pickOne(en.library.equipment, 'Dumbbell');
    await pickOne(en.library.tracking, 'Weight and reps');
  };

  it('starts empty with nothing chosen for the person, and reports every missing field', async () => {
    await mount(ExerciseFormScreen);
    expect(input(en.library.name).props.value).toBe('');
    await pressText(en.library.save);
    expect(has(en.validation.required)).toBe(true);
    expect(allText().filter((x: string) => x === en.library.chooseOne)).toHaveLength(4);
    expect(announced.some((a) => a.includes(en.library.fieldNames.name))).toBe(true);
    expect(unwrap(await env.repos.exercises.list({ includeArchived: true })).every((e) => e.source === 'seed')).toBe(true);
  });

  it('creates an exercise, announces it and goes back', async () => {
    await mount(ExerciseFormScreen);
    await fillValid('Zottman curl');
    await toggle(en.library.secondary, 'Forearms');
    await pressText(en.library.save);
    const mine = unwrap(await env.repos.exercises.list({ includeArchived: true })).find((e) => e.customName === 'Zottman curl')!;
    expect(mine).toMatchObject({ source: 'user', primaryMuscle: 'chest', equipment: 'dumbbell', secondaryMuscles: ['forearms'] });
    expect(announced).toContain(en.library.created);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('rejects a name that matches a built-in one (spelling and case aside)', async () => {
    await mount(ExerciseFormScreen);
    await fillValid('  pull  UP ');
    await pressText(en.library.save);
    expect(has(en.library.duplicateName)).toBe(true);
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('choosing the main muscle removes it from "also works"', async () => {
    await mount(ExerciseFormScreen);
    await pickOne(en.library.primary, 'Back');
    await toggle(en.library.secondary, 'Chest');
    expect(checked(en.library.secondary, 'Chest')).toBe(true);
    await pickOne(en.library.primary, 'Chest');
    expect(tree.root.findAll((n: any) => n.props.role === 'group' && n.props.accessibilityLabel === en.library.secondary)[0]
      .findAll((n: any) => n.props.accessibilityRole === 'checkbox' && textOf(n) === 'Chest')).toHaveLength(0);
  });

  it('copies a built-in exercise with every detail but the name, which must be new', async () => {
    mockParams = { copyFrom: String((await seeded('pull_up')).id) };
    await mount(ExerciseFormScreen);
    expect(input(en.library.name).props.value).toBe('');
    await type(en.library.name, 'Wide pull-up');
    await pressText(en.library.save);
    const copy = unwrap(await env.repos.exercises.list({ includeArchived: true })).find((e) => e.customName === 'Wide pull-up')!;
    const original = await seeded('pull_up');
    expect(copy).toMatchObject({ source: 'user', category: original.category, primaryMuscle: original.primaryMuscle, equipment: original.equipment });
    expect(unwrap(await env.repos.exercises.get(original.id)).source).toBe('seed');
  });

  it('edits a custom exercise in place and allows keeping its own name', async () => {
    const mine = await custom();
    mockParams = { id: String(mine.id) };
    await mount(ExerciseFormScreen);
    expect(input(en.library.name).props.value).toBe('Cable woodchop');
    await pressText(en.library.save); // unchanged: its own name is not a duplicate
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await type(en.library.name, 'Cable chop');
    await pressText(en.library.save);
    expect(unwrap(await env.repos.exercises.get(mine.id)).customName).toBe('Cable chop');
    expect(unwrap(await env.repos.exercises.list({ includeArchived: true })).filter((e) => e.source === 'user')).toHaveLength(1);
  });

  it('refuses to edit a built-in exercise through the edit route', async () => {
    mockParams = { id: String((await seeded('pull_up')).id) };
    await mount(ExerciseFormScreen);
    expect(has(en.library.notFound)).toBe(true);
    expect(tree.root.findAll((n: any) => typeof n.props.onChangeText === 'function')).toHaveLength(0);
  });

  it('shows a storage failure and keeps what was typed', async () => {
    const repos = { ...env.repos, exercises: { ...env.repos.exercises, create: async () => ({ ok: false, error: { kind: 'busy', message: 'locked' } }) } };
    await mount(ExerciseFormScreen, { status: 'ready', repos });
    await fillValid('Zottman curl');
    await pressText(en.library.save);
    expect(has(en.errors.busy)).toBe(true);
    expect(input(en.library.name).props.value).toBe('Zottman curl');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('reports an unavailable database', async () => {
    await mount(ExerciseFormScreen, { status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(en.library.unavailable)).toBe(true);
  });
});
