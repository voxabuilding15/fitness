/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dependency) */
/**
 * The Home greeting. Rendered with the real ProfileProvider and real repositories on Node SQLite; layout is not tested.
 */
import React from 'react';
import { createRepoEnv, unwrap, type RepoEnv } from '../../db/testing/repoEnv';
import en from '../../locales/en.json';
import HomeScreen from '../../screens/HomeScreen';
import { ProfileProvider } from '../../context/ProfileContext';

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

let mockDb: { state: unknown; retry: jest.Mock };
jest.mock('react-i18next', () => {
  const messages = require('../../locales/en.json');
  const t = (key: string, options?: Record<string, string>) => {
    const text: string = key.split('.').reduce((o: any, p) => (o == null ? undefined : o[p]), messages) ?? key;
    return text.replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
  };
  const value = { t, i18n: { language: 'en' } };
  return { useTranslation: () => value };
});
jest.mock('../../context/AppContext', () => ({
  useApp: () => ({
    isRTL: false,
    // the built-in demonstration profile
    profile: { name: 'Jacob Donald', location: 'London, United Kingdom', age: 27, heightCm: 170, weightKg: 52 },
    settings: { cautionAreas: [], experience: 'beginner', language: 'en', soundEnabled: true, reminders: { enabled: false } },
  }),
}));
jest.mock('../../context/DatabaseContext', () => ({ useDatabase: () => mockDb }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
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

beforeEach(async () => { env = await createRepoEnv(); });
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
