/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real Statistics screen against a real in-memory SQLite database against a real in-memory SQLite database
 * (Node SQLite through the repositories). This tests screen logic and persistence wiring, NOT the Expo SQLite
 * native driver, NOT screen-reader output on a device and NOT the visual layout.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { T0, createRepoEnv, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';
import StatisticsScreen from '../../screens/StatisticsScreen';

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
jest.mock('../../components/AppHeader', () => ({
  AppHeader: ({ right }: any) => { const { Pressable } = require('react-native'); return right ? <Pressable accessibilityLabel={right.label} onPress={right.onPress} /> : null; },
  goBack: () => mockGoBack(),
}));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));
jest.mock('../../domain/dates', () => ({ ...jest.requireActual('../../domain/dates'), deviceLocalDate: () => '2026-10-21' })); // a Wednesday
jest.mock('../../components/SectionHeader', () => ({ SectionHeader: ({ title, action, onAction }: any) => { const { Text, Pressable } = require('react-native'); return (<><Text>{title}</Text><Pressable accessibilityRole="button" onPress={onAction}><Text>{action}</Text></Pressable></>); } }));

jest.setTimeout(30_000);

let env: RepoEnv;
let tree: any;
let announced: string[];
const st = en.stats;
const DAY = 86_400_000;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async (state: unknown = { status: 'ready', repos: env.repos }) => {
  mockDb = { state, retry: jest.fn() };
  await act(async () => { tree = TestRenderer.create(<StatisticsScreen />); });
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
const byText = (label: string) => pressables((n) => textOf(n) === label);
const bars = () => pressables((n) => n.props.accessibilityRole === 'button' && /^[A-Za-z0-9\u0600-\u06FF]+: /.test(String(n.props.accessibilityLabel ?? ''))).map((n: any) => n.props.accessibilityLabel as string);
const withSessions = (sessions: Record<string, unknown>) => ({ ...env.repos, sessions: { ...env.repos.sessions, ...sessions } });

let bench = 0;
/** one workout on `daysFromT0` (T0 is Wed 2026-10-21 10:00 UTC), with the given sets, ended as asked */
const workout = async (name: string, daysFromT0: number, sets: [number, number][], minutes = 30, end: 'complete' | 'discard' | 'leave' = 'complete') => {
  env.clock.set(T0 + daysFromT0 * DAY);
  const s = unwrap(await env.repos.sessions.start({ name, exerciseIds: [bench] }));
  for (const [w, r] of sets) unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { weightKg: w, reps: r, isCompleted: true }));
  env.clock.advance(minutes * 60_000);
  if (end === 'complete') unwrap(await env.repos.sessions.complete(s.id, {}));
  if (end === 'discard') unwrap(await env.repos.sessions.discard(s.id));
  return s;
};

beforeEach(async () => {
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  bench = unwrap(await env.repos.exercises.list()).find((e) => e.slug === 'bench_press')!.id;
  mockParams = {};
  mockLocale = 'en';
  mockPush.mockReset();
  announced = [];
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => { announced.push(m); });
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('StatisticsScreen', () => {
  it('with no workouts shows zeros honestly with an empty-period note, no sample data, and says there is no latest workout', async () => {
    await mount();
    expect(has(st.emptyPeriod)).toBe(true);
    expect(has(st.noLatest)).toBe(true);
    expect(bars()).toEqual(['Sat: 0', 'Sun: 0', 'Mon: 0', 'Tue: 0', 'Wed: 0', 'Thu: 0', 'Fri: 0']);
    expect(has('5,400') || has('bpm') || has('Steps')).toBe(false);
    expect(announced).toEqual([st.loaded]);
  });

  it('counts this week\'s finished workouts per day', async () => {
    await workout('Mon', -2, [[80, 5]]);
    await workout('Wed A', 0, [[60, 10]], 20);
    await workout('Wed B', 0, [[70, 10]], 25);
    await mount();
    expect(bars()).toEqual(['Sat: 0', 'Sun: 0', 'Mon: 1', 'Tue: 0', 'Wed: 2', 'Thu: 0', 'Fri: 0']);
    expect(has('3')).toBe(true);
    expect(has(st.total.workouts)).toBe(true);
    expect(has(st.emptyPeriod)).toBe(false);
  });

  it('switching the metric shows weight lifted (weight x reps) and training time', async () => {
    await workout('Wed', 0, [[80, 5], [82.5, 3]], 42);
    await mount();
    await press(byText(st.metric.volume));
    expect(bars()[4]).toBe('Wed: 647.5 kg');
    expect(has(st.total.volume)).toBe(true);
    await press(byText(st.metric.minutes));
    expect(bars()[4]).toBe('Wed: 42 min');
  });

  it('discarded and unfinished workouts never appear, and neither do other periods\' workouts', async () => {
    await workout('Dropped', -1, [[100, 10]], 30, 'discard');
    await workout('Last week', -8, [[100, 10]]);
    await workout('Running', 0, [[100, 10]], 30, 'leave');
    await mount();
    expect(bars().every((b: string) => b.endsWith(': 0'))).toBe(true);
    expect(has(st.emptyPeriod)).toBe(true);
    expect(has('Dropped') || has('Running')).toBe(false);
  });

  it('last week and this month use their own windows', async () => {
    await workout('Last week', -8, [[100, 10]]); // Tue 2026-10-13
    await workout('Early', -15, [[50, 10]]); // 2026-10-06
    await mount();
    await press(pressables((n) => n.props.accessibilityLabel === st.periodPicker));
    await press(byText(st.period.lastWeek));
    expect(bars()).toEqual(['Sat: 0', 'Sun: 0', 'Mon: 0', 'Tue: 1', 'Wed: 0', 'Thu: 0', 'Fri: 0']);
    await press(pressables((n) => n.props.accessibilityLabel === st.periodPicker));
    await press(byText(st.period.thisMonth));
    expect(bars()).toEqual(['W1: 1', 'W2: 1', 'W3: 0', 'W4: 0']);
  });

  it('shows the latest finished workout from the database and opens it', async () => {
    await workout('Older', -3, [[50, 10]]);
    const latest = await workout('Newest', 0, [[80, 5], [82.5, 3]], 42);
    await mount();
    expect(has('Newest')).toBe(true);
    expect(has('647.5 kg')).toBe(true);
    expect(has('42 min')).toBe(true);
    expect(has('Older')).toBe(false);
    await press(byText(st.openWorkout));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: String(latest.id) } });
    await press(byText(en.common.seeAll));
    expect(mockPush).toHaveBeenCalledWith('/history');
  });

  it('reset returns to workouts and this week', async () => {
    await mount();
    await press(byText(st.metric.volume));
    await press(pressables((n) => n.props.accessibilityLabel === en.common.more));
    await press(byText(st.menuReset));
    expect(has(st.total.workouts)).toBe(true);
  });

  it('a failed read is reported as a failure, not as zeros; unavailable offers a retry; loading shows progress', async () => {
    await mount({ status: 'ready', repos: withSessions({ dailyActivity: async () => ({ ok: false, error: { kind: 'unknown', message: 'boom' } }) }) });
    expect(has(st.readFailed)).toBe(true);
    expect(bars()).toEqual([]);
    expect(announced.some((a) => a.includes(st.readFailed))).toBe(true);
    act(() => tree.unmount());
    await mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(st.unavailable)).toBe(true);
    await press(byText(st.reload));
    expect(mockDb.retry).toHaveBeenCalled();
    act(() => tree.unmount());
    await mount({ status: 'loading' });
    expect(has(st.loading)).toBe(true);
    expect(bars()).toEqual([]);
  });

  it('uses the Arabic strings', async () => {
    await workout('Wed', 0, [[80, 5]], 42);
    mockLocale = 'ar';
    await mount();
    expect(has(ar.stats.total.workouts)).toBe(true);
    expect(bars()).toHaveLength(7);
    await press(byText(ar.stats.metric.volume));
    expect(has(ar.stats.total.volume)).toBe(true);
    expect(has(ar.stats.openWorkout)).toBe(true);
  });
});
