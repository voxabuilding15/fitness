import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { useDatabase } from '../context/DatabaseContext';
import { useProfile } from '../context/ProfileContext';
import { errorMessageKey } from '../domain/errors';
import { formFromSnapshot, planProfileSave, profileView, type ProfileForm, type ProfileFormStart, type ProfileIssues } from '../domain/profileDraft';
import { announce } from '../services/accessibility';
import { playSound } from '../services/soundService';
import { colors, radius } from '../theme';
import type { CautionArea, ExperienceLevel, Language } from '../types/settings';

const LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced'];
const AREAS: CautionArea[] = ['neck', 'shoulders', 'lowerBack', 'knees', 'wrists', 'ankles'];
const LANGS: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'ar', label: 'العربية' },
];

type Panel = 'experience' | 'caution' | 'language' | null;

const NO_HINTS = { age: null, weight: null };

export default function ProfileScreen() {
  const { t } = useTranslation();
  // The database is the single source of truth. The old AsyncStorage profile (`useApp().profile`) is neither shown nor written here:
  // it may be the built-in demonstration profile, which must never be presented as the person's own.
  const { settings, updateSettings, setLanguage } = useApp();
  const { state: db, retry } = useDatabase();
  const { state, reload, save: saveProfile } = useProfile();
  const scrollRef = useRef<ScrollView>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileForm>({ name: '', location: '', age: '', height: '', weight: '' });
  const [start, setStart] = useState<ProfileFormStart | null>(null);
  const [errors, setErrors] = useState<ProfileIssues>({});
  const [saved, setSaved] = useState<'ok' | 'partial' | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);

  const snapshot = state.status === 'ready' ? state.data : null;
  // editing is offered only when the stored profile was read successfully - never over a failed read
  const canEdit = state.status === 'ready' && state.data !== null && state.loadError === null;
  const view = snapshot ? profileView(snapshot) : null;

  const startEdit = () => {
    if (!snapshot || !canEdit) return;
    const s = formFromSnapshot(snapshot);
    setStart(s);
    setForm(s.form);
    setErrors({});
    setSaved(null);
    setSaveError(null);
    setEditing(true);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  };
  const cancel = () => {
    setEditing(false);
    setErrors({});
  };
  const save = async () => {
    if (!snapshot || !start || !canEdit || saving) return;
    const plan = planProfileSave(form, start.form, snapshot);
    if (!plan.ok) {
      const found = plan.error.kind === 'validation' ? (plan.error.issues as ProfileIssues) : {};
      setErrors(found);
      const labels = (['name', 'location', 'age', 'height', 'weight'] as const).filter((k) => found[k]).map((k) => t(`profile.${k}`));
      if (labels.length) announce(t('goals.a11y.needsAttention', { fields: labels.join(', ') }));
      return;
    }
    setErrors({});
    setSaving(true);
    setSaveError(null);
    const r = await saveProfile(plan.value);
    setSaving(false);
    if (r.ok) {
      playSound('success');
      setEditing(false);
      setSaved('ok');
      announce(t('profile.saved'));
    } else {
      // profile saved but the weight was not: the form closes (the profile IS saved) and says what is missing
      if (r.profileSaved) {
        setEditing(false);
        setSaved('partial');
      }
      setSaveError(t(errorMessageKey(r.error)));
      announce(`${r.profileSaved ? t('profile.savedPartial') : ''} ${t(errorMessageKey(r.error))}`.trim());
    }
  };
  const toggleArea = (a: CautionArea) => {
    const has = settings.cautionAreas.includes(a);
    updateSettings({ cautionAreas: has ? settings.cautionAreas.filter((x) => x !== a) : [...settings.cautionAreas, a] });
  };
  const togglePanel = (p: Exclude<Panel, null>) => setPanel((cur) => (cur === p ? null : p));

  const cautionSummary = settings.cautionAreas.length
    ? settings.cautionAreas.map((a) => t(`profile.areas.${a}`)).join(', ')
    : t('profile.none');

  const legacyError = db.status === 'ready' ? db.legacyError : null;

  // Status changes are spoken once through the screen reader (the text stays on screen too). Entering an already-settled
  // state (for example opening the tab after the profile loaded) says nothing.
  const status = state.status === 'ready' ? (state.loadError ? 'load_failed' : 'ready') : state.status;
  const previousStatus = useRef<string | null>(null);
  const unavailableText = state.status === 'unavailable' ? `${t(errorMessageKey(state.error))} ${t('profile.unavailableNote')}` : '';
  useEffect(() => {
    const before = previousStatus.current;
    if (before === status) return;
    previousStatus.current = status;
    if (status === 'loading') announce(t('profile.loading'));
    else if (status === 'unavailable') announce(unavailableText);
    else if (status === 'load_failed') announce(t('profile.loadFailed'));
    else if (before === 'loading') announce(t('profile.a11y.loaded'));
  }, [status, unavailableText, t]);
  const hasLegacyError = legacyError !== null;
  useEffect(() => {
    if (hasLegacyError) announce(t('profile.legacyUnreadable'));
  }, [hasLegacyError, t]);

  return (
    <Screen scrollRef={scrollRef} avoidKeyboard>
      <AppHeader
        title={t('profile.title')}
        right={canEdit ? { icon: editing ? 'close' : 'create-outline', label: editing ? t('common.cancel') : t('profile.editProfile'), onPress: editing ? cancel : startEdit } : undefined}
      />

      {view ? (
        <ProfileSummaryCard
          view={view}
          editing={editing}
          form={form}
          errors={errors}
          hints={start?.hints ?? NO_HINTS}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />
      ) : state.status === 'loading' ? (
        <GlassCard strong style={styles.statusCard}>
          <View style={styles.row}>
            <ActivityIndicator color={colors.dark} />
            <AppText size={13} color={colors.ink}>{t('profile.loading')}</AppText>
          </View>
        </GlassCard>
      ) : state.status === 'ready' ? (
        <GlassCard strong style={styles.statusCard}>
          <AppText size={13} color={colors.ink}>{t('profile.loadFailed')}</AppText>
          <Pressable accessibilityRole="button" onPress={() => void reload()} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('profile.reload')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null /* unavailable: the status card below is the whole state - no profile data, demo or otherwise, is shown */}

      {state.status === 'ready' && state.loadError && view ? (
        <GlassCard strong style={styles.statusCard}>
          <AppText size={13} color={colors.ink}>{t('profile.loadFailed')}</AppText>
          <Pressable accessibilityRole="button" onPress={() => void reload()} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('profile.reload')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}
      {state.status === 'unavailable' ? (
        <GlassCard strong style={styles.statusCard}>
          <View style={styles.row}>
            <Icon name="information-circle-outline" size={18} color={colors.danger} />
            <AppText size={12} color={colors.ink} style={styles.flex}>{unavailableText}</AppText>
          </View>
          <Pressable accessibilityRole="button" onPress={retry} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('goals.retry')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}
      {legacyError ? <AppText size={11} color={colors.onGradientMuted}>{t('profile.legacyUnreadable')}</AppText> : null}

      {editing ? (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={cancel} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('common.cancel')}</AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: saving }}
            disabled={saving}
            onPress={save}
            style={[styles.btn, styles.btnPrimary, saving && styles.dim]}
          >
            <AppText size={14} weight="medium" color={colors.white} align="center">{t('common.save')}</AppText>
          </Pressable>
        </View>
      ) : saved ? (
        <View style={styles.savedRow}>
          <Icon name="checkmark-circle" size={16} color={colors.white} />
          <AppText size={12} color={colors.white}>{t(saved === 'ok' ? 'profile.saved' : 'profile.savedPartial')}</AppText>
        </View>
      ) : null}
      {saveError ? <AppText size={12} color={colors.white}>{saveError}</AppText> : null}

      <AppText size={17} weight="medium" color={colors.onGradient}>{t('profile.accountSettings')}</AppText>
      <GlassCard style={styles.group}>
        {canEdit ? <SettingRow icon="person-outline" label={t('profile.personalInfo')} onPress={startEdit} /> : null}
        <SettingRow icon="flag-outline" label={t('profile.goalsRow')} onPress={() => router.push('/goals')} />
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
  statusCard: { padding: 14, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  dim: { opacity: 0.5 },
  btn: { flex: 1, minHeight: 46, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
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
