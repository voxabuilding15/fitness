import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppError } from '../domain/errors';
import type { Profile } from '../domain/models';
import { deviceLocalDate } from '../domain/dates';
import type { ProfileSavePlan } from '../domain/profileDraft';
import type { Repositories } from '../domain/repositories';
import { useDatabase } from './DatabaseContext';

export interface ProfileData {
  profile: Profile | null;
  latestWeight: { weightKg: number; localDate: string } | null;
  /** The device's local date when this was read; how old a stored value is, is measured against it. */
  today: string;
}

export type ProfileState =
  | { status: 'loading' }
  | { status: 'unavailable'; error: AppError }
  /** `data` is null only when the very first read failed: the screen then offers a reload and must not offer editing. */
  | { status: 'ready'; data: ProfileData | null; loadError: AppError | null };

export type SaveOutcome = { ok: true } | { ok: false; error: AppError; profileSaved: boolean };

interface ProfileContextValue {
  state: ProfileState;
  reload: () => Promise<void>;
  /** Writes the profile, then (only if it changed) logs the new weight for today. Reloads afterwards, success or not. */
  save: (plan: ProfileSavePlan) => Promise<SaveOutcome>;
}

const NOT_READY: ProfileContextValue = { state: { status: 'loading' }, reload: async () => undefined, save: async () => ({ ok: false, error: { kind: 'unavailable', reason: 'not_ready' }, profileSaved: false }) };
const ProfileContext = createContext<ProfileContextValue>(NOT_READY);

async function fetchProfileData(repos: Repositories): Promise<{ data: ProfileData } | { error: AppError }> {
  const [profile, weight] = await Promise.all([repos.profile.get(), repos.weight.latest()]);
  if (!profile.ok) return { error: profile.error };
  if (!weight.ok) return { error: weight.error };
  return {
    data: {
      profile: profile.value,
      latestWeight: weight.value ? { weightKg: weight.value.weightKg, localDate: weight.value.localDate } : null,
      today: deviceLocalDate(Date.now()),
    },
  };
}

/**
 * The person's profile as stored in the database (the single source of truth since milestone 3; the old AsyncStorage
 * copy is only read, once, by the import and is never changed or deleted). Shared by the Profile tab and the Home greeting
 * so a saved name shows everywhere at once.
 */
export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { state: db } = useDatabase();
  const repos = db.status === 'ready' ? db.repos : null;
  const [data, setData] = useState<ProfileData | null>(null);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [loaded, setLoaded] = useState(false);

  const apply = useCallback((r: { data: ProfileData } | { error: AppError }) => {
    if ('error' in r) setLoadError(r.error);
    else {
      setLoadError(null);
      setData(r.data);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!repos) return;
    let cancelled = false;
    (async () => {
      const r = await fetchProfileData(repos);
      if (!cancelled) apply(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [repos, apply]);

  const reload = useCallback(async () => {
    if (repos) apply(await fetchProfileData(repos));
  }, [repos, apply]);

  const save = useCallback(
    async (plan: ProfileSavePlan): Promise<SaveOutcome> => {
      if (!repos) return { ok: false, error: { kind: 'unavailable', reason: 'database_unavailable' }, profileSaved: false };
      let profileSaved = false;
      let outcome: SaveOutcome = { ok: true };
      const p = await repos.profile.save(plan.profile);
      if (!p.ok) outcome = { ok: false, error: p.error, profileSaved: false };
      else {
        profileSaved = true;
        if (plan.weightKg !== null) {
          const w = await repos.weight.save({ weightKg: plan.weightKg });
          if (!w.ok) outcome = { ok: false, error: w.error, profileSaved };
        }
      }
      await reload();
      return outcome;
    },
    [repos, reload],
  );

  const value = useMemo<ProfileContextValue>(() => {
    const state: ProfileState =
      db.status === 'unavailable' ? { status: 'unavailable', error: db.error } : db.status === 'loading' || !loaded ? { status: 'loading' } : { status: 'ready', data, loadError };
    return { state, reload, save };
  }, [db, loaded, data, loadError, reload, save]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export const useProfile = () => useContext(ProfileContext);

/**
 * The name for greetings: the stored display name, or `null` when there is none - no profile yet, still loading, or the
 * database unavailable. No name is ever invented (the built-in demonstration profile is never used).
 */
export function useProfileName(): string | null {
  const { state } = useProfile();
  return state.status === 'ready' ? (state.data?.profile?.displayName ?? null) : null;
}
