/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real session screen (logging, rest timer, finish, discard) against a real in-memory SQLite database
 * (Node SQLite through the repositories). This tests screen logic and persistence wiring, NOT the Expo SQLite
 * native driver, NOT screen-reader output on a device and NOT the visual layout.
 */
import React from 'react';
import { AccessibilityInfo, BackHandler } from 'react-native';
import { SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { createRepoEnv, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';
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
let mockHeaderBack: (() => void) | undefined;
jest.mock('../../components/AppHeader', () => ({ AppHeader: ({ onBack }: { onBack?: () => void }) => { mockHeaderBack = onBack; return null; }, goBack: () => mockGoBack() }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

jest.setTimeout(30_000);

let env: RepoEnv;
let tree: any;
let announced: string[];
let mockNow = 1_000_000;
const ls = en.liveSession;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async (state: unknown = { status: 'ready', repos: env.repos }) => {
  mockDb = { state, retry: jest.fn() };
  await act(async () => { tree = TestRenderer.create(<SessionScreen />); });
  await flush();
};
const textOf = (node: any): string => (node.children as any[]).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const allText = () => tree.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map(textOf);
const has = (s: string) => allText().some((x: string) => x.includes(s));
const input = (label: string) => tree.root.find((n: any) => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
const type = async (label: string, v: string) => { await act(async () => { input(label).props.onChangeText(v); }); };
const pressables = (match: (n: any) => boolean) => tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && match(n));
const byLabel = (label: string) => pressables((n) => n.props.accessibilityLabel === label);
const byText = (label: string) => pressables((n) => textOf(n) === label);
const press = async (nodes: any[]) => {
  const node = nodes.find((n: any) => !n.props.disabled);
  if (!node) throw new Error('no enabled pressable');
  await act(async () => { await node.props.onPress(); });
  await flush();
};
const rowNames = (): string[] => allText().filter((x: string) => /^\d+\. /.test(x));
const BENCH = 'Barbell bench press';
/** makes exercise number `position` the one shown in full (the chips above the exercise) */
const focusExercise = async (position: number) => press([pressables((n) => n.props.accessibilityRole === 'tab')[position - 1]]);
const logLabel = (name: string, n: number) => `${ls.logSet}: ${name}, Set ${n}`;
const dbSets = async () => (await env.db.all('SELECT * FROM session_sets ORDER BY session_exercise_id, set_number')) as any[];

const makeSession = async (slugs = ['bench_press', 'plank', 'running']) => {
  const all = unwrap(await env.repos.exercises.list({ includeArchived: true }));
  const id = (slug: string) => all.find((e) => e.slug === slug)!.id;
  const t = unwrap(await env.repos.templates.create({
    name: 'Push day', exercises: slugs.map((s) => (s === 'bench_press'
      ? { exerciseId: id(s), targetSets: 3, targetRepsMin: 8, targetRepsMax: 12, restSec: 60 }
      : s === 'plank' ? { exerciseId: id(s), targetSets: 2, targetDurationSec: 45, restSec: 30 }
        : { exerciseId: id(s), targetSets: 1, targetDurationSec: 1200, restSec: 0 })),
  }));
  const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
  mockParams = { id: String(s.id) };
  return s;
};
const logBench = async (weight = '80', reps = '8') => {
  await type(`${ls.weightKg}, ${BENCH}`, weight);
  await type(`${ls.reps}, ${BENCH}`, reps);
  await press(byLabel(logLabel(BENCH, (await dbSets()).length + 1)));
};
const withSessions = (sessions: Record<string, unknown>) => ({ ...env.repos, sessions: { ...env.repos.sessions, ...sessions } });

beforeEach(async () => {
  mockSettings = { experience: 'intermediate', cautionAreas: [] };
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  mockParams = {};
  mockLocale = 'en';
  mockNow = 1_000_000;
  mockHeaderBack = undefined;
  mockPush.mockReset();
  mockGoBack.mockClear();
  announced = [];
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => { announced.push(m); });
  jest.spyOn(Date, 'now').mockImplementation(() => mockNow);
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('logging sets', () => {
  it('saves a weight-and-reps set at once, shows it from the database, and announces it', async () => {
    const s = await makeSession();
    await mount();
    await logBench('82,5', '8');
    const rows = await dbSets();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ session_exercise_id: s.exercises[0].id, set_number: 1, weight_kg: 82.5, reps: 8, is_completed: 1, is_warmup: 0 });
    expect(rows[0].completed_at).toBeGreaterThan(0);
    expect(has('Set 1: 82.5 kg × 8')).toBe(true);
    expect(announced).toContain('Set 1 logged: 82.5 kg × 8.');
    // the next set starts from the last one, and logging it numbers it 2
    expect(input(`${ls.weightKg}, ${BENCH}`).props.value).toBe('82.5');
    await type(`${ls.reps}, ${BENCH}`, '6');
    await press(byLabel(logLabel(BENCH, 2)));
    expect((await dbSets()).map((r) => [r.set_number, r.reps])).toEqual([[1, 8], [2, 6]]);
  });

  it('what was saved is still there after leaving and coming back', async () => {
    await makeSession();
    await mount();
    await logBench();
    act(() => tree.unmount());
    await mount();
    expect(has('Set 1: 80 kg × 8')).toBe(true);
    expect(has('Sets 0 of 2')).toBe(true); // the other exercises are listed with their progress
  });

  it('rejects empty, negative, non-finite and impossible values and writes nothing', async () => {
    await makeSession();
    await mount();
    await press(byLabel(logLabel(BENCH, 1)));
    expect(has(en.validation.required)).toBe(true);
    expect(announced.some((a) => a.includes(BENCH) && a.includes(ls.weightKg))).toBe(true);
    for (const [w, r] of [['-5', '8'], ['NaN', '8'], ['Infinity', '8'], ['80', '0'], ['80', '1001'], ['80', '2.5'], ['1001', '8']]) {
      await type(`${ls.weightKg}, ${BENCH}`, w);
      await type(`${ls.reps}, ${BENCH}`, r);
      await press(byLabel(logLabel(BENCH, 1)));
    }
    expect(await dbSets()).toEqual([]);
  });

  it('a timed exercise takes seconds, and a distance exercise takes kilometres and minutes', async () => {
    await makeSession();
    await mount();
    await focusExercise(2);
    await type(`${ls.durationSec}, Plank`, '45');
    await press(byLabel(logLabel('Plank', 1)));
    expect(has('Set 1: 45 s')).toBe(true);
    await focusExercise(3);
    await type(`${ls.distanceKm}, Running`, '5');
    await type(`${ls.durationMin}, Running`, '20');
    await press(byLabel(logLabel('Running', 1)));
    const rows = await dbSets();
    expect(rows[0]).toMatchObject({ duration_sec: 45, reps: null, weight_kg: null });
    expect(rows[1]).toMatchObject({ distance_m: 5000, duration_sec: 1200 });
    expect(has('Set 1: 5 km in 20 min')).toBe(true);
    await focusExercise(2);
    expect(has('Set 1: 45 s')).toBe(true); // moving between exercises keeps what was logged
  });

  it('two taps in one moment save one set', async () => {
    await makeSession();
    const addSet = jest.fn((a: never, b: never) => env.repos.sessions.addSet(a, b));
    await mount({ status: 'ready', repos: withSessions({ addSet }) });
    await type(`${ls.weightKg}, ${BENCH}`, '80');
    await type(`${ls.reps}, ${BENCH}`, '8');
    const button = byLabel(logLabel(BENCH, 1))[0];
    await act(async () => { await Promise.all([button.props.onPress(), button.props.onPress()]); });
    await flush();
    expect(addSet).toHaveBeenCalledTimes(1);
    expect(await dbSets()).toHaveLength(1);
  });

  it('a failed save says so, keeps the typed values, saves nothing, and can be retried', async () => {
    await makeSession();
    let fail = true;
    const addSet = (a: never, b: never) => (fail ? Promise.resolve({ ok: false, error: { kind: 'busy', message: 'locked' } }) : env.repos.sessions.addSet(a, b));
    await mount({ status: 'ready', repos: withSessions({ addSet }) });
    await logBench();
    expect(has(ls.logFailed)).toBe(true);
    expect(await dbSets()).toEqual([]);
    expect(input(`${ls.reps}, ${BENCH}`).props.value).toBe('8');
    fail = false;
    await press(byLabel(logLabel(BENCH, 1)));
    expect(await dbSets()).toHaveLength(1);
  });

  it('removes a set only after confirmation, and renumbers the rest', async () => {
    await makeSession();
    await mount();
    await logBench('80', '8');
    await logBench('80', '7');
    await press(byLabel(`${ls.removeSet}: ${BENCH}, Set 1`));
    expect(await dbSets()).toHaveLength(2); // asked, not yet removed
    await press(byText(ls.keepGoing));
    expect(await dbSets()).toHaveLength(2);
    await press(byLabel(`${ls.removeSet}: ${BENCH}, Set 1`));
    await press(byText(ls.removeSetYes));
    expect((await dbSets()).map((r) => [r.set_number, r.reps])).toEqual([[1, 7]]);
    expect(announced).toContain(ls.setRemoved);
  });

  it('says the saved change could not be refreshed, if reading it back fails after a successful save', async () => {
    await makeSession();
    let reads = 0;
    const get = (id: never) => (++reads > 1 ? Promise.resolve({ ok: false, error: { kind: 'unknown', message: 'boom' } }) : env.repos.sessions.get(id));
    await mount({ status: 'ready', repos: withSessions({ get }) });
    await logBench();
    expect(await dbSets()).toHaveLength(1);
    expect(has(ls.refreshFailed)).toBe(true);
  });

  it('a session from before targets were recorded can still be logged, and has no rest button', async () => {
    const s = await makeSession();
    await env.db.exec('DROP TRIGGER session_exercises_plan_immutable');
    await env.db.run('UPDATE session_exercises SET plan_captured=0, plan_sets=NULL, plan_rest_sec=NULL, plan_reps_min=NULL, plan_reps_max=NULL, plan_duration_sec=NULL WHERE session_id=?', [s.id]);
    await mount();
    expect(has(ls.noPlan)).toBe(true);
    expect(byText('Start rest (60 s)')).toHaveLength(0);
    await logBench();
    expect(await dbSets()).toHaveLength(1);
  });
});

describe('rest timer', () => {
  const tick = async (ms: number) => {
    mockNow += ms;
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  };

  it('starts from the exercise\'s recorded rest, counts down, is skipped, and never touches saved sets', async () => {
    await makeSession();
    await mount();
    expect(byText('Start rest (60 s)')).toHaveLength(1); // the exercise shown
    await focusExercise(2);
    expect(byText('Start rest (30 s)')).toHaveLength(1);
    await focusExercise(3);
    expect(byText('Start rest (0 s)')).toHaveLength(0); // running has a rest of 0: no button
    await focusExercise(1);
    await press(byLabel(`Start rest (60 s), ${BENCH}`));
    expect(has('1:00')).toBe(true);
    expect(announced).toContain('Rest started. Seconds: 60.');
    await tick(3000);
    expect(has('0:57')).toBe(true);
    await press(byText(ls.restSkip));
    expect(has('0:57')).toBe(false);
    expect(announced).toContain(ls.restSkipped);
    expect(await dbSets()).toEqual([]);
  });

  it('the timer group is labelled with the running state and time, then with "rest is over"', async () => {
    await makeSession();
    await mount();
    const group = () => tree.root.findAll((n: any) => n.props.role === 'group' && /^Rest/.test(String(n.props.accessibilityLabel ?? '')))[0];
    await press(byLabel(`Start rest (60 s), ${BENCH}`));
    expect(group().props.accessibilityLabel).toBe('Rest: 1:00');
    await tick(3000);
    expect(group().props.accessibilityLabel).toBe('Rest: 0:57');
    await tick(60_000);
    expect(group().props.accessibilityLabel).toBe(ls.restOver);
    expect(announced.filter((a) => a === ls.restDone)).toHaveLength(1); // still one end-of-rest announcement
  });

  it('ends by itself, says so once, and can be stopped', async () => {
    await makeSession();
    await mount();
    await focusExercise(2);
    await press(byLabel('Start rest (30 s), Plank'));
    await tick(31_000);
    expect(has(ls.restOver)).toBe(true);
    expect(announced.filter((a) => a === ls.restDone)).toHaveLength(1);
    expect(byText(ls.restSkip)).toHaveLength(0);
    await press(byText(ls.restStop));
    expect(has(ls.restOver)).toBe(false);
    expect(announced).toContain(ls.restStopped);
  });
});

describe('finishing', () => {
  it('cannot finish with nothing logged', async () => {
    await makeSession();
    await mount();
    expect(byText(ls.finish)[0].props.disabled).toBe(true);
    expect(has(ls.finishNeedsSet)).toBe(true);
  });

  it('asks first; keep going changes nothing', async () => {
    const s = await makeSession();
    await mount();
    await logBench();
    await press(byText(ls.finish));
    expect(has('Finish this workout? Sets logged: 1. It will be saved as completed.')).toBe(true);
    await press(byText(ls.keepGoing));
    expect(unwrap(await env.repos.sessions.get(s.id)).status).toBe('in_progress');
  });

  it('finishing saves the status and end time and shows a summary counted from the saved sets', async () => {
    const s = await makeSession();
    await mount();
    await logBench('80', '8');
    await logBench('82,5', '6');
    await focusExercise(2);
    await type(`${ls.durationSec}, Plank`, '45');
    await press(byLabel(logLabel('Plank', 1)));
    mockNow += 60_000;
    await press(byText(ls.finish));
    await press(byText(ls.finishYes));
    const saved = unwrap(await env.repos.sessions.get(s.id));
    expect(saved.status).toBe('completed');
    expect(saved.endedAt).toBeGreaterThanOrEqual(saved.startedAt);
    expect(announced).toContain(ls.finished);
    expect(has(ls.summaryTitle)).toBe(true);
    expect(has('Sets logged: 3')).toBe(true);
    expect(has('Exercises done: 2 of 3')).toBe(true);
    expect(has('Total reps: 14')).toBe(true);
    expect(has('Total weight lifted: 1135 kg')).toBe(true); // 80x8 + 82.5x6
    // it is now read-only and cannot be finished again
    expect(byText(ls.finish)).toHaveLength(0);
    expect(byLabel(logLabel(BENCH, 3))).toHaveLength(0);
    expect(unwrap(await env.repos.sessions.getActive())).toBeNull();
  });

  it('logging into a workout that was discarded elsewhere is refused, reported, and the screen shows what the database holds', async () => {
    const s = await makeSession();
    await mount();
    await logBench();
    unwrap(await env.repos.sessions.discard(s.id)); // ended from somewhere else
    await type(`${ls.reps}, ${BENCH}`, '5');
    await press(byLabel(logLabel(BENCH, 2)));
    expect(has(ls.alreadyEnded)).toBe(true);
    expect(has(ls.discardedNote)).toBe(true); // reloaded
    expect(await dbSets()).toHaveLength(1);
    expect(byText(ls.finish)).toHaveLength(0);
  });

  it('logging or removing from a stale screen after the workout was finished elsewhere is refused, reported, and the screen reloads the real state', async () => {
    const s = await makeSession();
    await mount();
    await logBench();
    unwrap(await env.repos.sessions.complete(s.id, {})); // finished from somewhere else
    await type(`${ls.reps}, ${BENCH}`, '5');
    await press(byLabel(logLabel(BENCH, 2)));
    expect(has(ls.alreadyEnded)).toBe(true);
    expect(await dbSets()).toHaveLength(1); // nothing was added
    expect(has('Sets logged: 1')).toBe(true); // the reloaded summary shows only what the database holds
    expect(has(ls.summaryTitle)).toBe(true);
    expect(byLabel(logLabel(BENCH, 2))).toHaveLength(0); // and the form is gone
    expect(announced).not.toContain('Set 2 logged: 80 kg × 5.');
  });

  it('removing a set from a stale screen after finishing elsewhere is refused and the set stays', async () => {
    const s = await makeSession();
    await mount();
    await logBench();
    await press(byLabel(`${ls.removeSet}: ${BENCH}, Set 1`)); // the confirmation is showing
    unwrap(await env.repos.sessions.complete(s.id, {}));
    await press(byText(ls.removeSetYes));
    expect(has(ls.alreadyEnded)).toBe(true);
    expect(await dbSets()).toHaveLength(1);
    expect(announced).not.toContain(ls.setRemoved);
  });

  it('a failed finish changes nothing and leaves the workout open', async () => {
    const s = await makeSession();
    await mount({ status: 'ready', repos: withSessions({ complete: async () => ({ ok: false, error: { kind: 'busy', message: 'locked' } }) }) });
    await logBench();
    await press(byText(ls.finish));
    await press(byText(ls.finishYes));
    expect(has(ls.finishFailed)).toBe(true);
    expect(unwrap(await env.repos.sessions.get(s.id)).status).toBe('in_progress');
  });
});

describe('discarding', () => {
  it('asks first, explains what is kept, and then frees the app to start another workout', async () => {
    const s = await makeSession();
    await mount();
    await logBench();
    await press(byText(ls.discard));
    expect(has('Discard this workout? Sets logged: 1. They are kept in your history but won\'t count as a workout.')).toBe(true);
    await press(byText(ls.keepGoing));
    expect(unwrap(await env.repos.sessions.get(s.id)).status).toBe('in_progress');
    await press(byText(ls.discard));
    await press(byText(ls.discardYes));
    const saved = unwrap(await env.repos.sessions.get(s.id));
    expect(saved.status).toBe('discarded');
    expect(saved.discardedAt).not.toBeNull();
    expect(saved.endedAt).toBeNull();
    expect(saved.exercises[0].sets).toHaveLength(1); // history kept
    expect(unwrap(await env.repos.sessions.countCompleted({ from: '2000-01-01', to: '2100-01-01' }))).toBe(0);
    expect(unwrap(await env.repos.sessions.getActive())).toBeNull();
    expect(unwrap(await env.repos.sessions.start({ templateId: saved.templateId! })).status).toBe('in_progress'); // not blocked
    expect(announced).toContain(ls.discarded);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('with nothing logged the confirmation says so', async () => {
    await makeSession();
    await mount();
    await press(byText(ls.discard));
    expect(has(ls.discardConfirmNone)).toBe(true);
  });

  it('a failed discard keeps the workout in progress and does not leave the screen', async () => {
    const s = await makeSession();
    await mount({ status: 'ready', repos: withSessions({ discard: async () => ({ ok: false, error: { kind: 'busy', message: 'locked' } }) }) });
    await press(byText(ls.discard));
    await press(byText(ls.discardYes));
    expect(has(ls.discardFailed)).toBe(true);
    expect(unwrap(await env.repos.sessions.get(s.id)).status).toBe('in_progress');
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it('a discarded session opens read-only with a note, and a completed one cannot be changed', async () => {
    const s = await makeSession();
    unwrap(await env.repos.sessions.discard(s.id));
    await mount();
    expect(has(ls.discardedNote)).toBe(true);
    expect(byText(ls.finish)).toHaveLength(0);
    expect(byText(ls.discard)).toHaveLength(0);
    expect(tree.root.findAll((n: any) => typeof n.props.onChangeText === 'function')).toHaveLength(0);
  });
});

describe('progress and moving between exercises', () => {
  const tabs = () => pressables((n) => n.props.accessibilityRole === 'tab');
  const shownFields = (): string[] => tree.root.findAll((n: any) => typeof n.props.onChangeText === 'function').map((n: any) => n.props.accessibilityLabel as string);

  it('shows sets and exercises done so far against the plan', async () => {
    await makeSession();
    await mount();
    expect(has('Sets: 0 of 6')).toBe(true);
    expect(has('Exercises done: 0 of 3')).toBe(true);
    await logBench();
    expect(has('Sets: 1 of 6')).toBe(true);
    await logBench('80', '7');
    await logBench('80', '6');
    expect(has('Sets: 3 of 6')).toBe(true);
    expect(has('Exercises done: 1 of 3')).toBe(true);
    expect(has(ls.plannedDone)).toBe(true);
    expect(tabs()[0].props.accessibilityLabel).toContain('done');
    expect(tabs()[1].props.accessibilityLabel).toBe('Exercise 2 of 3: Plank, Sets 0 of 2');
  });

  it('only the current exercise is shown in full; the others are one line with their progress; choosing one shows it', async () => {
    await makeSession();
    await mount();
    expect(shownFields().every((f) => f.endsWith(BENCH))).toBe(true);
    expect(has('2. Plank')).toBe(true); // listed
    await focusExercise(2);
    expect(shownFields().every((f) => f.endsWith('Plank'))).toBe(true);
    expect(announced).toContain('Exercise 2 of 3: Plank');
    expect(tabs()[1].props.accessibilityState.selected).toBe(true);
  });

  it('moving away and back keeps logged sets and the numbers typed but not yet logged', async () => {
    await makeSession();
    await mount();
    await logBench('80', '8');
    await type(`${ls.reps}, ${BENCH}`, '11'); // typed, not logged
    await focusExercise(2);
    await focusExercise(1);
    expect(input(`${ls.reps}, ${BENCH}`).props.value).toBe('11');
    expect(has('Set 1: 80 kg × 8')).toBe(true);
    expect(await dbSets()).toHaveLength(1);
  });

  it('Previous and Next move one exercise at a time and are disabled at the ends', async () => {
    await makeSession();
    await mount();
    const nav = (label: string) => tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && textOf(n) === label)[0];
    expect(nav(ls.prevExercise).props.disabled).toBe(true);
    await press([nav(ls.nextExercise)]);
    await press([nav(ls.nextExercise)]);
    expect(shownFields().every((f) => f.includes('Running'))).toBe(true);
    expect(nav(ls.nextExercise).props.disabled).toBe(true);
    await press([nav(ls.prevExercise)]);
    expect(shownFields().every((f) => f.endsWith('Plank'))).toBe(true);
  });

  it('a resumed workout opens on the first unfinished exercise', async () => {
    await makeSession();
    await mount();
    for (const r of ['8', '7', '6']) await logBench('80', r);
    act(() => tree.unmount());
    await mount();
    expect(shownFields().every((f) => f.endsWith('Plank'))).toBe(true);
  });

  it('a workout without a recorded plan shows a count but no total and no bar', async () => {
    const s = await makeSession();
    await env.db.exec('DROP TRIGGER session_exercises_plan_immutable');
    await env.db.run('UPDATE session_exercises SET plan_captured=0, plan_sets=NULL, plan_rest_sec=NULL, plan_reps_min=NULL, plan_reps_max=NULL, plan_duration_sec=NULL WHERE session_id=?', [s.id]);
    await mount();
    await logBench();
    expect(has('Sets logged: 1')).toBe(true);
    expect(has('Sets: 1 of')).toBe(false);
    expect(has(ls.plannedDone)).toBe(false); // nothing to be "done" against
  });

  it('a finished workout shows every exercise in full and no navigation', async () => {
    await makeSession();
    await mount();
    await logBench();
    await press(byText(ls.finish));
    await press(byText(ls.finishYes));
    expect(tabs()).toHaveLength(0);
    expect(rowNames()).toEqual(['1. Barbell bench press', '2. Plank', '3. Running']);
    expect(has(ls.prevExercise)).toBe(false);
  });
});

describe('rest timer state and controls', () => {
  const tick = async (ms: number) => { mockNow += ms; await act(async () => { await new Promise((r) => setTimeout(r, 300)); }); };

  it('says whom the rest is for, shows the time and a progress bar, and can be extended by 15 seconds', async () => {
    await makeSession();
    await mount();
    await press(byLabel(`Start rest (60 s), ${BENCH}`));
    expect(has(`Resting: ${BENCH}`)).toBe(true);
    await tick(3000);
    expect(has('0:57')).toBe(true);
    await press(byLabel(ls.restAddLabel));
    expect(has('1:12')).toBe(true);
    expect(announced).toContain('Rest extended. Time left: 1:12.');
    expect(await dbSets()).toEqual([]); // the timer never writes anything
  });

  it('keeps running while another exercise is shown, and offers Skip and Stop only as long as they make sense', async () => {
    await makeSession();
    await mount();
    await press(byLabel(`Start rest (60 s), ${BENCH}`));
    await focusExercise(2);
    expect(has(`Resting: ${BENCH}`)).toBe(true);
    await tick(61_000);
    expect(has(ls.restOver)).toBe(true);
    expect(pressables((n) => n.props.accessibilityLabel === ls.restAddLabel)).toHaveLength(0); // an ended rest is not extended
    expect(byText(ls.restSkip)).toHaveLength(0);
    await press(byText(ls.restStop));
    expect(has(ls.restOver)).toBe(false);
  });

  it('the timer stops when the workout is finished', async () => {
    await makeSession();
    await mount();
    await logBench();
    await press(byLabel(`Start rest (60 s), ${BENCH}`));
    await press(byText(ls.finish));
    await press(byText(ls.finishYes));
    expect(has('Resting:')).toBe(false);
  });
});

describe('leaving the screen', () => {
  it('with nothing typed, going back is not intercepted', async () => {
    await makeSession();
    const add = jest.spyOn(BackHandler, 'addEventListener');
    await mount();
    expect(mockHeaderBack).toBeUndefined();
    expect(add).not.toHaveBeenCalledWith('hardwareBackPress', expect.anything());
  });

  it('with numbers typed but not logged, the back button asks first; Stay keeps them, Leave goes back; logged sets are safe either way', async () => {
    await makeSession();
    await mount();
    await logBench('80', '8');
    await type(`${ls.reps}, ${BENCH}`, '12');
    expect(mockHeaderBack).toBeDefined();
    await act(async () => { mockHeaderBack!(); });
    await flush();
    expect(has(ls.leaveTitle)).toBe(true);
    expect(has(ls.leaveBody)).toBe(true);
    expect(mockGoBack).not.toHaveBeenCalled();
    await press(byText(ls.leaveStay));
    expect(has(ls.leaveTitle)).toBe(false);
    expect(input(`${ls.reps}, ${BENCH}`).props.value).toBe('12');
    await act(async () => { mockHeaderBack!(); });
    await flush();
    await press(byText(ls.leaveYes));
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(await dbSets()).toHaveLength(1); // nothing logged was lost
    expect(unwrap(await env.repos.sessions.getActive())).not.toBeNull(); // and the workout is still in progress
  });

  it('the Android back button is intercepted the same way, only while there is something to lose', async () => {
    await makeSession();
    let handler: (() => boolean) | undefined;
    const remove = jest.fn();
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, h: () => boolean) => { handler = h; return { remove }; }) as never);
    await mount();
    expect(handler).toBeUndefined();
    await type(`${ls.reps}, ${BENCH}`, '9');
    expect(handler).toBeDefined();
    let result: boolean | undefined;
    await act(async () => { result = handler!(); });
    await flush();
    expect(result).toBe(true); // handled: the screen stays and asks
    expect(has(ls.leaveTitle)).toBe(true);
  });

  it('typing something and then clearing it back, or logging it, is no longer something to lose', async () => {
    await makeSession();
    await mount();
    await type(`${ls.reps}, ${BENCH}`, '9');
    expect(mockHeaderBack).toBeDefined();
    await type(`${ls.reps}, ${BENCH}`, '');
    expect(mockHeaderBack).toBeUndefined();
    await logBench('80', '8');
    expect(mockHeaderBack).toBeUndefined();
  });
});

describe('reopening a workout with sets already logged', () => {
  const T0 = Date.UTC(2026, 9, 21, 10, 0, 0);
  const logTwoBench = async (s: { exercises: { id: number }[] }) => {
    unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 80, isCompleted: true }));
    env.clock.advance(60_000);
    unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 80, isCompleted: true }));
  };

  it('a workout with nothing logged shows no "welcome back" note', async () => {
    await makeSession();
    mockNow = T0 + 5 * 60_000;
    await mount();
    expect(has(ls.resumedTitle)).toBe(false);
  });

  it('shows what is saved (sets, progress, place in the workout) and when the last set was logged, and says the rest timer is not kept', async () => {
    const s = await makeSession();
    await logTwoBench(s);
    unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 80, isCompleted: true })); // bench is fully done; the next exercise is where the person left off
    mockNow = env.clock.now() + 7 * 60_000;
    await mount();
    expect(has(ls.resumedTitle)).toBe(true);
    expect(has('Last set logged: 7 min ago.')).toBe(true);
    expect(has(ls.resumedTimer)).toBe(true);
    expect(has('Sets: 3 of 6')).toBe(true);
    expect(rowNames().some((n) => n.includes('Plank'))).toBe(true); // the first unfinished exercise is shown in full
    expect(has(ls.restRunning.replace('{{time}}', ''))).toBe(false); // no timer is reconstructed
    expect(has(ls.restOver)).toBe(false);
  });

  it('reads long gaps in hours and short ones as under a minute', async () => {
    const s = await makeSession();
    unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 80, isCompleted: true }));
    mockNow = env.clock.now() + 65 * 60_000;
    await mount();
    expect(has('Last set logged: 1 h 5 min ago.')).toBe(true);
    act(() => tree.unmount());
    mockNow = env.clock.now() + 20_000;
    await mount();
    expect(has('Last set logged: less than a minute ago.')).toBe(true);
  });

  it('does not invent a time when the clock reads earlier than the saved set', async () => {
    const s = await makeSession();
    unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 80, isCompleted: true }));
    mockNow = env.clock.now() - 3_600_000;
    await mount();
    expect(has(ls.resumedTitle)).toBe(true);
    expect(allText().some((x: string) => x.includes('Last set logged'))).toBe(false);
  });

  it('goes away on "Got it" and when a new set is logged, and is never shown for a finished workout', async () => {
    const s = await makeSession();
    unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 80, isCompleted: true }));
    mockNow = env.clock.now() + 60_000;
    await mount();
    await press(byText(ls.resumedDismiss));
    expect(has(ls.resumedTitle)).toBe(false);
    act(() => tree.unmount());
    await mount();
    expect(has(ls.resumedTitle)).toBe(true);
    await type(`${ls.reps}, ${BENCH}`, '6');
    await press(byLabel(logLabel(BENCH, 2)));
    expect(has(ls.resumedTitle)).toBe(false);
    await press(byText(ls.finish));
    await press(byText(ls.finishYes));
    act(() => tree.unmount());
    await mount();
    expect(has(ls.resumedTitle)).toBe(false);
  });

  it('typed-but-not-logged numbers are not kept across a reopening (only logged sets are), and logging continues from the saved set', async () => {
    const s = await makeSession();
    unwrap(await env.repos.sessions.addSet(s.exercises[0].id, { reps: 8, weightKg: 80, isCompleted: true }));
    mockNow = env.clock.now() + 60_000;
    await mount();
    await type(`${ls.reps}, ${BENCH}`, '99');
    act(() => tree.unmount());
    await mount();
    expect(input(`${ls.reps}, ${BENCH}`).props.value).toBe('8'); // prefilled from the saved set, not the lost 99
    expect(mockHeaderBack).toBeUndefined();
    await press(byLabel(logLabel(BENCH, 2)));
    expect((await dbSets()).map((r) => r.set_number)).toEqual([1, 2]);
  });
});

describe('wording', () => {
  it('no new English or Arabic string puts a number directly before a counted noun, so "1 sets" cannot occur', () => {
    const bad = /\{\{(count|done|total|reps|n)\}\}\s*(sets?|reps?|exercises?|workouts?|تكرار|مجموعة|مجموعات|تمارين|تمرين)/;
    for (const [lang, block] of [['en', en.liveSession], ['ar', ar.liveSession]] as const) {
      for (const [key, value] of Object.entries(block)) expect([lang, key, bad.test(value)]).toEqual([lang, key, false]);
    }
  });
  it('the singular case reads naturally', async () => {
    const t = (key: string, o: Record<string, number>) => (en.liveSession as Record<string, string>)[key].replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o[k]));
    expect(t('finishConfirm', { count: 1 })).toBe('Finish this workout? Sets logged: 1. It will be saved as completed.');
    expect(t('summarySets', { count: 1 })).toBe('Sets logged: 1');
    expect(t('summaryExercises', { done: 1, total: 1 })).toBe('Exercises done: 1 of 1');
    expect(t('sumReps', { reps: 1 })).toBe('Reps: 1');
  });
});

describe('Arabic', () => {
  it('labels, set summaries and the summary use the Arabic strings and exercise names', async () => {
    const s = await makeSession();
    mockLocale = 'ar';
    await mount();
    const bench = ar.exercises.benchPress;
    await type(`${ar.liveSession.weightKg}, ${bench}`, '80');
    await type(`${ar.liveSession.reps}, ${bench}`, '8');
    await press(byLabel(`${ar.liveSession.logSet}: ${bench}, ${ar.liveSession.setNumber.replace('{{n}}', '1')}`));
    expect(has('80 كجم × 8')).toBe(true);
    expect(announced.some((a) => a.includes('80 كجم × 8'))).toBe(true);
    await press(byText(ar.liveSession.finish));
    await press(byText(ar.liveSession.finishYes));
    expect(has(ar.liveSession.summaryTitle)).toBe(true);
    expect(has('الوزن المرفوع: 640 كجم')).toBe(true);
    expect(unwrap(await env.repos.sessions.get(s.id)).status).toBe('completed');
  });
});
