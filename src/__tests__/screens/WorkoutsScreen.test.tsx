/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real Workouts tab: the person's saved workouts, no built-in sample workouts against a real in-memory SQLite database
 * (Node SQLite through the repositories). This tests screen logic and persistence wiring, NOT the Expo SQLite
 * native driver, NOT screen-reader output on a device and NOT the visual layout.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { createRepoEnv, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';
import WorkoutsScreen from '../../screens/WorkoutsScreen';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

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
jest.mock('../../context/AppContext', () => ({ useApp: () => ({ isRTL: mockLocale === 'ar' }) }));
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
const mockTitles: string[] = [];
jest.mock('../../components/AppHeader', () => ({ AppHeader: ({ title }: { title: string }) => { mockTitles.push(title); return null; }, goBack: () => mockGoBack() }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

jest.setTimeout(30_000);

let env: RepoEnv;
let tree: any;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async (state: unknown = { status: 'ready', repos: env.repos }) => {
  mockDb = { state, retry: jest.fn() };
  await act(async () => { tree = TestRenderer.create(<WorkoutsScreen />); });
  await flush();
};
const textOf = (node: any): string => (node.children as any[]).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const allText = () => tree.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map(textOf);
const has = (s: string) => allText().some((x: string) => x.includes(s));
const pressables = (match: (n: any) => boolean) => tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && match(n));
const press = async (nodes: any[]) => {
  if (!nodes.length) throw new Error('no pressable matched');
  await act(async () => { await nodes[0].props.onPress(); });
  await flush();
};
const rows = () => pressables((n) => n.props.accessibilityRole === 'button' && /, \S+ \d+$|, \d+ exercises$|, .*\d/.test(String(n.props.accessibilityLabel ?? '')) && !String(n.props.accessibilityLabel).startsWith('Workout in progress')).map((n: any) => n.props.accessibilityLabel as string);

let bench = 0;
const template = (name: string, n = 1) => env.repos.templates.create({ name, exercises: Array.from({ length: n }, () => ({ exerciseId: bench, targetSets: 3, targetRepsMin: 8, restSec: 60 })) }).then(unwrap);

beforeEach(async () => {
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  bench = unwrap(await env.repos.exercises.list()).find((e) => e.slug === 'bench_press')!.id;
  mockParams = {};
  mockLocale = 'en';
  mockPush.mockReset();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('WorkoutsScreen', () => {
  it('has no built-in sample workouts: with nothing saved it only offers to create one', async () => {
    await mount();
    for (const demo of ['Upper Body Strength', 'Lower Body Power', 'Core Stability', 'Start workout', 'kcal']) expect(has(demo)).toBe(false);
    expect(has(en.templates.empty)).toBe(true);
    await press(pressables((n) => n.children.length && textOf(n) === en.templates.create));
    expect(mockPush).toHaveBeenCalledWith('/templates/form');
  });

  it('lists the saved workouts, newest edit first, and opens one on its detail screen', async () => {
    const old = await template('Older', 2);
    env.clock.advance(1000);
    const newest = await template('Newest', 1);
    await mount();
    expect(rows()).toEqual(['Newest, 1 exercises', 'Older, 2 exercises']);
    await press(pressables((n) => n.props.accessibilityLabel === 'Older, 2 exercises'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: String(old.id) } });
    await press(pressables((n) => n.props.accessibilityLabel === 'Newest, 1 exercises'));
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/templates/[id]', params: { id: String(newest.id) } });
  });

  it('a workout that is deleted is gone from the list', async () => {
    const t = await template('Gone');
    await template('Kept');
    unwrap(await env.repos.templates.delete(t.id));
    await mount();
    expect(rows()).toEqual(['Kept, 1 exercises']);
  });

  it('shows a way back into a workout in progress, and nothing when there is none', async () => {
    const t = await template('Push day');
    await mount();
    expect(has('Workout in progress')).toBe(false);
    act(() => tree.unmount());
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    await mount();
    expect(has('Workout in progress: Push day')).toBe(true);
    await press(pressables((n) => n.props.accessibilityLabel === 'Workout in progress: Push day'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: String(s.id) } });
  });

  it('links to the exercise library and to the workout history', async () => {
    await mount();
    await press(pressables((n) => n.props.accessibilityLabel === en.library.libraryLink));
    expect(mockPush).toHaveBeenLastCalledWith('/exercises');
    await press(pressables((n) => n.props.accessibilityLabel === en.history.link));
    expect(mockPush).toHaveBeenLastCalledWith('/history');
  });

  it('read failure, unavailable database and loading are shown as such, never as an empty list', async () => {
    await mount({ status: 'ready', repos: { ...env.repos, templates: { ...env.repos.templates, list: async () => ({ ok: false, error: { kind: 'unknown', message: 'boom' } }) } } });
    expect(has(en.templates.readFailed)).toBe(true);
    expect(has(en.templates.empty)).toBe(false);
    act(() => tree.unmount());
    await mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(en.templates.unavailable)).toBe(true);
    act(() => tree.unmount());
    await mount({ status: 'loading' });
    expect(has(en.templates.loading)).toBe(true);
  });

  it('uses the Arabic strings', async () => {
    await template('Push day');
    mockLocale = 'ar';
    await mount();
    expect(has(ar.workouts.subtitle)).toBe(true);
    expect(has(ar.history.link)).toBe(true);
    expect(has(ar.library.libraryLink)).toBe(true);
  });
});
