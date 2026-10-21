import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { ProfileSummaryCard } from '../components/ProfileSummaryCard';
import { Screen } from '../components/Screen';
import { SettingRow } from '../components/SettingRow';
import { useApp } from '../context/AppContext';
import { toDraft, validateDraft } from '../services/profileService';
import { playSound } from '../services/soundService';
import { colors, radius } from '../theme';
import type { ProfileDraft, ProfileErrors } from '../types/profile';
import type { CautionArea, ExperienceLevel, Language } from '../types/settings';

const LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced'];
const AREAS: CautionArea[] = ['neck', 'shoulders', 'lowerBack', 'knees', 'wrists', 'ankles'];
const LANGS: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
];

type Panel = 'experience' | 'caution' | 'language' | null;

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { profile, settings, updateProfile, updateSettings, setLanguage } = useApp();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft>(toDraft(profile));
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saved, setSaved] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);

  const startEdit = () => {
    setDraft(toDraft(profile));
    setErrors({});
    setSaved(false);
    setEditing(true);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };
  const cancel = () => {
    setEditing(false);
    setErrors({});
  };
  const save = async () => {
    const result = validateDraft(draft);
    setErrors(result.errors);
    if (!result.profile) return;
    await updateProfile(result.profile);
    playSound('success');
    setEditing(false);
    setSaved(true);
  };
  const toggleArea = (a: CautionArea) => {
    const has = settings.cautionAreas.includes(a);
    updateSettings({ cautionAreas: has ? settings.cautionAreas.filter((x) => x !== a) : [...settings.cautionAreas, a] });
  };
  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  const cautionSummary = settings.cautionAreas.length
    ? settings.cautionAreas.map((a) => t(`profile.areas.${a}`)).join(', ')
    : t('profile.none');

  return (
    <Screen scrollRef={scrollRef}>
      <AppHeader
        title={t('profile.title')}
        right={{ icon: editing ? 'close' : 'create-outline', label: editing ? t('common.cancel') : t('profile.editProfile'), onPress: editing ? cancel : startEdit }}
      />

      <ProfileSummaryCard
        profile={profile}
        editing={editing}
        draft={draft}
        errors={errors}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />

      {editing ? (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={cancel} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('common.cancel')}</AppText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={save} style={[styles.btn, styles.btnPrimary]}>
            <AppText size={14} weight="medium" color={colors.white} align="center">{t('common.save')}</AppText>
          </Pressable>
        </View>
      ) : saved ? (
        <View style={styles.savedRow}>
          <Icon name="checkmark-circle" size={16} color={colors.white} />
          <AppText size={12} color={colors.white}>{t('profile.saved')}</AppText>
        </View>
      ) : null}

      <AppText size={17} weight="medium" color={colors.onGradient}>{t('profile.accountSettings')}</AppText>
      <GlassCard style={styles.group}>
        <SettingRow icon="person-outline" label={t('profile.personalInfo')} onPress={startEdit} />
        <SettingRow icon="list-outline" label={t('profile.reminder')} onPress={() => router.push('/reminders')} />
        <SettingRow
          icon="volume-medium-outline"
          label={t('profile.sound')}
          toggle={{
            value: settings.soundEnabled,
            onChange: (v) => {
              updateSettings({ soundEnabled: v });
              if (v) playSound('tap');
            },
          }}
        />
      </GlassCard>

      <AppText size={17} weight="medium" color={colors.onGradient}>{t('profile.preferences')}</AppText>
      <GlassCard style={styles.group}>
        <SettingRow
          icon="fitness-outline"
          label={t('profile.experience')}
          value={t(`profile.levels.${settings.experience}`)}
          expanded={panel === 'experience'}
          onPress={() => togglePanel('experience')}
        />
        {panel === 'experience' ? (
          <View style={styles.panel} accessibilityRole="radiogroup">
            {LEVELS.map((l) => {
              const active = settings.experience === l;
              return (
                <Pressable
                  key={l}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => {
                    playSound('tap');
                    updateSettings({ experience: l });
                  }}
                  style={[styles.option, active && styles.optionActive]}
                >
                  <AppText size={13} weight={active ? 'semibold' : 'regular'} color={active ? colors.white : colors.ink}>
                    {t(`profile.levels.${l}`)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <SettingRow
          icon="warning-outline"
          label={t('profile.caution')}
          value={cautionSummary}
          expanded={panel === 'caution'}
          onPress={() => togglePanel('caution')}
        />
        {panel === 'caution' ? (
          <View style={styles.panel}>
            <View style={styles.chips}>
              {AREAS.map((a) => {
                const active = settings.cautionAreas.includes(a);
                return (
                  <Pressable
                    key={a}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    onPress={() => {
                      playSound('tap');
                      toggleArea(a);
                    }}
                    style={[styles.chip, active && styles.optionActive]}
                  >
                    <AppText size={12} weight={active ? 'semibold' : 'regular'} color={active ? colors.white : colors.ink}>
                      {t(`profile.areas.${a}`)}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            <AppText size={11} color={colors.muted}>{t('profile.cautionNote')}</AppText>
          </View>
        ) : null}

        <SettingRow
          icon="language-outline"
          label={t('profile.language')}
          value={LANGS.find((l) => l.id === settings.language)?.label}
          expanded={panel === 'language'}
          onPress={() => togglePanel('language')}
        />
        {panel === 'language' ? (
          <View style={[styles.panel, styles.langRow]} accessibilityRole="radiogroup">
            {LANGS.map((l) => {
              const active = settings.language === l.id;
              return (
                <Pressable
                  key={l.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  onPress={() => {
                    playSound('tap');
                    setLanguage(l.id);
                  }}
                  style={[styles.option, styles.langOption, active && styles.optionActive]}
                >
                  <AppText size={14} weight={active ? 'semibold' : 'regular'} color={active ? colors.white : colors.ink} align="center">
                    {l.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </GlassCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, height: 46, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.75)' },
  btnPrimary: { backgroundColor: colors.dark },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  group: { padding: 8, gap: 8, borderRadius: radius.lg },
  panel: { paddingHorizontal: 12, paddingBottom: 6, gap: 8 },
  option: { paddingVertical: 11, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.75)' },
  optionActive: { backgroundColor: colors.dark },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.75)' },
  langRow: { flexDirection: 'row' },
  langOption: { flex: 1 },
});
