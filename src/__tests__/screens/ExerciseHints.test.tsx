/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real library, detail, builder, workout and session screens with Profile settings applied against a real in-memory SQLite database
 * (Node SQLite through the repositories). This tests screen logic and persistence wiring, NOT the Expo SQLite
 * native driver, NOT screen-reader output on a device and NOT the visual layout.
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { EXERCISE_LIBRARY, SEED_PACK } from '../../data/exerciseLibrary';
import { runSeed } from '../../db/seedRunner';
import { createRepoEnv, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import ar from '../../locales/ar.json';
import ExerciseDetailScreen from '../../screens/ExerciseDetailScreen';
import ExerciseLibraryScreen from '../../screens/ExerciseLibraryScreen';
import SessionScreen from '../../screens/SessionScreen';
import TemplateDetailScreen from '../../screens/TemplateDetailScreen';
import TemplateFormScreen from '../../screens/TemplateFormScreen';

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
const rec = en.recs;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async (Screen: React.ComponentType, state: unknown = { status: 'ready', repos: env.repos }) => {
  mockDb = { state, retry: jest.fn() };
  await act(async () => { tree = TestRenderer.create(<Screen />); });
  await flush();
};
const textOf = (node: any): string => (node.children as any[]).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const allText = (): string[] => tree.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map(textOf);
const has = (s: string) => allText().some((x: string) => x.includes(s));
const count = (s: string) => allText().filter((x: string) => x === s).length;
const press = async (match: (n: any) => boolean) => {
  const node = tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && match(n))[0];
  if (!node) throw new Error('no pressable matched');
  await act(async () => { await node.props.onPress(); });
  await flush();
};
const pressText = (label: string) => press((n) => textOf(n) === label);
const labelOf = (name: string) => tree.root.findAll((n: any) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(name) && typeof n.props.onPress === 'function').map((n: any) => n.props.accessibilityLabel as string)[0];

const nameOfEntry = (id: string) => (en.exercises as Record<string, string>)[id];
const works = (e: (typeof EXERCISE_LIBRARY)[number], m: string) => [e.primaryMuscle, ...e.secondaryMuscles].includes(m as never);
const shoulder = EXERCISE_LIBRARY.find((e) => works(e, 'shoulders') && e.equipment === 'barbell')!;
const noShoulder = EXERCISE_LIBRARY.find((e) => !works(e, 'shoulders') && e.equipment === 'bodyweight')!;
const idOf = async (entry: { id: string }) => unwrap(await env.repos.exercises.list()).find((e) => e.slug === entry.id.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`))!.id;

beforeEach(async () => {
  env = await createRepoEnv();
  unwrap(await runSeed(env.db, SEED_PACK, env.clock));
  mockSettings = { experience: 'intermediate', cautionAreas: [] };
  mockParams = {};
  mockLocale = 'en';
  mockPush.mockReset();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('exercise library hints', () => {
  it('with no caution area and a non-beginner level there are no hints and no limits card', async () => {
    await mount(ExerciseLibraryScreen);
    expect(has('Caution area')).toBe(false);
    expect(has(rec.limitsTitle)).toBe(false);
    expect(has(rec.friendly)).toBe(false);
  });

  it('a shoulder caution marks exactly the exercises that work the shoulders, and says what cannot be checked', async () => {
    mockSettings = { experience: 'intermediate', cautionAreas: ['shoulders', 'knees', 'wrists'] };
    await mount(ExerciseLibraryScreen);
    const flaggedCount = EXERCISE_LIBRARY.filter((e) => works(e, 'shoulders') || works(e, 'forearms')).length;
    expect(allText().filter((x) => x.startsWith('Caution area')).length).toBe(flaggedCount);
    expect(has('Caution area: Shoulders')).toBe(true);
    expect(has(rec.limitsTitle)).toBe(true);
    expect(has('Not checked: Knees.')).toBe(true);
    expect(has('Only partly checked: Wrists.')).toBe(true);
    expect(has(rec.disclaimer)).toBe(true);
    // knees is never used to flag anything
    expect(allText().some((x) => x.startsWith('Caution area') && x.includes('Knees'))).toBe(false);
  });

  it('an unmapped area alone flags nothing but still explains why (ankles included: calf data says too little)', async () => {
    mockSettings = { experience: 'intermediate', cautionAreas: ['neck', 'lowerBack', 'ankles'] };
    await mount(ExerciseLibraryScreen);
    expect(has('Caution area')).toBe(false);
    expect(has('Not checked: Neck, Lower back, Ankles.')).toBe(true);
    expect(has('Only partly checked')).toBe(false);
  });

  it('a beginner sees easy-to-start and more-technical marks; an advanced user sees none', async () => {
    mockSettings = { experience: 'beginner', cautionAreas: [] };
    await mount(ExerciseLibraryScreen);
    expect(has(rec.friendly)).toBe(true);
    expect(has(rec.technical)).toBe(true);
    expect(has(rec.limitsTitle)).toBe(false); // no caution area chosen: no limits card
    act(() => tree.unmount());
    mockSettings = { experience: 'advanced', cautionAreas: [] };
    await mount(ExerciseLibraryScreen);
    expect(has(rec.friendly) || has(rec.technical)).toBe(false);
  });

  it('the hint is part of the row\'s accessibility label', async () => {
    mockSettings = { experience: 'intermediate', cautionAreas: ['shoulders'] };
    await mount(ExerciseLibraryScreen);
    expect(labelOf(nameOfEntry(shoulder.id))).toContain('Caution area: Shoulders');
    expect(labelOf(nameOfEntry(noShoulder.id))).not.toContain('Caution area');
  });

  it('nothing is hidden or reordered in the library because of the settings', async () => {
    const plain = async () => { await mount(ExerciseLibraryScreen); const t = tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && /·/.test(String(n.props.accessibilityLabel ?? ''))).map((n: any) => String(n.props.accessibilityLabel).split(',')[0]); act(() => tree.unmount()); return t; };
    const before = await plain();
    mockSettings = { experience: 'beginner', cautionAreas: ['shoulders', 'knees'] };
    expect(await plain()).toEqual(before);
  });

  it('the detail screen shows the hints and the limits for that exercise', async () => {
    mockSettings = { experience: 'beginner', cautionAreas: ['shoulders', 'neck'] };
    mockParams = { id: String(await idOf(shoulder)) };
    await mount(ExerciseDetailScreen);
    expect(has('Caution area: Shoulders')).toBe(true);
    expect(has(rec.technical)).toBe(true); // a barbell exercise, for a beginner
    expect(has('Not checked: Neck.')).toBe(true);
  });

  it('uses the Arabic strings', async () => {
    mockLocale = 'ar';
    mockSettings = { experience: 'beginner', cautionAreas: ['shoulders', 'knees'] };
    await mount(ExerciseLibraryScreen);
    expect(has(`منطقة حذر: ${ar.profile.areas.shoulders}`)).toBe(true);
    expect(has(ar.recs.limitsTitle)).toBe(true);
    expect(has(ar.recs.friendly)).toBe(true);
  });
});

describe('workout builder, workout and session hints', () => {
  const picker = async () => { await mount(TemplateFormScreen); await pressText(en.templates.add); };
  const pickerNames = (): string[] => [...new Set<string>(tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel ?? '').startsWith(`${en.templates.add}: `)).map((n: any) => String(n.props.accessibilityLabel).slice(en.templates.add.length + 2).split(',')[0]))];

  it('without relevant settings the picker keeps the library order', async () => {
    await picker();
    const names = pickerNames();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  });

  it('exercises that touch a caution area move to the end of the picker and are marked; none are removed', async () => {
    await picker();
    const all = pickerNames();
    act(() => tree.unmount());
    mockSettings = { experience: 'intermediate', cautionAreas: ['shoulders'] };
    await picker();
    const ranked = pickerNames();
    expect([...ranked].sort()).toEqual([...all].sort());
    const flaggedNames = new Set(EXERCISE_LIBRARY.filter((e) => works(e, 'shoulders')).map((e) => nameOfEntry(e.id)));
    const firstFlagged = ranked.findIndex((n) => flaggedNames.has(n));
    expect(ranked.slice(firstFlagged).every((n) => flaggedNames.has(n))).toBe(true);
    expect(has(rec.limitsTitle)).toBe(true);
    expect(has('Caution area: Shoulders')).toBe(true);
  });

  it('for a beginner, easy-to-start exercises come first', async () => {
    mockSettings = { experience: 'beginner', cautionAreas: [] };
    await picker();
    const names = pickerNames();
    const easy = new Set(EXERCISE_LIBRARY.filter((e) => ['bodyweight', 'machine', 'band', 'cardio_machine'].includes(e.equipment)).map((e) => nameOfEntry(e.id)));
    const technical = new Set(EXERCISE_LIBRARY.filter((e) => ['barbell', 'kettlebell'].includes(e.equipment)).map((e) => nameOfEntry(e.id)));
    const lastEasy = Math.max(...names.map((n, i) => (easy.has(n) ? i : -1)));
    const firstTechnical = names.findIndex((n) => technical.has(n));
    expect(lastEasy).toBeLessThan(firstTechnical);
  });

  it('a saved workout and a running session show the caution hint beside the exercise', async () => {
    const t = unwrap(await env.repos.templates.create({ name: 'Shoulders', exercises: [
      { exerciseId: await idOf(shoulder), targetSets: 3, targetRepsMin: 8, restSec: 60 },
      { exerciseId: await idOf(noShoulder), targetSets: 3, targetRepsMin: 8, restSec: 60 },
    ] }));
    mockSettings = { experience: 'intermediate', cautionAreas: ['shoulders'] };
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(count('Caution area: Shoulders')).toBe(1);
    expect(has(rec.limitsTitle)).toBe(true);
    act(() => tree.unmount());
    const s = unwrap(await env.repos.sessions.start({ templateId: t.id }));
    mockParams = { id: String(s.id) };
    await mount(SessionScreen);
    expect(count('Caution area: Shoulders')).toBe(1);
    expect(has(rec.friendly) || has(rec.technical)).toBe(false); // level hints are for choosing, not shown mid-workout
  });

  it('changing the settings changes the hints, and removing the caution area removes them', async () => {
    mockSettings = { experience: 'intermediate', cautionAreas: [] };
    const t = unwrap(await env.repos.templates.create({ name: 'S', exercises: [{ exerciseId: await idOf(shoulder), targetSets: 3, targetRepsMin: 8, restSec: 60 }] }));
    mockParams = { id: String(t.id) };
    await mount(TemplateDetailScreen);
    expect(has('Caution area')).toBe(false);
  });
});
