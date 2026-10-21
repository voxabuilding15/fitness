/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real workout detail (Start), session and workout list screens against a real in-memory SQLite database
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
import SessionScreen from '../../screens/SessionScreen';
import TemplateDetailScreen from '../../screens/TemplateDetailScreen';
import TemplatesScreen from '../../screens/TemplatesScreen';

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
jest.mock('../../components/AppHeader', () => ({ AppHeader: () => null, goBack: () => mockGoBack() }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

jest.setTimeout(30_000);

let env: RepoEnv;
let tree: any;
let announced: string[];
const ls = en.liveSession;

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
const pressables = (label: string) => tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && textOf(n) === label);
const press = async (label: string) => {
  const node = pressables(label).find((n: any) => !n.props.disabled);
  if (!node) throw new Error(`no enabled pressable "${label}"`);
  await act(async () => { await node.props.onPress(); });
  await flush();
};
const rowNames = () => allText().filter((x: string) => /^\d+\. /.test(x));
const sessionCount = async () => (await env.db.first<{ n: number }>('SELECT COUNT(*) n FROM workout_sessions'))!.n;

const makeTemplate = async (name = 'Push day', slugs = ['bench_press', 'overhead_press', 'plank']) => {
  const all = unwrap(await env.repos.exercises.list({ includeArchived: true }));
  const id = (slug: string) => all.find((e) => e.slug === slug)!.id;
  return unwrap(await env.repos.templates.create({
    name, exercises: slugs.map((s) => (s === 'plank' ? { exerciseId: id(s), targetSets: 2, targetDurationSec: 45, restSec: 30 } : { exerciseId: id(s), targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSec: 60 })),
  }));
};
const withSessions = (sessions: Record<string, unknown>) => ({ ...env.repos, sessions: { ...env.repos.sessions, ...sessions } });

beforeEach(async () => {
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  mockParams = {};
  mockLocale = 'en';
  mockPush.mockReset();
  mockReplace.mockClear();
  mockGoBack.mockClear();
  announced = [];
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => { announced.push(m); });
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('starting a workout from the workout detail screen', () => {
  it('creates a real session from the template and opens it', async () => {
    const t = await makeTemplate();
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    await press(ls.start);
    const active = unwrap(await env.repos.sessions.getActive())!;
    expect(active).toMatchObject({ templateId: t.id, name: 'Push day', status: 'in_progress' });
    expect(active.exercises.map((e) => e.exerciseId)).toEqual(t.exercises.map((e) => e.exerciseId));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: String(active.id) } });
    expect(announced).toContain(ls.started);
    expect(unwrap(await env.repos.templates.get(t.id))).toEqual(t); // the template is untouched
  });

  it('two quick taps start exactly one session and navigate once', async () => {
    const t = await makeTemplate();
    mockParams = { id: String(t.id) };
    const start = jest.fn((i: never) => env.repos.sessions.start(i));
    await mount(TemplateDetailScreen, { status: 'ready', repos: withSessions({ start }) });
    const button = pressables(ls.start)[0];
    await act(async () => {
      const first = button.props.onPress();
      const second = button.props.onPress();
      await Promise.all([first, second]);
    });
    await flush();
    expect(start).toHaveBeenCalledTimes(1); // the second tap never reached the database
    expect(has(ls.alreadyActive)).toBe(false);
    expect(await sessionCount()).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    // after it started, the same screen offers Resume instead of a second Start
    expect(pressables(ls.start)).toHaveLength(0);
    expect(pressables(`Resume: Push day`).length).toBeGreaterThan(0);
  });

  it('a failed write says so, starts nothing, does not navigate, and can be retried', async () => {
    const t = await makeTemplate();
    mockParams = { id: String(t.id) };
    let fail = true;
    const repos = withSessions({ start: (i: unknown) => (fail ? Promise.resolve({ ok: false, error: { kind: 'busy', message: 'locked' } }) : env.repos.sessions.start(i as never)) });
    await mount(TemplateDetailScreen, { status: 'ready', repos });
    await press(ls.start);
    expect(has(ls.startFailed)).toBe(true);
    expect(has(ls.started)).toBe(false);
    expect(await sessionCount()).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
    expect(announced).not.toContain(ls.started);
    fail = false;
    await press(ls.start); // the button is usable again
    expect(await sessionCount()).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('a workout already in progress is offered for resuming instead of starting another', async () => {
    const running = await makeTemplate('Legs', ['back_squat']);
    const other = await makeTemplate('Push day');
    const s = unwrap(await env.repos.sessions.start({ templateId: running.id }));
    mockParams = { id: String(other.id) };
    await mount(TemplateDetailScreen);
    expect(pressables(ls.start)).toHaveLength(0);
    await press('Resume: Legs');
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: String(s.id) } });
    expect(await sessionCount()).toBe(1);
  });

  it('if another workout began after the screen loaded, the conflict is reported and Resume appears', async () => {
    const other = await makeTemplate('Push day');
    const running = await makeTemplate('Legs', ['back_squat']);
    mockParams = { id: String(other.id) };
    await mount(TemplateDetailScreen);
    unwrap(await env.repos.sessions.start({ templateId: running.id })); // after the screen's read
    await press(ls.start);
    expect(has(ls.alreadyActive)).toBe(true);
    expect(await sessionCount()).toBe(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(pressables('Resume: Legs').length).toBeGreaterThan(0);
  });

  it('a workout deleted after the screen loaded cannot be started and writes nothing', async () => {
    const t = await makeTemplate();
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    unwrap(await env.repos.templates.delete(t.id));
    await press(ls.start);
    expect(has(ls.templateGone)).toBe(true);
    expect(await sessionCount()).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a workout with no exercises cannot be started', async () => {
    const t = await makeTemplate();
    await env.db.run('DELETE FROM template_exercises WHERE template_id=?', [t.id]);
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(has(ls.startEmpty)).toBe(true);
    expect(pressables(ls.start)[0].props.disabled).toBe(true);
    expect(await sessionCount()).toBe(0);
  });

  it('if opening the session fails after it was created, it says so honestly and offers Resume', async () => {
    const t = await makeTemplate();
    mockParams = { id: String(t.id) };
    mockPush.mockImplementation(() => { throw new Error('navigation failed'); });
    await mount(TemplateDetailScreen);
    await press(ls.start);
    expect(await sessionCount()).toBe(1); // it really was saved
    expect(has(ls.openFailed)).toBe(true);
    expect(pressables('Resume: Push day').length).toBeGreaterThan(0);
    expect(pressables(ls.start)).toHaveLength(0);
  });

  it('shows the loading text while the database is not ready, and the unavailable text when it cannot open', async () => {
    const t = await makeTemplate();
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen, { status: 'loading' });
    expect(has(en.templates.loading)).toBe(true);
    expect(pressables(ls.start)).toHaveLength(0);
    act(() => tree.unmount());
    await mount(TemplateDetailScreen, { status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(en.templates.unavailable)).toBe(true);
    expect(pressables(ls.start)).toHaveLength(0);
  });
});

describe('SessionScreen', () => {
  it('shows the session read from the database, with its exercises in order and the planned targets', async () => {
    const t = await makeTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    expect(has('Push day')).toBe(true);
    expect(has(ls.statusInProgress)).toBe(true);
    expect(rowNames()).toEqual(['1. Barbell bench press', '2. Barbell overhead press', '3. Plank']);
    expect(has('Planned: 3 × 8–12 · rest 60 s')).toBe(true);
    expect(has('Planned: 2 × 45 s · rest 30 s')).toBe(true);
  });

  it('shows exercise names in Arabic', async () => {
    const t = await makeTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    mockLocale = 'ar';
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    expect(rowNames()).toEqual([`1. ${ar.exercises.benchPress}`, `2. ${ar.exercises.overheadPress}`, `3. ${ar.exercises.plank}`]);
  });

  it('keeps showing the targets the session started with after the workout is renamed, edited or deleted', async () => {
    const t = await makeTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    unwrap(await env.repos.templates.update(t.id, { name: 'Renamed', exercises: [{ exerciseId: t.exercises[2].exerciseId, targetSets: 9, targetDurationSec: 10, restSec: 5 }] }));
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    const expected = ['1. Barbell bench press', '2. Barbell overhead press', '3. Plank'];
    expect(rowNames()).toEqual(expected);
    expect(has('Push day')).toBe(true);
    expect(has('Planned: 3 × 8–12 · rest 60 s')).toBe(true);
    expect(has('Planned: 2 × 45 s · rest 30 s')).toBe(true);
    expect(has('Planned: 9')).toBe(false);
    act(() => tree.unmount());
    unwrap(await env.repos.templates.delete(t.id));
    await mount(SessionScreen);
    expect(rowNames()).toEqual(expected);
    expect(has('Planned: 3 × 8–12 · rest 60 s')).toBe(true);
  });

  it('never reads the workout template at all', async () => {
    const t = await makeTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    const get = jest.fn(env.repos.templates.get);
    mockParams = { id: String(s.id) };
    await mount(SessionScreen, { status: 'ready', repos: { ...env.repos, templates: { ...env.repos.templates, get } } });
    expect(get).not.toHaveBeenCalled();
    expect(has('Planned:')).toBe(true);
  });

  it('shows stored targets in Arabic', async () => {
    const t = await makeTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    mockLocale = 'ar';
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    expect(has('المخطط: 3 × 8–12 · راحة 60 ث')).toBe(true);
    expect(has('المخطط: 2 × 45 ث · راحة 30 ث')).toBe(true);
  });

  it('a session from before targets were recorded says so instead of showing the template\'s current ones', async () => {
    const t = await makeTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    // make it look like a pre-snapshot session: the triggers protect recorded plans, so rebuild the rows the way an upgraded database has them
    await env.db.exec('DROP TRIGGER session_exercises_plan_immutable');
    await env.db.run('UPDATE session_exercises SET plan_captured=0, plan_sets=NULL, plan_rest_sec=NULL, plan_reps_min=NULL, plan_reps_max=NULL, plan_duration_sec=NULL WHERE session_id=?', [s.id]);
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    expect(rowNames()).toHaveLength(3);
    expect(has('Planned:')).toBe(false);
    expect(has(ls.noPlan)).toBe(true);
  });

  it('shows a custom exercise under the name it had when the session used it', async () => {
    const mine = unwrap(await env.repos.exercises.create({ name: 'Cable woodchop', category: 'strength', primaryMuscle: 'core', equipment: 'cable', trackingType: 'reps_only' }));
    const t = unwrap(await env.repos.templates.create({ name: 'Core', exercises: [{ exerciseId: mine.id, targetSets: 3, targetRepsMin: 10, restSec: 45 }] }));
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    unwrap(await env.repos.exercises.update(mine.id, { name: 'Renamed later' }));
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    expect(rowNames()).toEqual(['1. Cable woodchop']);
  });

  it('reports an unknown or malformed session id', async () => {
    mockParams = { id: '999999' };
    await mount(SessionScreen);
    expect(has(ls.notFound)).toBe(true);
    act(() => tree.unmount());
    mockParams = { id: 'abc' };
    await mount(SessionScreen);
    expect(has(ls.notFound)).toBe(true);
  });

  it('reports a failed read and an unavailable database, never an empty session', async () => {
    const t = await makeTemplate();
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    mockParams = { id: String(s.id) };
    await mount(SessionScreen, { status: 'ready', repos: withSessions({ get: async () => ({ ok: false, error: { kind: 'unknown', message: 'boom' } }) }) });
    expect(has(ls.readFailed)).toBe(true);
    expect(rowNames()).toHaveLength(0);
    expect(announced).toContain(ls.readFailed);
    act(() => tree.unmount());
    await mount(SessionScreen, { status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(has(ls.unavailable)).toBe(true);
    await press(ls.reload);
    expect(mockDb.retry).toHaveBeenCalled();
  });

  it('shows the loading text while the database is loading', async () => {
    mockParams = { id: '1' };
    await mount(SessionScreen, { status: 'loading' });
    expect(has(ls.loading)).toBe(true);
  });
});

describe('workout list banner', () => {
  it('shows a way back into the workout in progress, and nothing when there is none', async () => {
    await makeTemplate();
    await mount(TemplatesScreen);
    expect(allText().some((x: string) => x.startsWith('Workout in progress'))).toBe(false);
    act(() => tree.unmount());
    const t = unwrap(await env.repos.templates.list())[0];
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    await mount(TemplatesScreen);
    expect(has('Workout in progress: Push day')).toBe(true);
    const banner = tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Workout in progress: Push day' && typeof n.props.onPress === 'function')[0];
    await act(async () => { await banner.props.onPress(); });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/session/[id]', params: { id: String(s.id) } });
  });
});
