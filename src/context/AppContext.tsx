import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import i18n, { isRtlLanguage } from '../i18n';
import { DEMO_PROFILE, loadProfile, saveProfile } from '../services/profileService';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../services/settingsService';
import { setSoundEnabled } from '../services/soundService';
import type { Profile } from '../types/profile';
import type { AppSettings, Language } from '../types/settings';

interface AppContextValue {
  ready: boolean;
  profile: Profile;
  settings: AppSettings;
  isRTL: boolean;
  updateProfile: (p: Profile) => Promise<boolean>;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setLanguage: (lng: Language) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile>(DEMO_PROFILE);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    (async () => {
      const [p, s] = await Promise.all([loadProfile(), loadSettings()]);
      setProfile(p);
      setSettings(s);
      setSoundEnabled(s.soundEnabled);
      await i18n.changeLanguage(s.language);
      setReady(true);
    })();
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settings, ...patch };
      setSettings(next);
      if (patch.soundEnabled !== undefined) setSoundEnabled(patch.soundEnabled);
      await saveSettings(next);
    },
    [settings],
  );

  const setLanguage = useCallback(
    async (lng: Language) => {
      await i18n.changeLanguage(lng);
      await updateSettings({ language: lng });
    },
    [updateSettings],
  );

  const updateProfile = useCallback(async (p: Profile) => {
    setProfile(p);
    return saveProfile(p);
  }, []);

  const value = useMemo(
    () => ({
      ready,
      profile,
      settings,
      isRTL: isRtlLanguage(settings.language),
      updateProfile,
      updateSettings,
      setLanguage,
    }),
    [ready, profile, settings, updateProfile, updateSettings, setLanguage],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
