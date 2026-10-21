/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real workout history screen (and the saved workout it opens) against a real in-memory SQLite database
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
import HistoryScreen from '../../screens/HistoryScreen';
import SessionScreen from '../../screens/SessionScreen';

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
const mockTitles: string[] = [];
jest.mock('../../components/AppHeader', () => ({ AppHeader: ({ title }: { title: string }) => { mockTitles.push(title); return null; }, goBack: () => mockGoBack() }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

jest.setTimeout(30_000);

let env: RepoEnv;
let tree: any;
let announced: string[];
const hs = en.history;

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
const pressables = (match: (n: any) => boolean) => tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && match(n));
const press = async (nodes: any[]) => {
  const node = nodes.find((n: any) => !n.props.disabled);
  if (!node) throw new Error('no enabled pressable');
  await act(async () => { await node.props.onPress(); });
  await flush();
};
const rows = () => pressables((n) => n.props.accessibilityRole === 'button' && /\d{4}-\d{2}-\d{2}/.test(String(n.props.accessibilityLabel ?? '')));
const withSessions = (sessions: Record<string, unknown>) => ({ ...env.repos, sessions: { ...env.repos.sessions, ...sessions } });

let exerciseId = 0;
/** start -> log one set -> finish (or discard / leave running), a day apart so each has its own local date */
const workout = async (name: string, end: 'complete' | 'discard' | 'leave' = 'complete', minutes = 30) => {
  const t = unwrap(await env.repos.templates.create({ name, exercises: [{ exerciseId, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
  const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
  unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 60, isCompleted: true }));
  env.clock.advance(minutes * 60_000);
  if (end === 'complete') unwrap(await env.repos.sessions.complete(s.id, {}));
  if (end === 'discard') unwrap(await env.repos.sessions.discard(s.id));
  env.clock.advance(24 * 3_600_000);
  return s;
};

beforeEach(async () => {
  mockSettings = { experience: 'intermediate', cautionAreas: [] };
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  exerciseId = unwrap(await env.repos.exercises.list()).find((e) => e.slug === 'bench_press')!.id;
  mockParams = {};
  mockLocale = 'en';
  mockPush.mockReset();
  mockTitles.length = 0;
  announced = [];
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => { announced.push(m); });
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('HistoryScreen', () => {
  it('says there is nothing yet when no workout has been finished, and announces loading then loaded', async () => {
    await mount(HistoryScreen);
    expect(has(hs.empty)).toBe(true);
    expect(has(hs.emptyHint)).toBe(true);
    expect(announced).toEqual([hs.loading, hs.loaded]);
  });

  it('lists real finished workouts newest first with date and length, and nothing else', async () => {
    await workout('First', 'complete', 45);
    await workout('Dropped', 'discard');
    await workout('Second', 'complete', 20);
    await workout('Running', 'leave'); // still in progress
    await mount(HistoryScreen);
    const labels = rows().map((n: any) => n.props.accessibilityLabel);
    expect(labels).toEqual(['Second, 2026-10-23, 20 min', 'First, 2026-10-21, 45 min']);
    expect(has('Workouts shown: 2')).toBe(true);
    expect(has('Dropped')).toBe(false);
    expect(has('Running')).toBe(false);
  });

  it('a discarded or running workout alone leaves the history empty', async () => {
    await workout('Dropped', 'discard');
    await workout('Running', 'leave');
    await mount(HistoryScreen);
    expect(has(hs.empty)).toBe(true);
    expect(rows()).toHaveLength(0);
  });

  it('opens the saved workout, which shows its saved sets read-only under its own name', async () => {
    const s = await workout('First');
    await mount(HistoryScreen);
    await press(rows());
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: String(s.id) } });
    act(() => tree.unmount());
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    expect(mockTitles).toContain('First'); // not "Workout in progress"
    expect(has('Set 1: 60 kg × 8')).toBe(true);
    expect(has(en.liveSession.summaryTitle)).toBe(true);
    expect(pressables((n) => textOf(n) === en.liveSession.finish)).toHaveLength(0);
  });

  it('shows the first page, then appends the next on request without repeating a workout', async () => {
    for (let i = 1; i <= 25; i++) await workout(`W${i}`);
    await mount(HistoryScreen);
    expect(rows()).toHaveLength(20);
    expect(has('W25')).toBe(true);
    expect(has('W5,')).toBe(false);
    await press(pressables((n) => textOf(n) === hs.loadMore));
    expect(rows()).toHaveLength(25);
    expect(new Set(rows().map((n: any) => n.props.accessibilityLabel)).size).toBe(25);
    expect(pressables((n) => textOf(n) === hs.loadMore)).toHaveLength(0); // nothing further
    expect(announced).toContain('More workouts loaded. Workouts shown: 25.');
  });

  it('a failed "show more" keeps what is shown and says so', async () => {
    for (let i = 1; i <= 22; i++) await workout(`W${i}`);
    let calls = 0;
    const list = (f: never) => (++calls > 1 ? Promise.resolve({ ok: false, error: { kind: 'busy', message: 'locked' } }) : env.repos.sessions.list(f));
    await mount(HistoryScreen, { status: 'ready', repos: withSessions({ list }) });
    await press(pressables((n) => textOf(n) === hs.loadMore));
    expect(rows()).toHaveLength(20);
    expect(has(hs.moreFailed)).toBe(true);
    expect(pressables((n) => textOf(n) === hs.loadMore).length).toBe(1); // can try again
  });

  it('only ever asks for completed sessions', async () => {
    const list = jest.fn((f: never) => env.repos.sessions.list(f));
    await mount(HistoryScreen, { status: 'ready', repos: withSessions({ list }) });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
  });

  it('a failed read is a failure, never an empty history; unavailable offers a retry; loading shows progress', async () => {
    await mount(HistoryScreen, { status: 'ready', repos: withSessions({ list: async () => ({ ok: false, error: { kind: 'unknown', message: 'boom' } }) }) });
    expect(has(hs.readFailed)).toBe(true);
    expect(has(hs.empty)).toBe(false);
    expect(announced.some((a) => a.includes(hs.readFailed))).toBe(true);
    act(() => tree.unmount());
    await mount(HistoryScreen, { status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(hs.unavailable)).toBe(true);
    await press(pressables((n) => textOf(n) === hs.reload));
    expect(mockDb.retry).toHaveBeenCalled();
    act(() => tree.unmount());
    await mount(HistoryScreen, { status: 'loading' });
    expect(has(hs.loading)).toBe(true);
  });

  it('uses the Arabic strings and exercise names', async () => {
    const s = await workout('First', 'complete', 45);
    mockLocale = 'ar';
    await mount(HistoryScreen);
    expect(has(ar.history.subtitle)).toBe(true);
    expect(has('الحصص المعروضة: 1')).toBe(true);
    expect(rows()[0].props.accessibilityLabel).toBe('First, 2026-10-21, 45 د');
    act(() => tree.unmount());
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    expect(has(ar.exercises.benchPress)).toBe(true);
  });
});
