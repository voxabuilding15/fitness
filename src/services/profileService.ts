import type { Profile, ProfileDraft, ProfileErrors } from '../types/profile';
import { readJson, writeJson } from './storage';

const KEY = 'fitness.profile.v1';

/** Demonstration profile shown until the user edits and saves their own data. */
export const DEMO_PROFILE: Profile = {
  name: 'Jacob Donald',
  location: 'London, United Kingdom',
  age: 27,
  heightCm: 170,
  weightKg: 52,
};

export const loadProfile = () => readJson<Profile>(KEY, DEMO_PROFILE);
export const saveProfile = (profile: Profile) => writeJson(KEY, profile);

export const toDraft = (p: Profile): ProfileDraft => ({
  name: p.name,
  location: p.location,
  age: String(p.age),
  height: String(p.heightCm),
  weight: String(p.weightKg),
});

const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
const toNumber = (s: string) => (s.trim() === '' ? NaN : Number(s.replace(',', '.')));

export function validateDraft(d: ProfileDraft): { errors: ProfileErrors; profile?: Profile } {
  const errors: ProfileErrors = {};
  const name = d.name.trim();
  const location = d.location.trim();
  const age = toNumber(d.age);
  const height = toNumber(d.height);
  const weight = toNumber(d.weight);

  if (!name) errors.name = 'validation.nameRequired';
  else if (name.length > 40) errors.name = 'validation.nameTooLong';
  if (location.length > 60) errors.location = 'validation.locationTooLong';
  if (!Number.isInteger(age) || !inRange(age, 10, 100)) errors.age = 'validation.ageRange';
  if (!inRange(height, 100, 250)) errors.height = 'validation.heightRange';
  if (!inRange(weight, 30, 300)) errors.weight = 'validation.weightRange';

  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    profile: { name, location, age, heightCm: Math.round(height), weightKg: Math.round(weight * 10) / 10 },
  };
}
