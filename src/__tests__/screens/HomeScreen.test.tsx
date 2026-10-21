/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dependency) */
/**
 * Home: the greeting and the data it shows (this week's totals, the workout card, search). Rendered with the real
 * ProfileProvider and real repositories on Node SQLite; layout is not tested.
 */
import React from 'react';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { T0, createRepoEnv, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';
import HomeScreen from '../../screens/HomeScreen';
import { ProfileProvider } from '../../context/ProfileContext';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

let mockDb: { state: unknown; retry: jest.Mock };
let mockLocale: 'en' | 'ar' = 'en';
const mockPush = jest.fn();
const mockNavigate = jest.fn();
jest.mock('react-i18next', () => {
  const messages = { en: require('../../locales/en.json'), ar: require('../../locales/ar.json') };
  const make = (locale: 'en' | 'ar') => {
    const t = (key: string, options?: Record<string, string>) => {
      const text: string = key.split('.').reduce((o: any, p) => (o == null ? undefined : o[p]), messages[locale]) ?? key;
      return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
    };
    return { t, i18n: { language: locale } };
  };
  const values = { en: make('en'), ar: make('ar') };
  return { useTranslation: () => values[mockLocale] };
});
jest.mock('../../domain/dates', () => ({ ...jest.requireActual('../../domain/dates'), deviceLocalDate: () => '2026-10-21' })); // a Wednesday
jest.mock('../../context/AppContext', () => ({
  useApp: () => ({
    isRTL: false,
    // the built-in demonstration profile
    profile: { name: 'Jacob Donald', location: 'London, United Kingdom', age: 27, heightCm: 170, weightKg: 52 },
    settings: { cautionAreas: [], experience: 'beginner', language: 'en', soundEnabled: true, reminders: { enabled: false } },
  }),
}));
jest.mock('../../context/DatabaseContext', () => ({ useDatabase: () => mockDb }));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), navigate: (...a: unknown[]) => mockNavigate(...a) },
    useFocusEffect: (cb: () => void) => React.useEffect(cb, [cb]),
  };
});
jest.mock('../../services/soundService', () => ({ playSound: jest.fn() }));
jest.mock('../../components/Screen', () => ({ Screen: (props: { children: unknown }) => props.children }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));
jest.mock('../../components/AppLogo', () => ({ AppLogo: () => null }));
jest.mock('../../components/WorkoutArt', () => ({ WorkoutArt: () => null }));
jest.mock('../../components/WeeklyActivityChart', () => ({ WeeklyActivityChart: () => null }));
jest.mock('../../components/HeartRateWave', () => ({ HeartRateWave: () => null }));

jest.setTimeout(30_000);

let env: RepoEnv;
let tree: any;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const textOf = (node: any): string => (node.children as any[]).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const greeting = () => tree.root.findAll((n: any) => n.type === 'Text').map(textOf).join('|');
const show = async (state: unknown) => {
  mockDb = { state, retry: jest.fn() };
  await act(async () => { tree = TestRenderer.create(<ProfileProvider><HomeScreen /></ProfileProvider>); });
  await flush();
  return greeting();
};

beforeEach(async () => { env = await createRepoEnv(); mockLocale = 'en'; mockPush.mockClear(); mockNavigate.mockClear(); });
afterEach(() => act(() => tree?.unmount()));

describe('Home greeting never shows the built-in demo name', () => {
  it('the stored name is used', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam Ben' }));
    const g = await show({ status: 'ready', repos: env.repos, legacyError: null });
    expect(g).toContain('Sam');
    expect(g).not.toContain('Jacob');
  });
  it('no profile yet: a neutral greeting', async () => {
    const g = await show({ status: 'ready', repos: env.repos, legacyError: null });
    expect(g).toContain(en.home.welcomeNoName);
    expect(g).not.toContain('Jacob');
  });
  it('database unavailable (web, missing native module): a neutral greeting, not the demo name', async () => {
    const g = await show({ status: 'unavailable', error: { kind: 'unavailable', reason: 'web_unsupported' } });
    expect(g).toContain(en.home.welcomeNoName);
    expect(g).not.toContain('Jacob');
    expect(g).not.toContain('Donald');
  });
  it('still loading: a neutral greeting (no flash of a made-up name)', async () => {
    const g = await show({ status: 'loading' });
    expect(g).toContain(en.home.welcomeNoName);
    expect(g).not.toContain('Jacob');
  });
});

describe('Home data comes from saved workouts, never from sample values', () => {
  const DAY = 86_400_000;
  let bench = 0;
  const seed = async () => {
    unwrap(await runSeed(env.db, SEED_PACK, env.clock));
    bench = unwrap(await env.repos.exercises.list()).find((e) => e.slug === 'bench_press')!.id;
  };
  const workout = async (name: string, daysFromT0: number, sets: [number, number][], minutes = 30, end: 'complete' | 'leave' = 'complete') => {
    env.clock.set(T0 + daysFromT0 * DAY);
    const s = unwrap(await env.repos.sessions.start({ name, exerciseIds: [bench] }));
    for (const [w, r] of sets) unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { weightKg: w, reps: r, isCompleted: true }));
    env.clock.advance(minutes * 60_000);
    if (end === 'complete') unwrap(await env.repos.sessions.complete(s.id, {}));
    return s;
  };
  const ready = { get: () => ({ status: 'ready', repos: env.repos, legacyError: null }) };
  const pressables = (match: (n: any) => boolean) => tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && match(n));
  const press = async (nodes: any[]) => { await act(async () => { await nodes[0].props.onPress(); }); await flush(); };
  const cards = () => tree.root.findAll((n: any) => typeof n.props.accessibilityLabel === 'string' && /: .*\d/.test(n.props.accessibilityLabel) && n.props.accessible && typeof n.type === 'string').map((n: any) => n.props.accessibilityLabel as string);

  it('with nothing saved: zeros, no sample numbers, and an invitation to create a workout', async () => {
    await seed();
    const g = await show(ready.get());
    expect(cards()).toEqual(['Workouts this week: 0 ', 'Time today: 0 min', 'Lifted today: 0 kg']);
    expect(g).toContain(en.home.noWorkoutsTitle);
    for (const demo of ['5,400', '312', 'Cal burnt', 'Steps today', 'Demo data', 'Upper body', 'Jacob']) expect(g).not.toContain(demo);
    await press(pressables((n) => n.props.accessibilityRole === 'button' && n.children.length && textOf(n) === en.home.createWorkout));
    expect(mockPush).toHaveBeenCalledWith('/templates/form');
  });

  it("this week's finished workouts and today's time and weight, with progress against the saved weekly goal", async () => {
    await seed();
    unwrap(await env.repos.goals.save({ goalType: 'maintain', waterMlTarget: 2000, weeklyWorkoutTarget: 3, source: 'manual' }));
    await workout('Mon', -2, [[80, 5]]);
    await workout('Today', 0, [[60, 10], [70, 5]], 25);
    await workout('Dropped', 0, [[500, 10]], 10, 'leave'); // unfinished: must not count
    unwrap(await env.repos.sessions.discard(unwrap(await env.repos.sessions.getActive())!.id));
    const g = await show(ready.get());
    expect(cards()).toEqual(['Workouts this week: 2 of 3, Average', 'Time today: 25 min', 'Lifted today: 950 kg']);
    expect(g).not.toContain('500');
  });

  it('without a saved goal the workouts tile has no target and no status', async () => {
    await seed();
    await workout('Mon', -2, [[80, 5]]);
    await show(ready.get());
    expect(cards()[0]).toBe('Workouts this week: 1 ');
  });

  it("last week's workouts are not counted this week", async () => {
    await seed();
    await workout('Old', -6, [[80, 5]]); // Thu 2026-10-15, before this week's Saturday
    await show(ready.get());
    expect(cards()[0]).toBe('Workouts this week: 0 ');
  });

  it('shows the newest saved workout and opens it', async () => {
    await seed();
    unwrap(await env.repos.templates.create({ name: 'Older', exercises: [{ exerciseId: bench, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    env.clock.advance(1000);
    const newest = unwrap(await env.repos.templates.create({ name: 'Newest', exercises: [{ exerciseId: bench, targetSets: 3, targetRepsMin: 8, restSec: 60 }, { exerciseId: bench, targetSets: 2, targetRepsMin: 5, restSec: 30 }] }));
    const g = await show(ready.get());
    expect(g).toContain('Newest');
    expect(g).toContain('Exercises: 2');
    expect(g).not.toContain('Older');
    await press(pressables((n) => n.props.accessibilityLabel === `${en.home.openWorkout}: Newest`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: String(newest.id) } });
  });

  it('a workout in progress is offered for resuming instead', async () => {
    await seed();
    unwrap(await env.repos.templates.create({ name: 'Saved', exercises: [{ exerciseId: bench, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    const running = await workout('Running now', 0, [[60, 10]], 5, 'leave');
    const g = await show(ready.get());
    expect(g).toContain('Workout in progress: Running now');
    expect(g).not.toContain('Exercises: 1');
    await press(pressables((n) => n.children.length && textOf(n) === en.liveSession.resume));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: String(running.id) } });
  });

  it('search finds real saved workouts and library exercises (by displayed name), and nothing from the old demo list', async () => {
    await seed();
    const t = unwrap(await env.repos.templates.create({ name: 'Push day', exercises: [{ exerciseId: bench, targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    await show(ready.get());
    const type = async (v: string) => { await act(async () => { tree.root.find((n: any) => n.props.accessibilityLabel === en.home.searchLabel && typeof n.props.onChangeText === 'function').props.onChangeText(v); }); };
    await type('push');
    expect(greeting()).toContain('Push day');
    await press(pressables((n) => n.props.accessibilityLabel === `Push day, ${en.home.resultWorkout}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/templates/[id]', params: { id: String(t.id) } });
    await type('bench');
    expect(greeting()).toContain('Barbell bench press');
    await press(pressables((n) => n.props.accessibilityLabel === `Barbell bench press, ${en.home.resultExercise}`));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/exercises/[id]', params: { id: String(bench) } });
    await type('Upper body');
    expect(greeting()).toContain(en.home.noResultsTitle);
  });

  it('a hidden exercise is not offered by search', async () => {
    await seed();
    unwrap(await env.repos.exercises.setArchived(bench, true));
    await show(ready.get());
    await act(async () => { tree.root.find((n: any) => n.props.accessibilityLabel === en.home.searchLabel && typeof n.props.onChangeText === 'function').props.onChangeText('bench'); });
    expect(greeting()).toContain(en.home.noResultsTitle);
  });

  it('a failed read is a failure with a retry, not a screen of zeros; unavailable says so; loading shows progress', async () => {
    await seed();
    const repos = { ...env.repos, sessions: { ...env.repos.sessions, dailyActivity: async () => ({ ok: false, error: { kind: 'unknown', message: 'boom' } }) } };
    const g = await show({ status: 'ready', repos, legacyError: null });
    expect(g).toContain(en.home.readFailed);
    expect(cards()).toEqual([]);
    expect(g).toContain(en.home.welcomeNoName); // the greeting is unaffected
    act(() => tree.unmount());
    expect(await show({ status: 'unavailable', error: { kind: 'unavailable', reason: 'web_unsupported' } })).toContain(en.home.unavailable);
    await press(pressables((n) => n.children.length && textOf(n) === en.home.reload));
    expect(mockDb.retry).toHaveBeenCalled();
    act(() => tree.unmount());
    expect(await show({ status: 'loading' })).toContain(en.home.loading);
  });

  it('uses the Arabic strings', async () => {
    await seed();
    await workout('Mon', -2, [[80, 5]]);
    mockLocale = 'ar';
    const g = await show(ready.get());
    expect(g).toContain(ar.home.thisWeek);
    expect(cards()[0]).toContain(ar.home.weekWorkoutsLabel);
    expect(g).toContain(ar.home.noWorkoutsTitle);
  });
});
