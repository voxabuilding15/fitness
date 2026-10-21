/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) and has no bundled types */
/**
 * Renders the real GoalsScreen against a real in-memory SQLite database (Node SQLite through the repositories).
 * This tests the screen logic and persistence wiring, NOT the Expo SQLite native driver and NOT the visual layout.
 */
import React from 'react';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { createRepoEnv, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import GoalsScreen from '../../screens/GoalsScreen';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

let mockDb: { state: unknown; retry: () => void };
jest.mock('react-i18next', () => {
  const messages = require('../../locales/en.json');
  // one stable function, like i18next's t (a new function every render would re-run effects that depend on it)
  const t = (key: string, options?: Record<string, string>) => {
    const text: string = key.split('.').reduce((o: any, p) => (o == null ? undefined : o[p]), messages) ?? key;
    return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
  };
  const value = { t };
  return {
    useTranslation: () => value,
  };
});
let mockToday = '2026-10-21';
jest.mock('../../domain/dates', () => ({ ...jest.requireActual('../../domain/dates'), deviceLocalDate: () => mockToday }));
jest.mock('../../context/AppContext', () => ({ useApp: () => ({ isRTL: false }) }));
jest.mock('../../context/DatabaseContext', () => ({ useDatabase: () => mockDb }));
jest.mock('expo-router', () => ({ router: { canGoBack: () => false, back: jest.fn(), replace: jest.fn(), push: jest.fn() } }));
jest.mock('../../services/soundService', () => ({ playSound: jest.fn() }));
const mockScreenProps: Record<string, unknown>[] = [];
jest.mock('../../components/Screen', () => ({
  Screen: (props: { children: unknown }) => {
    mockScreenProps.push(props as Record<string, unknown>);
    return props.children;
  },
}));
jest.mock('../../components/AppHeader', () => ({ AppHeader: () => null }));
jest.mock('../../components/Icon', () => ({ Icon: () => null }));

// the first render pays for transforming the screen and its imports; under a parallel coverage run that can exceed Jest's 5 s default
jest.setTimeout(30_000);

const WATER = 'Water (ml) (Preliminary estimate)'; // water is always a preliminary estimate
let env: RepoEnv;
let tree: any;

const flush = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const mount = async (state: unknown) => {
  mockDb = { state, retry: jest.fn() };
  await act(async () => { tree = TestRenderer.create(<GoalsScreen />); });
  await flush();
};
const textOf = (node: any): string => (node.children as any[]).map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
const allText = () => tree.root.findAll((n: any) => typeof n.type === 'string' && n.type === 'Text').map(textOf);
const input = (label: string) => tree.root.find((n: any) => n.props.accessibilityLabel === label && typeof n.props.onChangeText === 'function');
const type = async (label: string, v: string) => { await act(async () => { input(label).props.onChangeText(v); }); };
const press = async (match: (n: any) => boolean) => {
  const node = tree.root.findAll((n: any) => typeof n.props.onPress === 'function' && match(n))[0];
  if (!node) throw new Error('no pressable matched');
  await act(async () => { await node.props.onPress(); });
  await flush();
};
const pressText = (label: string) => press((n) => textOf(n) === label);
/** Presses the radio called `label` INSIDE the radio group called `group`; throws if that group does not contain it. */
const pressRadio = async (group: string, label: string) => {
  const groups = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radiogroup' && n.props.accessibilityLabel === group);
  if (!groups.length) throw new Error(`no radio group "${group}"`);
  const radio = groups[0].findAll((n: any) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function' && textOf(n) === label)[0];
  if (!radio) throw new Error(`radio group "${group}" has no option "${label}"`);
  await act(async () => { await radio.props.onPress(); });
  await flush();
};
const has = (s: string) => allText().some((t: string) => t.includes(s));
const count = (s: string) => allText().filter((t: string) => t === s).length;

const fillDetails = async () => {
  await pressRadio('Sex', 'Male');
  await type('Age (years)', '30');
  await type('Height (cm)', '180');
  await type('Weight (kg)', '80');
  await pressRadio('Activity level', 'Moderately active');
};

let announced: string[];
beforeEach(async () => {
  env = await createRepoEnv();
  mockToday = '2026-10-21';
  announced = [];
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => { announced.push(m); });
});
afterEach(() => {
  act(() => tree?.unmount());
  jest.restoreAllMocks();
});

describe('GoalsScreen with an empty database', () => {
  beforeEach(async () => mount({ status: 'ready', repos: env.repos }));

  it('starts with nothing invented: empty details, empty targets, no estimate labels, balanced nutrition selected', () => {
    for (const label of ['Age (years)', 'Height (cm)', 'Weight (kg)']) expect(input(label).props.value).toBe('');
    for (const label of ['Calories (kcal)', 'Protein (g)', 'Carbohydrates (g)', 'Fat (g)', WATER]) expect(input(label).props.value).toBe('');
    expect(count('Estimate')).toBe(0); // no estimate badge on anything that was not calculated
    expect(count('Preliminary estimate')).toBe(1); // but water is always a preliminary estimate
    const balanced = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && textOf(n) === 'Balanced nutrition')[0];
    expect(balanced.props.accessibilityState.checked).toBe(true);
    const weekly = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && ['0', '1', '3', '7'].includes(textOf(n)));
    expect(weekly.every((n: any) => n.props.accessibilityState.checked === false)).toBe(true);
  });

  it('calculating with missing details reports each missing field and fills nothing', async () => {
    await pressText('Calculate estimate');
    expect(count(en.validation.required)).toBe(5); // sex, age, height, weight, activity
    expect(has(en.goals.fixFields)).toBe(true);
    expect(input('Calories (kcal)').props.value).toBe('');
    expect(count('Estimate')).toBe(0); // no estimate badge on anything that was not calculated
    expect(count('Preliminary estimate')).toBe(1); // but water is always a preliminary estimate
  });

  it('an invalid value is reported as such, not replaced', async () => {
    await fillDetails();
    await type('Age (years)', '7');
    await type('Height (cm)', 'tall');
    await pressText('Calculate estimate');
    expect(has(en.validation.outOfRange)).toBe(true);
    expect(has(en.validation.invalid)).toBe(true);
    expect(input('Calories (kcal)').props.value).toBe('');
  });

  it('calculates an estimate: values filled, every one labelled an estimate, water labelled preliminary', async () => {
    await fillDetails();
    await pressText('Calculate estimate');
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('2759');
    expect(input('Protein (g) (Estimate)').props.value).toBe('128');
    expect(input('Carbohydrates (g) (Estimate)').props.value).toBe('389');
    expect(input('Fat (g) (Estimate)').props.value).toBe('77');
    expect(input('Water (ml) (Preliminary estimate)').props.value).toBe('2800');
    expect(count('Estimate')).toBe(4);
    expect(count('Preliminary estimate')).toBe(1);
    expect(has('not medical advice')).toBe(true);
  });

  it('editing a value removes its estimate label; other values keep it', async () => {
    await fillDetails();
    await pressText('Calculate estimate');
    await type('Protein (g) (Estimate)', '150');
    expect(input('Protein (g) (Edited)').props.value).toBe('150');
    expect(count('Estimate')).toBe(3); // calories, carbohydrates, fat
    expect(count('Edited')).toBe(1);
    expect(count('Preliminary estimate')).toBe(1); // water is still labelled
  });

  it('fat loss starts at a 20 % deficit and the user can change it; muscle gain starts at 10 %', async () => {
    await fillDetails();
    await pressRadio('Nutrition goal', 'Lose fat');
    expect(input('Calorie deficit (%)').props.value).toBe('20');
    await pressText('Calculate estimate');
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('2207');
    await type('Calorie deficit (%)', '10');
    expect(has(en.goals.stale)).toBe(true); // the shown estimate is out of date until recalculated
    await pressText('Recalculate estimate');
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('2483');
    expect(has(en.goals.stale)).toBe(false);
    await pressRadio('Nutrition goal', 'Build muscle');
    expect(input('Calorie surplus (%)').props.value).toBe('10');
  });

  it('saving needs a weekly workout target chosen by the user, and persists nothing without it', async () => {
    await fillDetails();
    await pressText('Calculate estimate');
    await pressText(en.goals.save);
    expect(has(en.validation.required)).toBe(true);
    expect(await env.repos.goals.get()).toEqual({ ok: true, value: null });
  });

  it('saves the estimated goals through the repository (source "calculated"); the profile and weight are not touched', async () => {
    await fillDetails();
    await pressText('Calculate estimate');
    await pressRadio('Workouts per week', '4');
    await pressText(en.goals.save);
    const saved = await env.repos.goals.get();
    expect(saved.ok && saved.value).toMatchObject({
      goalType: 'maintain', kcalTarget: 2759, proteinG: 128, carbsG: 389, fatG: 77, waterMlTarget: 2800, weeklyWorkoutTarget: 4, source: 'calculated',
    });
    expect(await env.repos.profile.get()).toEqual({ ok: true, value: null });
    expect(await env.repos.weight.latest()).toEqual({ ok: true, value: null });
    expect(has(en.goals.savedEstimate)).toBe(true);
  });

  it('edited values are saved as the user\'s own goals (source "manual")', async () => {
    await fillDetails();
    await pressText('Calculate estimate');
    await type('Protein (g) (Estimate)', '150');
    await pressRadio('Workouts per week', '3');
    await pressText(en.goals.save);
    const saved = await env.repos.goals.get();
    expect(saved.ok && saved.value).toMatchObject({ proteinG: 150, kcalTarget: 2759, source: 'manual' });
  });

  it('a manual goal needs only water and the weekly target; empty calories/macros are saved as "no target"', async () => {
    await type(WATER, '2500');
    await pressRadio('Workouts per week', '5');
    await pressText(en.goals.save);
    const saved = await env.repos.goals.get();
    expect(saved.ok && saved.value).toMatchObject({ waterMlTarget: 2500, kcalTarget: null, proteinG: null, weeklyWorkoutTarget: 5, source: 'manual' });
  });

  it('out-of-range values are rejected with messages and nothing is saved', async () => {
    await type('Calories (kcal)', '300');
    await type(WATER, '100');
    await pressRadio('Workouts per week', '2');
    await pressText(en.goals.save);
    expect(count(en.validation.outOfRange)).toBe(2);
    expect(await env.repos.goals.get()).toEqual({ ok: true, value: null });
  });
});

describe('GoalsScreen with existing data', () => {
  it('shows saved goals, keeps them across a reopen, prefills from the database profile and carries the target weight through a save', async () => {
    await env.repos.profile.save({ displayName: 'Sam', sex: 'female', ageYears: 28, heightCm: 165, activityLevel: 'light' });
    await env.repos.weight.save({ weightKg: 60 });
    await env.repos.goals.save({ goalType: 'lose_fat', targetWeightKg: 55, kcalTarget: 1800, proteinG: 120, waterMlTarget: 2100, weeklyWorkoutTarget: 3, source: 'manual' });
    await mount({ status: 'ready', repos: env.repos });
    expect(input('Calories (kcal)').props.value).toBe('1800');
    expect(input('Age (years)').props.value).toBe('28');
    expect(input('Weight (kg)').props.value).toBe('60');
    expect(count('Estimate')).toBe(0); // manual goals are not labelled as estimates
    await type(WATER, '2200');
    await pressText(en.goals.save);
    const saved = await env.repos.goals.get();
    expect(saved.ok && saved.value).toMatchObject({ targetWeightKg: 55, goalType: 'lose_fat', waterMlTarget: 2200, kcalTarget: 1800 });
    const profile = await env.repos.profile.get();
    expect(profile.ok && profile.value).toMatchObject({ displayName: 'Sam', ageYears: 28 }); // untouched
  });
});

describe('GoalsScreen when the database is unavailable', () => {
  beforeEach(async () => mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'native_module_missing' } }));

  it('says so, offers retry, still calculates, and cannot save', async () => {
    expect(has(en.errors.unavailable)).toBe(true);
    expect(has(en.goals.notReady)).toBe(true);
    const save = tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && textOf(n) === en.goals.save)[0];
    expect(save.props.disabled).toBe(true);
    await fillDetails();
    await pressText('Calculate estimate');
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('2759');
    await pressText(en.goals.retry);
    expect(mockDb.retry).toHaveBeenCalled();
  });
});

describe('GoalsScreen while the database is loading', () => {
  it('shows a loading state instead of an empty form', async () => {
    await mount({ status: 'loading' });
    expect(has(en.goals.loading)).toBe(true);
    expect(tree.root.findAll((n: any) => n.props.accessibilityLabel === 'Age (years)').length).toBe(0);
  });
});

describe('L3: the radio helper checks the right group', () => {
  beforeEach(async () => mount({ status: 'ready', repos: env.repos }));

  it('an option that exists only in another group does not satisfy the press', async () => {
    await expect(pressRadio('Nutrition goal', 'Male')).rejects.toThrow('has no option "Male"');
    await expect(pressRadio('Sex', 'Lose fat')).rejects.toThrow('has no option "Lose fat"');
    await expect(pressRadio('No such group', 'Male')).rejects.toThrow('no radio group');
    const male = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && textOf(n) === 'Male')[0];
    expect(male.props.accessibilityState.checked).toBe(false); // nothing was pressed by the failed attempts
  });
  it('the same label in the right group works', async () => {
    await pressRadio('Sex', 'Male');
    const male = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && textOf(n) === 'Male')[0];
    expect(male.props.accessibilityState.checked).toBe(true);
  });
});

describe('M1: a failed load never lets an empty form replace the stored goals', () => {
  const stored = { goalType: 'lose_fat', targetWeightKg: 55, kcalTarget: 1800, waterMlTarget: 2100, weeklyWorkoutTarget: 3, source: 'manual' } as const;
  const failing = (repos: RepoEnv['repos']) => ({ ...repos, goals: { ...repos.goals, get: async () => ({ ok: false as const, error: { kind: 'busy' as const, message: 'x' } }) } });
  const saveButton = () => tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && textOf(n) === en.goals.save)[0];

  it('shows why, keeps Save disabled, and a (forced) save attempt writes nothing', async () => {
    await env.repos.goals.save(stored);
    await mount({ status: 'ready', repos: failing(env.repos) });
    expect(has(en.goals.loadFailed)).toBe(true);
    expect(saveButton().props.disabled).toBe(true);
    await type(WATER, '2500');
    await pressRadio('Workouts per week', '5');
    await act(async () => { await saveButton().props.onPress(); }); // even if the press got through, save() must refuse
    await flush();
    const row = await env.repos.goals.get();
    expect(row.ok && row.value).toMatchObject({ goalType: 'lose_fat', targetWeightKg: 55, kcalTarget: 1800, waterMlTarget: 2100, weeklyWorkoutTarget: 3 });
    expect(has(en.goals.saved)).toBe(false);
  });
  it('calculating still works while saving is off', async () => {
    await mount({ status: 'ready', repos: failing(env.repos) });
    await fillDetails();
    await pressText('Calculate estimate');
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('2759');
    expect(saveButton().props.disabled).toBe(true);
  });
  it('reloading after the read works again enables Save, shows the stored goals, and keeps what was typed', async () => {
    await env.repos.goals.save(stored);
    let broken = true;
    const flaky = { ...env.repos, goals: { ...env.repos.goals, get: async () => (broken ? { ok: false as const, error: { kind: 'busy' as const, message: 'x' } } : env.repos.goals.get()) } };
    await mount({ status: 'ready', repos: flaky });
    await type('Age (years)', '41');
    expect(saveButton().props.disabled).toBe(true);
    broken = false;
    await pressText(en.goals.reload);
    expect(has(en.goals.loadFailed)).toBe(false);
    expect(saveButton().props.disabled).toBe(false);
    expect(input('Calories (kcal)').props.value).toBe('1800');
    expect(input('Age (years)').props.value).toBe('41'); // typed before the reload
    await pressText(en.goals.save);
    const row = await env.repos.goals.get();
    expect(row.ok && row.value).toMatchObject({ targetWeightKg: 55, kcalTarget: 1800, goalType: 'lose_fat' });
  });
});

describe('M2: a stale estimate is saved as manual, with clear feedback', () => {
  it('after changing the goal without recalculating: outdated labels, a warning, saved as manual with an explanatory message', async () => {
    await mount({ status: 'ready', repos: env.repos });
    await fillDetails();
    await pressText('Calculate estimate');
    await pressRadio('Nutrition goal', 'Lose fat');
    expect(has(en.goals.stale)).toBe(true);
    expect(count('Outdated estimate')).toBe(5); // all five targets, water too
    expect(count('Estimate')).toBe(0);
    await pressRadio('Workouts per week', '3');
    await pressText(en.goals.save);
    const row = await env.repos.goals.get();
    expect(row.ok && row.value).toMatchObject({ goalType: 'lose_fat', kcalTarget: 2759, source: 'manual' });
    expect(has(en.goals.savedStale)).toBe(true);
    expect(has(en.goals.savedEstimate)).toBe(false);
  });
  it('recalculating restores "Estimate" labels and the next save is "calculated"', async () => {
    await mount({ status: 'ready', repos: env.repos });
    await fillDetails();
    await pressText('Calculate estimate');
    await pressRadio('Nutrition goal', 'Lose fat');
    await pressText('Recalculate estimate');
    expect(has(en.goals.stale)).toBe(false);
    expect(count('Outdated estimate')).toBe(0);
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('2207');
    await pressRadio('Workouts per week', '3');
    await pressText(en.goals.save);
    const row = await env.repos.goals.get();
    expect(row.ok && row.value).toMatchObject({ goalType: 'lose_fat', kcalTarget: 2207, source: 'calculated' });
    expect(has(en.goals.savedEstimate)).toBe(true);
  });
});

describe('M3: retrying after "unavailable" keeps what the user entered', () => {
  it('typed details, the calculated estimate and the weekly target survive; untouched fields come from the database', async () => {
    await env.repos.profile.save({ displayName: 'Sam', sex: 'female', ageYears: 28, heightCm: 165, activityLevel: 'light' });
    await env.repos.goals.save({ goalType: 'lose_fat', kcalTarget: 1800, waterMlTarget: 2100, weeklyWorkoutTarget: 6, source: 'manual' });
    await mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    await fillDetails();
    await pressText('Calculate estimate');
    await pressRadio('Workouts per week', '2');
    mockDb = { state: { status: 'loading' }, retry: jest.fn() };
    await act(async () => { tree.update(<GoalsScreen />); }); await flush();
    mockDb = { state: { status: 'ready', repos: env.repos }, retry: jest.fn() };
    await act(async () => { tree.update(<GoalsScreen />); }); await flush();
    expect(input('Age (years)').props.value).toBe('30');
    expect(input('Height (cm)').props.value).toBe('180');
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('2759');
    const male = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && textOf(n) === 'Male')[0];
    expect(male.props.accessibilityState.checked).toBe(true);
    const two = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && textOf(n) === '2')[0];
    expect(two.props.accessibilityState.checked).toBe(true); // typed 2, not the stored 6
    const maintain = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && textOf(n) === 'Balanced nutrition')[0];
    expect(maintain.props.accessibilityState.checked).toBe(true); // the estimate was calculated for this goal
  });
  it('fields the user did not touch are filled from the database once it is ready', async () => {
    await env.repos.profile.save({ displayName: 'Sam', sex: 'female', ageYears: 28, heightCm: 165, activityLevel: 'light' });
    await mount({ status: 'unavailable', error: { kind: 'unavailable', reason: 'x' } });
    await type('Age (years)', '41');
    mockDb = { state: { status: 'ready', repos: env.repos }, retry: jest.fn() };
    await act(async () => { tree.update(<GoalsScreen />); }); await flush();
    expect(input('Age (years)').props.value).toBe('41'); // typed
    expect(input('Height (cm)').props.value).toBe('165'); // from the database
  });
});

describe('L2 in the screen: clamps and conflicts are never presented as plain results', () => {
  const details = async (sex: string, age: string, height: string, weight: string, activity: string) => {
    await pressRadio('Sex', sex);
    await type('Age (years)', age);
    await type('Height (cm)', height);
    await type('Weight (kg)', weight);
    await pressRadio('Activity level', activity);
  };
  beforeEach(async () => mount({ status: 'ready', repos: env.repos }));

  it('the BMR note appears only when the target really was set to the BMR', async () => {
    await details('Female', '25', '165', '60', 'Sedentary');
    await pressRadio('Nutrition goal', 'Lose fat');
    await pressText('Calculate estimate');
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('1345');
    expect(has(en.goals.floorNote)).toBe(true);
  });
  it('when the app minimum applies instead, the BMR note is NOT shown and the minimum is stated', async () => {
    await details('Female', '100', '100', '20', 'Sedentary');
    await pressRadio('Nutrition goal', 'Lose fat');
    await pressText('Calculate estimate');
    expect(input('Calories (kcal) (Estimate)').props.value).toBe('800');
    expect(has(en.goals.floorNote)).toBe(false);
    expect(has(en.goals.limits.kcal_min)).toBe(true);
  });
  it('0 g carbohydrate from a clamp is explained', async () => {
    await details('Female', '100', '100', '200', 'Sedentary');
    await pressRadio('Nutrition goal', 'Lose fat');
    await pressText('Calculate estimate');
    expect(input('Carbohydrates (g) (Estimate)').props.value).toBe('0');
    expect(has(en.goals.limits.carbs_zero)).toBe(true);
  });
  it('a calorie need above what can be stored shows the conflict and fills nothing', async () => {
    await details('Male', '10', '250', '500', 'Extremely active');
    await pressText('Calculate estimate');
    expect(has(en.goals.calorieConflict)).toBe(true);
    expect(input('Calories (kcal)').props.value).toBe('');
    expect(count('Estimate')).toBe(0);
  });
  it('an ordinary estimate shows no limit notes', async () => {
    await fillDetails();
    await pressText('Calculate estimate');
    for (const msg of Object.values(en.goals.limits)) expect(has(msg)).toBe(false);
    expect(has(en.goals.floorNote)).toBe(false);
  });
});

describe('R3: provenance labels in the screen', () => {
  it('water keeps "Preliminary estimate" when other values are edited, and says "Edited" when it is edited itself', async () => {
    await mount({ status: 'ready', repos: env.repos });
    await fillDetails();
    await pressText('Calculate estimate');
    await type('Calories (kcal) (Estimate)', '2500');
    await type('Protein (g) (Estimate)', '150');
    expect(input(WATER).props.value).toBe('2800'); // still found by its Preliminary estimate label
    expect(count('Edited')).toBe(2);
    await type(WATER, '3000');
    expect(input('Water (ml) (Preliminary estimate, Edited)').props.value).toBe('3000');
    expect(count('Estimate')).toBe(2); // only carbohydrates and fat are still plain estimates
  });
  it('reopened manual goals still label water as preliminary and the other values as the user\'s own', async () => {
    await env.repos.goals.save({ goalType: 'maintain', kcalTarget: 2000, waterMlTarget: 2100, weeklyWorkoutTarget: 3, source: 'manual' });
    await mount({ status: 'ready', repos: env.repos });
    expect(input(WATER).props.value).toBe('2100');
    expect(input('Calories (kcal)').props.value).toBe('2000');
    expect(count('Estimate')).toBe(0);
  });
});

describe('R6: the form asks the shared Screen for keyboard avoidance', () => {
  it('while loading and when loaded', async () => {
    mockScreenProps.length = 0;
    await mount({ status: 'loading' });
    expect(mockScreenProps.length).toBeGreaterThan(0);
    expect(mockScreenProps.every((p) => p.avoidKeyboard === true)).toBe(true);
    mockScreenProps.length = 0;
    act(() => tree.unmount());
    await mount({ status: 'ready', repos: env.repos });
    expect(mockScreenProps.length).toBeGreaterThan(0);
    expect(mockScreenProps.every((p) => p.avoidKeyboard === true)).toBe(true);
  });
});

const style = (node: any) => StyleSheet.flatten(node.props.style) ?? {};

describe('R1 in the screen: ambiguous numbers are explained, not guessed', () => {
  beforeEach(async () => mount({ status: 'ready', repos: env.repos }));

  it('"1,500" for the weight shows the explanation, links it to the field for screen readers, and calculates nothing', async () => {
    await fillDetails();
    await type('Weight (kg)', '1,500');
    await pressText('Calculate estimate');
    expect(has(en.validation.ambiguousNumber)).toBe(true);
    expect(input('Weight (kg)').props.accessibilityHint).toBe(en.validation.ambiguousNumber);
    expect(input('Weight (kg)').props.value).toBe('1,500'); // what was typed is left as typed
    expect(input('Calories (kcal)').props.value).toBe('');
  });
  it('"2,500" calories cannot be saved; "2500" can', async () => {
    await type('Calories (kcal)', '2,500');
    await type(WATER, '2500');
    await pressRadio('Workouts per week', '3');
    await pressText(en.goals.save);
    expect(has(en.validation.ambiguousNumber)).toBe(true);
    expect(await env.repos.goals.get()).toEqual({ ok: true, value: null });
    await type('Calories (kcal)', '2500');
    await pressText(en.goals.save);
    const row = await env.repos.goals.get();
    expect(row.ok && row.value).toMatchObject({ kcalTarget: 2500, waterMlTarget: 2500 });
  });
});

describe('R2 in the screen: stored age and weight must be fresh', () => {
  const seed = async (ageSetOn: string | null, weightDate: string) => {
    await env.repos.profile.save({ displayName: 'Sam', sex: 'female', ageYears: 28, heightCm: 165, activityLevel: 'light' });
    await env.db.run('UPDATE profile SET age_set_on=? WHERE id=1', [ageSetOn]);
    await env.repos.weight.save({ weightKg: 61.5, localDate: weightDate });
  };

  it('fresh values prefill and no note is shown', async () => {
    await seed('2026-10-01', '2026-10-15');
    await mount({ status: 'ready', repos: env.repos });
    expect(input('Age (years)').props.value).toBe('28');
    expect(input('Weight (kg)').props.value).toBe('61.5');
    expect(allText().some((t: string) => t.includes('was not filled in'))).toBe(false);
  });
  it('an old age and weight are not filled in; the notes say what was stored and when', async () => {
    await seed('2025-01-02', '2026-01-05');
    await mount({ status: 'ready', repos: env.repos });
    expect(input('Age (years)').props.value).toBe('');
    expect(input('Weight (kg)').props.value).toBe('');
    expect(has('Your saved age (28) was entered on 2025-01-02, more than a year ago')).toBe(true);
    expect(has('Your last saved weight (61.5 kg) is from 2026-01-05, more than 30 days ago')).toBe(true);
    expect(input('Height (cm)').props.value).toBe('165'); // not date-limited
    await fillDetailsKeepingSaved();
    await pressText('Calculate estimate');
    expect(has(en.validation.required)).toBe(true); // age and weight are still missing: nothing was silently reused
  });
  it('an age and weight carried over from the old profile have NO date: they are not filled in, and the notes say so', async () => {
    await env.repos.profile.save({ displayName: 'Sam', ageYears: 28, heightCm: 165, activityLevel: 'light' });
    await env.db.run('UPDATE profile SET age_set_on=NULL, undated_weight_kg=61.5 WHERE id=1');
    await mount({ status: 'ready', repos: env.repos });
    expect(input('Age (years)').props.value).toBe('');
    expect(input('Weight (kg)').props.value).toBe('');
    expect(input('Height (cm)').props.value).toBe('165');
    expect(has('Your saved age (28) has no entry date')).toBe(true);
    expect(has('Your last saved weight (61.5 kg) has no valid date')).toBe(true);
    await pressRadio('Sex', 'Male');
    await pressText('Calculate estimate');
    expect(has(en.validation.required)).toBe(true); // nothing was silently reused
    expect(input('Calories (kcal)').props.value).toBe('');
  });
  it('a dated weight entry is used even when an undated one is also stored', async () => {
    await env.repos.profile.save({ displayName: 'Sam' });
    await env.db.run('UPDATE profile SET undated_weight_kg=61.5 WHERE id=1');
    await env.repos.weight.save({ weightKg: 70, localDate: '2026-10-15' });
    await mount({ status: 'ready', repos: env.repos });
    expect(input('Weight (kg)').props.value).toBe('70');
    expect(has('has no valid date')).toBe(false);
  });
  it('typing into the field removes its note', async () => {
    await seed('2025-01-02', '2026-10-15');
    await mount({ status: 'ready', repos: env.repos });
    expect(has('more than a year ago')).toBe(true);
    await type('Age (years)', '30');
    expect(has('more than a year ago')).toBe(false);
  });
  it('the same data is fresh or old depending on today\'s date', async () => {
    await seed('2026-10-01', '2026-10-15');
    mockToday = '2027-11-20';
    await mount({ status: 'ready', repos: env.repos });
    expect(input('Age (years)').props.value).toBe('');
    expect(input('Weight (kg)').props.value).toBe('');
  });
});
const fillDetailsKeepingSaved = async () => {
  await pressRadio('Sex', 'Male');
  await pressRadio('Activity level', 'Moderately active');
};

describe('R4 in the screen: every stored weekly target is selectable', () => {
  it('offers 0 to 14', async () => {
    await mount({ status: 'ready', repos: env.repos });
    const group = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radiogroup' && n.props.accessibilityLabel === 'Workouts per week')[0];
    const labels = group.findAll((n: any) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function').map(textOf);
    expect(labels).toEqual(Array.from({ length: 15 }, (_, i) => String(i)));
  });
  it('a stored target of 10 reopens selected, and 14 can be chosen and saved', async () => {
    await env.repos.goals.save({ goalType: 'maintain', waterMlTarget: 2000, weeklyWorkoutTarget: 10, source: 'manual' });
    await mount({ status: 'ready', repos: env.repos });
    const ten = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && textOf(n) === '10')[0];
    expect(ten.props.accessibilityState.checked).toBe(true);
    await pressRadio('Workouts per week', '14');
    await pressText(en.goals.save);
    const row = await env.repos.goals.get();
    expect(row.ok && row.value).toMatchObject({ weeklyWorkoutTarget: 14 });
  });
});

describe('accessibility', () => {
  beforeEach(async () => mount({ status: 'ready', repos: env.repos }));

  it('every radio option, button and text input is at least 44 x 44 points', () => {
    const radios = tree.root.findAll((n: any) => n.props.accessibilityRole === 'radio' && typeof n.props.onPress === 'function');
    expect(radios).toHaveLength(2 + 5 + 3 + 15); // sex, activity level, goal type, weekly target
    for (const r of radios) {
      expect(style(r).minHeight).toBeGreaterThanOrEqual(44);
      expect(style(r).minWidth).toBeGreaterThanOrEqual(44);
    }
    const buttons = tree.root.findAll((n: any) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function');
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) expect(style(b).minHeight).toBeGreaterThanOrEqual(44);
    const inputs = tree.root.findAll((n: any) => typeof n.props.onChangeText === 'function' && n.props.accessibilityLabel);
    for (const i of inputs) expect(style(i).minHeight).toBeGreaterThanOrEqual(44);
  });
  it('card titles are headings', () => {
    const headings = tree.root.findAll((n: any) => n.props.accessibilityRole === 'header').map(textOf);
    expect(headings).toEqual(expect.arrayContaining([en.goals.detailsTitle, en.goals.goalTitle, en.goals.targetsTitle, en.goals.weeklyTitle]));
  });
  it('status is announced once through the screen reader; Android live regions are not used (they would double the speech)', async () => {
    expect(announced).toEqual([en.goals.loading, en.goals.a11y.loaded]); // exactly once each
    expect(tree.root.findAll((n: any) => n.props.accessibilityLiveRegion !== undefined)).toHaveLength(0);
  });
  it('loading is announced, then "loaded"', async () => {
    act(() => tree.unmount());
    announced.length = 0;
    await mount({ status: 'loading' });
    expect(announced).toEqual([en.goals.loading]);
    expect(tree.root.findAll((n: any) => n.props.accessibilityLiveRegion !== undefined)).toHaveLength(0); // the loading view too
    announced.length = 0;
    mockDb = { state: { status: 'ready', repos: env.repos }, retry: jest.fn() };
    await act(async () => { tree.update(<GoalsScreen />); }); await flush();
    expect(announced).toEqual([en.goals.a11y.loaded]);
  });
  it('a failed calculation announces which fields need attention; a good one announces the result', async () => {
    announced.length = 0;
    await pressText('Calculate estimate');
    expect(announced).toEqual([`Please check: ${['Sex', 'Age (years)', 'Height (cm)', 'Weight (kg)', 'Activity level'].join(', ')}.`]);
    announced.length = 0;
    await fillDetails();
    await pressText('Calculate estimate');
    expect(announced).toEqual([en.goals.a11y.calculated]);
  });
  it('the calorie conflict is announced with its explanation', async () => {
    await pressRadio('Sex', 'Male');
    await type('Age (years)', '10');
    await type('Height (cm)', '250');
    await type('Weight (kg)', '500');
    await pressRadio('Activity level', 'Extremely active');
    announced.length = 0;
    await pressText('Calculate estimate');
    expect(announced).toEqual([en.goals.calorieConflict]);
  });
  it('field errors are available to screen readers as the input\'s hint', async () => {
    await pressText('Calculate estimate');
    expect(input('Age (years)').props.accessibilityHint).toBe(en.validation.required);
    await type('Age (years)', '30');
    expect(input('Age (years)').props.accessibilityHint).toBeUndefined();
  });
  it('save: validation problems, success and failure are announced', async () => {
    announced.length = 0;
    await pressText(en.goals.save);
    expect(announced).toEqual([`Please check: ${['Water', 'Workouts per week'].join(', ')}.`]);
    await type(WATER, '2500');
    await pressRadio('Workouts per week', '3');
    announced.length = 0;
    await pressText(en.goals.save);
    expect(announced).toEqual([en.goals.saved]);
    expect(has(en.goals.saved)).toBe(true);
    expect(tree.root.findAll((n: any) => n.props.accessibilityLiveRegion !== undefined)).toHaveLength(0); // the saved-status row too
  });
  it('a failed save announces the reason', async () => {
    act(() => tree.unmount());
    const failing = { ...env.repos, goals: { ...env.repos.goals, save: async () => ({ ok: false as const, error: { kind: 'busy' as const, message: 'x' } }) } };
    await mount({ status: 'ready', repos: failing });
    await type(WATER, '2500');
    await pressRadio('Workouts per week', '3');
    announced.length = 0;
    await pressText(en.goals.save);
    expect(announced).toEqual([en.errors.busy]);
    expect(has(en.errors.busy)).toBe(true);
  });
  it('an estimate becoming outdated is announced once, not on every keystroke', async () => {
    await fillDetails();
    await pressText('Calculate estimate');
    announced.length = 0;
    await type('Weight (kg)', '81');
    await type('Weight (kg)', '82');
    expect(announced).toEqual([en.goals.stale]);
  });
  it('a failed load is announced', async () => {
    act(() => tree.unmount());
    announced.length = 0;
    const failing = { ...env.repos, goals: { ...env.repos.goals, get: async () => ({ ok: false as const, error: { kind: 'busy' as const, message: 'x' } }) } };
    await mount({ status: 'ready', repos: failing });
    expect(announced).toContain(en.goals.loadFailed);
  });
});
