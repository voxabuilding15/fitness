import type { AppSettings } from '../types/settings';
import { readJson, writeJson } from './storage';

const KEY = 'fitness.settings.v1';

export const DEFAULT_SETTINGS: AppSettings = {
  language: 'en',
  soundEnabled: true,
  experience: 'intermediate',
  cautionAreas: [],
  reminders: { enabled: false, hour: 18, minute: 0, days: [1, 2, 3, 4, 5] },
};

export async function loadSettings(): Promise<AppSettings> {
  const stored = await readJson<AppSettings>(KEY, DEFAULT_SETTINGS);
  // reminders is a nested object, so merge it explicitly
  return { ...stored, reminders: { ...DEFAULT_SETTINGS.reminders, ...stored.reminders } };
}
export const saveSettings = (s: AppSettings) => writeJson(KEY, s);
