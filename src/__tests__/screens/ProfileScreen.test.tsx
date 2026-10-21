/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) */
/**
 * Renders the real Profile tab (with the real ProfileProvider) against real repositories on in-memory Node SQLite.
 * It tests screen logic and persistence wiring - NOT the Expo SQLite native driver and NOT the visual layout.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { importLegacyProfile, LEGACY_PROFILE_KEY } from '../../db/legacyImport';
import { createRepoEnv, T0, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import ProfileScreen from '../../screens/ProfileScreen';
import { ProfileProvider, useProfileName } from '../../context/ProfileContext';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

let mockDb: { state: unknown; retry: jest.Mock };
let mockToday = '2026-10-21';
const mockUpdateProfile = jest.fn();
jest.mock('react-i18next', () => {
  const messages = require('../../locales/en.json');
  const t = (key: string, options?: Record<string, string>) => {
    const text: string = key.split('.').reduce((o: any, p) => (o == null ? undefined : o[p]), messages) ?? key;
    return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
  };
  const value = { t };
  return { useTranslation: () => value };
});
jest.mock('../../domain/dates', () => ({ ...jest.requireActual('../../domain/dates'), deviceLocalDate: () => mockToday }));
jest.mock('../../context/AppContext', () => ({
  useApp: () => ({
    isRTL: false,
    // the built-in demonstration profile, exactly what AppContext holds for someone who never saved one
    profile: { name: 'Jacob Donald', location: 'London, United Kingdom', age: 27, heightCm: 170, weightKg: 52 },
    settings: { cautionAreas: [], experience: 'beginner', language: 'en', soundEnabled: true, reminders: { enabled: false } },
    updateProfile: mockUpdateProfile,
    updateSettings: jest.fn(),
    setLanguage: jest.fn(),
  }),
}));
jest.mock('../../context/DatabaseContext', () => ({ useDatabase: () => mockDb }));
jest.mock('expo-router', () => ({ router: { canGoBack: () => false, back: jest.fn(), replace: jest.fn(), push: jest.fn() } }));
jest.mock('../../services/soundService', () => ({ playSound: jest.fn() }));
jest.mock('../../components/Screen', () => ({ Screen: (props: { children: unknown }) => props.children }));
jest.mock('../../components/AppHeader', () => {
  const { Pressable } = require('react-native');
  const R = require('react');
  return { AppHeader: ({ right }: { right?: { label: string; onPress: () => void } }) => (right ? R.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: right.label, onPress: right.onPress }) : null) };
});
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

jest.setTimeout(30_000);

let env: RepoEnv;
let tree: any;
let announced: string[];

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const mount = async (state: unknown, element: React.ReactElement = <ProfileProvider><ProfileScreen /></ProfileProvider>) => {
  mockDb = { state, retry: jest.fn() };
  await act(async () => { tree = TestRenderer.create(element); });
  await flush();
};
const textOf = (node: any): string => (node.children as any[]).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const allText = () => tree.root.findAll((n: any) => n.type === 'Text').map(textOf);
const has = (s: string) => allText().some((t: string) => t.includes(s));
const input = (label: string) => tree.root.find((n: any) => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
const type = async (label: string, v: string) => { await act(async () => { input(label).props.onChangeText(v); }); };
const pressButton = async (label: string) => {
  const node = tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && (n.props.accessibilityLabel === label || textOf(n) === label))[0];
  if (!node) throw new Error(`no button "${label}"`);
  await act(async () => { await node.props.onPress(); });
  await flush();
};
const buttonExists = (label: string) => tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && (n.props.accessibilityLabel === label || textOf(n) === label)).length > 0;
const ready = () => ({ status: 'ready', repos: env.repos, legacyError: null });
const profileRow = async () => unwrap(await env.repos.profile.get());
const weightCount = async () => Number((await env.db.first<{ c: number }>('SELECT count(*) c FROM weight_entries'))!.c);

beforeEach(async () => {
  env = await createRepoEnv();
  mockToday = '2026-10-21';
  announced = [];
  mockUpdateProfile.mockClear();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => { announced.push(m); });
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

const importLegacy = async (blob: object) =>
  unwrap(await importLegacyProfile({ getItem: async (k) => (k === LEGACY_PROFILE_KEY ? JSON.stringify(blob) : null) }, env.db, { clock: env.clock }));

describe('a fresh install: nothing is made up', () => {
  beforeEach(async () => mount(ready()));

  it('shows an empty state, not a demo name; editing is offered', () => {
    expect(has(en.profile.empty)).toBe(true);
    expect(has('Legacy Name')).toBe(false);
    expect(has('Jacob')).toBe(false);
    expect(buttonExists(en.profile.editProfile)).toBe(true);
  });
  it('a first profile needs only a name; the other values stay empty (not invented)', async () => {
    await pressButton(en.profile.editProfile);
    await pressButton(en.common.save);
    expect(has(en.validation.nameRequired)).toBe(true);
    expect(await profileRow()).toBeNull();
    await type('Name', 'Sam');
    await pressButton(en.common.save);
    expect(await profileRow()).toMatchObject({ displayName: 'Sam', ageYears: null, ageSetOn: null, heightCm: null, location: null, undatedWeightKg: null });
    expect(await weightCount()).toBe(0);
    expect(has(en.profile.saved)).toBe(true);
    expect(announced).toContain(en.profile.saved);
  });
  it('typed age and weight are saved as dated values: the age today, the weight as a manual entry', async () => {
    await pressButton(en.profile.editProfile);
    await type('Name', 'Sam');
    await type('Age', '30');
    await type('Height', '172,5');
    await type('Weight', '61.5');
    await pressButton(en.common.save);
    expect(await profileRow()).toMatchObject({ ageYears: 30, ageSetOn: '2026-10-21', heightCm: 172.5 });
    expect(unwrap(await env.repos.weight.latest())).toMatchObject({ weightKg: 61.5, source: 'manual', localDate: '2026-10-21' });
  });
  it('ambiguous or invalid numbers are explained and nothing is written', async () => {
    await pressButton(en.profile.editProfile);
    await type('Name', 'Sam');
    await type('Weight', '1,500');
    await type('Age', '9');
    await pressButton(en.common.save);
    expect(has(en.validation.ambiguousNumber)).toBe(true);
    expect(has(en.validation.ageRange)).toBe(true);
    expect(input('Weight').props.accessibilityHint).toBe(en.validation.ambiguousNumber);
    expect(await profileRow()).toBeNull();
    expect(announced.some((m) => m.startsWith('Please check:'))).toBe(true);
  });
  it('the old AsyncStorage profile is never written to by the new Profile tab', async () => {
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    await pressButton(en.profile.editProfile);
    await type('Name', 'Sam');
    await pressButton(en.common.save);
    expect(setItem).not.toHaveBeenCalled();
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });
});

describe('a profile carried over from the old app has no dates', () => {
  const blob = { name: 'Jacob Donald', location: 'London', age: 27, heightCm: 170, weightKg: 52 };
  beforeEach(async () => {
    await importLegacy(blob);
    await mount(ready());
  });

  it('shows the carried-over values together with a note that their date is unknown', () => {
    expect(has('Jacob Donald')).toBe(true);
    expect(has(`${en.profile.age}: ${en.profile.notes.age.unknown_date}`)).toBe(true);
    expect(has(`${en.profile.weight}: ${en.profile.notes.weight.unknown_date}`)).toBe(true);
    expect(allText().some((t: string) => t.startsWith('27 '))).toBe(true);
    expect(allText().some((t: string) => t.startsWith('52 '))).toBe(true);
  });
  it('the edit form does not present them as current: age and weight start empty with a hint carrying the old value', async () => {
    await pressButton(en.profile.editProfile);
    expect(input('Age').props.value).toBe('');
    expect(input('Weight').props.value).toBe('');
    expect(input('Height').props.value).toBe('170'); // height is not date-limited
    expect(has('Your saved age (27) has no entry date, so it was not filled in.')).toBe(true);
    expect(has('Your last saved weight (52 kg) has no valid date, so it was not filled in.')).toBe(true);
  });
  it('changing only the name leaves the age undated and the weight unchanged, and logs no weight', async () => {
    await pressButton(en.profile.editProfile);
    await type('Name', 'Jacob D.');
    await pressButton(en.common.save);
    expect(await profileRow()).toMatchObject({ displayName: 'Jacob D.', ageYears: 27, ageSetOn: null, undatedWeightKg: 52 });
    expect(await weightCount()).toBe(0);
    expect(has(`${en.profile.age}: ${en.profile.notes.age.unknown_date}`)).toBe(true); // still not claimed to be current
  });
  it('typing the age and weight again dates them today, and the new weight outranks the carried-over one', async () => {
    await pressButton(en.profile.editProfile);
    await type('Age', '28');
    await type('Weight', '53');
    await pressButton(en.common.save);
    expect(await profileRow()).toMatchObject({ ageYears: 28, ageSetOn: '2026-10-21' });
    expect(unwrap(await env.repos.weight.latest())).toMatchObject({ weightKg: 53, localDate: '2026-10-21' });
    expect(has(`${en.profile.age}: ${en.profile.notes.age.unknown_date}`)).toBe(false);
    expect(has(`${en.profile.weight}: ${en.profile.notes.weight.unknown_date}`)).toBe(false);
  });
  it('the Goals screen sees the same facts: the carried-over age and weight are not used as current', async () => {
    const { draftFromSaved } = require('../../domain/goalsDraft');
    const d = draftFromSaved({ goals: null, profile: await profileRow(), latestWeight: null, today: mockToday });
    expect(d).toMatchObject({ age: '', weightKg: '', heightCm: '170' });
  });
});

describe('fresh stored values', () => {
  beforeEach(async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam', ageYears: 28, heightCm: 165, sex: 'female', activityLevel: 'light' }));
    unwrap(await env.repos.weight.save({ weightKg: 61.5, localDate: '2026-10-15' }));
    await mount(ready());
  });

  it('fill the form; saving without changing the weight does not log it again; sex and activity level survive', async () => {
    await pressButton(en.profile.editProfile);
    expect(input('Age').props.value).toBe('28');
    expect(input('Weight').props.value).toBe('61.5');
    await type('Name', 'Samira');
    await pressButton(en.common.save);
    expect(await weightCount()).toBe(1);
    expect(await profileRow()).toMatchObject({ displayName: 'Samira', sex: 'female', activityLevel: 'light', ageYears: 28, ageSetOn: '2026-10-21' });
  });
  it('a changed weight is logged as a new entry for today and the card shows it', async () => {
    await pressButton(en.profile.editProfile);
    await type('Weight', '60');
    await pressButton(en.common.save);
    expect(await weightCount()).toBe(2);
    expect(unwrap(await env.repos.weight.latest())).toMatchObject({ weightKg: 60, localDate: '2026-10-21' });
    expect(allText().some((t: string) => t.startsWith('60 '))).toBe(true);
  });
  it('old values (a year later) are not put into the form', async () => {
    act(() => tree.unmount());
    mockToday = '2027-12-01';
    await mount(ready());
    expect(has(`${en.profile.age}: entered on 2026-10-21, more than a year ago; it may be out of date.`)).toBe(true);
    await pressButton(en.profile.editProfile);
    expect(input('Age').props.value).toBe('');
    expect(input('Weight').props.value).toBe('');
  });
});

describe('failures never overwrite stored data', () => {
  it('if the stored profile cannot be read, editing is off, a reload is offered, and nothing can be saved', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam', ageYears: 28 }));
    let broken = true;
    const flaky = { ...env.repos, profile: { ...env.repos.profile, get: async () => (broken ? { ok: false as const, error: { kind: 'busy' as const, message: 'x' } } : env.repos.profile.get()) } };
    await mount({ status: 'ready', repos: flaky, legacyError: null });
    expect(has(en.profile.loadFailed)).toBe(true);
    expect(buttonExists(en.profile.editProfile)).toBe(false);
    broken = false;
    await pressButton(en.profile.reload);
    expect(has('Sam')).toBe(true);
    expect(buttonExists(en.profile.editProfile)).toBe(true);
  });
  it('if the read after a save fails, the old data stays visible but editing is switched off until a reload works', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam', ageYears: 28 }));
    let broken = false;
    const flaky = { ...env.repos, profile: { ...env.repos.profile, get: async () => (broken ? { ok: false as const, error: { kind: 'busy' as const, message: 'x' } } : env.repos.profile.get()) } };
    await mount({ status: 'ready', repos: flaky, legacyError: null });
    await pressButton(en.profile.editProfile);
    await type('Name', 'Sam B');
    broken = true; // the save itself works, the read that follows does not
    await pressButton(en.common.save);
    expect((await profileRow())!.displayName).toBe('Sam B');
    expect(has(en.profile.loadFailed)).toBe(true);
    expect(buttonExists(en.profile.editProfile)).toBe(false); // data is still on screen, but editing is off
    expect(has('Sam')).toBe(true);
    broken = false;
    await pressButton(en.profile.reload);
    expect(has('Sam B')).toBe(true);
    expect(buttonExists(en.profile.editProfile)).toBe(true);
  });
  it('profile saved but the new weight failed: the profile stays saved and the screen says exactly that', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam' }));
    const failingWeight = { ...env.repos, weight: { ...env.repos.weight, save: async () => ({ ok: false as const, error: { kind: 'busy' as const, message: 'x' } }) } };
    await mount({ status: 'ready', repos: failingWeight, legacyError: null });
    await pressButton(en.profile.editProfile);
    await type('Name', 'Sam B');
    await type('Weight', '60');
    await pressButton(en.common.save);
    expect((await profileRow())!.displayName).toBe('Sam B');
    expect(await weightCount()).toBe(0);
    expect(has(en.profile.savedPartial)).toBe(true);
    expect(has(en.errors.busy)).toBe(true);
  });
  it('a failed profile save keeps the form open with what was typed', async () => {
    const failingProfile = { ...env.repos, profile: { ...env.repos.profile, save: async () => ({ ok: false as const, error: { kind: 'busy' as const, message: 'x' } }) } };
    await mount({ status: 'ready', repos: failingProfile, legacyError: null });
    await pressButton(en.profile.editProfile);
    await type('Name', 'Sam');
    await pressButton(en.common.save);
    expect(input('Name').props.value).toBe('Sam');
    expect(has(en.errors.busy)).toBe(true);
    expect(announced).toContain(en.errors.busy);
  });
});

describe('when the database is not available', () => {
  beforeEach(async () => mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'native_module_missing' } }));

  it('shows an unavailable state and NO profile data: the built-in demo profile is never presented as the person\'s own', () => {
    const all = allText().join(' | ');
    for (const demo of ['Jacob', 'Donald', 'London', '27', '170', '52']) expect(all).not.toContain(demo);
    expect(has(`${en.errors.unavailable} ${en.profile.unavailableNote}`)).toBe(true);
    expect(has(en.profile.empty)).toBe(false); // not "no profile yet" either: it is simply not available
    expect(has(en.profile.loading)).toBe(false);
  });
  it('offers retry, cannot edit, and has no Personal Information row', async () => {
    expect(buttonExists(en.profile.editProfile)).toBe(false);
    expect(buttonExists(en.profile.personalInfo)).toBe(false);
    await pressButton(en.goals.retry);
    expect(mockDb.retry).toHaveBeenCalled();
  });
});

describe('the Personal Information row exists only when editing is possible', () => {
  it('present when the profile loaded', async () => {
    await mount(ready());
    expect(buttonExists(en.profile.personalInfo)).toBe(true);
    await pressButton(en.profile.personalInfo);
    expect(input('Name')).toBeTruthy(); // and it opens the editor
  });
  it('absent while loading', async () => {
    await mount({ status: 'loading' });
    expect(buttonExists(en.profile.personalInfo)).toBe(false);
  });
  it('absent when the stored profile could not be read, and back after a successful reload', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam' }));
    let broken = true;
    const flaky = { ...env.repos, profile: { ...env.repos.profile, get: async () => (broken ? { ok: false as const, error: { kind: 'busy' as const, message: 'x' } } : env.repos.profile.get()) } };
    await mount({ status: 'ready', repos: flaky, legacyError: null });
    expect(buttonExists(en.profile.personalInfo)).toBe(false);
    broken = false;
    await pressButton(en.profile.reload);
    expect(buttonExists(en.profile.personalInfo)).toBe(true);
  });
  it('the other rows (Goals, reminders) are unaffected', async () => {
    await mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    expect(buttonExists(en.profile.goalsRow)).toBe(true);
  });
});

describe('screen-reader announcements for the profile states', () => {
  /** The provider settles FIRST, then the tab opens - what happens when the person opens the Profile tab after the app has started. */
  const gate: { open: (v: boolean) => void } = { open: () => undefined };
  const Gate = () => {
    const [show, setShow] = React.useState(false);
    React.useEffect(() => { gate.open = setShow; }, []);
    return show ? <ProfileScreen /> : null;
  };
  const openSettled = async (state: unknown) => {
    await mount(state, <ProfileProvider><Gate /></ProfileProvider>);
    await act(async () => { gate.open(true); });
    await flush();
  };
  const noLiveRegion = () => expect(tree.root.findAll((n: any) => n.props.accessibilityLiveRegion !== undefined)).toHaveLength(0);

  it('loading is announced when it starts, and "loaded" once it is done', async () => {
    await mount({ status: 'loading' });
    expect(announced).toEqual([en.profile.loading]);
    mockDb = { state: ready(), retry: jest.fn() };
    await act(async () => { tree.update(<ProfileProvider><ProfileScreen /></ProfileProvider>); });
    await flush();
    expect(announced).toEqual([en.profile.loading, en.profile.a11y.loaded]);
    noLiveRegion();
  });
  it('an already settled profile says nothing when the tab opens', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam' }));
    await openSettled(ready());
    expect(has('Sam')).toBe(true);
    expect(announced).toEqual([]);
  });
  it('a database that is unavailable is announced once, with the same text that is shown', async () => {
    await mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'native_module_missing' } });
    expect(announced).toEqual([`${en.errors.unavailable} ${en.profile.unavailableNote}`]);
    noLiveRegion();
  });
  it('a failed read is announced once (not on every render)', async () => {
    const broken = { ...env.repos, profile: { ...env.repos.profile, get: async () => ({ ok: false as const, error: { kind: 'busy' as const, message: 'x' } }) } };
    await openSettled({ status: 'ready', repos: broken, legacyError: null });
    expect(announced).toEqual([en.profile.loadFailed]);
    await act(async () => { tree.update(<ProfileProvider><Gate /></ProfileProvider>); });
    await flush();
    expect(announced).toEqual([en.profile.loadFailed]);
  });
  it('when the provider and the screen start together, loading comes first and the failure after it', async () => {
    const broken = { ...env.repos, profile: { ...env.repos.profile, get: async () => ({ ok: false as const, error: { kind: 'busy' as const, message: 'x' } }) } };
    await mount({ status: 'ready', repos: broken, legacyError: null });
    expect(announced).toEqual([en.profile.loading, en.profile.loadFailed]);
  });
  it('a read that fails after a save is announced too', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam' }));
    let broken = false;
    const flaky = { ...env.repos, profile: { ...env.repos.profile, get: async () => (broken ? { ok: false as const, error: { kind: 'busy' as const, message: 'x' } } : env.repos.profile.get()) } };
    await mount({ status: 'ready', repos: flaky, legacyError: null });
    await pressButton(en.profile.editProfile);
    await type('Name', 'Sam B');
    broken = true;
    announced.length = 0;
    await pressButton(en.common.save);
    expect(announced).toContain(en.profile.saved);
    expect(announced).toContain(en.profile.loadFailed);
  });
  it('an unreadable legacy profile is announced once', async () => {
    await openSettled({ status: 'ready', repos: env.repos, legacyError: { kind: 'legacy_data_invalid', key: LEGACY_PROFILE_KEY } });
    expect(announced).toEqual([en.profile.legacyUnreadable]);
    await act(async () => { tree.update(<ProfileProvider><Gate /></ProfileProvider>); });
    await flush();
    expect(announced).toEqual([en.profile.legacyUnreadable]);
  });
  it('retrying out of "unavailable" announces loading, then loaded', async () => {
    await mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    announced.length = 0;
    mockDb = { state: { status: 'loading' }, retry: jest.fn() };
    await act(async () => { tree.update(<ProfileProvider><ProfileScreen /></ProfileProvider>); }); await flush();
    mockDb = { state: ready(), retry: jest.fn() };
    await act(async () => { tree.update(<ProfileProvider><ProfileScreen /></ProfileProvider>); }); await flush();
    expect(announced).toEqual([en.profile.loading, en.profile.a11y.loaded]);
  });
});

describe('the legacy profile could not be read at startup', () => {
  it('the screen says so and the database keeps working', async () => {
    await mount({ status: 'ready', repos: env.repos, legacyError: { kind: 'legacy_data_invalid', key: LEGACY_PROFILE_KEY } });
    expect(has(en.profile.legacyUnreadable)).toBe(true);
    expect(has(en.profile.empty)).toBe(true);
  });
});

describe('Home greeting name (useProfileName)', () => {
  const Probe = () => {
    const name = useProfileName();
    const R = require('react');
    const { Text } = require('react-native');
    return R.createElement(Text, null, name === null ? 'NULL' : name);
  };
  const show = async (state: unknown) => {
    await mount(state, <ProfileProvider><Probe /></ProfileProvider>);
    return allText()[0];
  };

  it('no profile -> null (a neutral greeting), never a made-up name', async () => {
    expect(await show(ready())).toBe('NULL');
  });
  it('the stored name', async () => {
    unwrap(await env.repos.profile.save({ displayName: 'Sam' }));
    expect(await show(ready())).toBe('Sam');
  });
  it('loading -> null (no flash of an old or demo name)', async () => {
    expect(await show({ status: 'loading' })).toBe('NULL');
  });
  it('database unavailable -> null too: the built-in demo name is never used', async () => {
    expect(await show({ status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } })).toBe('NULL');
  });
});

it('T0 is the fixed clock these tests use', () => expect(env.clock.now()).toBe(T0));
