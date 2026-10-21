import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { useApp } from '../context/AppContext';
import { useDatabase } from '../context/DatabaseContext';
import { deviceLocalDate } from '../domain/dates';
import { errorMessageKey, type AppError } from '../domain/errors';
import {
  applyEstimate, calculateEstimate, draftFromSaved, fieldBadges, mergePrefill, newDraft, saveSource, setInputs, setTarget, setWeeklyTarget, toGoalsInput,
  visibleHints, WEEKLY_TARGET_CHOICES, type Badge, type DraftIssues, type GoalsDraft, type SavedHint, type TargetField,
} from '../domain/goalsDraft';
import { ACTIVITY_LEVEL, GOAL_TYPE, SEX } from '../domain/schemas/enums';
import { announce } from '../services/accessibility';
import { playSound } from '../services/soundService';
import { colors, radius } from '../theme';


function Chips<T extends string | number>({ label, options, value, onChange, render, error }: {
  label: string; options: readonly T[]; value: T | null; onChange: (v: T) => void; render: (v: T) => string; error?: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.field}>
      <AppText size={12} color={colors.muted}>{label}</AppText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const active = value === o;
          return (
            <Pressable
              key={String(o)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => {
                playSound('tap');
                onChange(o);
              }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <AppText size={12} weight={active ? 'semibold' : 'regular'} color={active ? colors.white : colors.ink}>{render(o)}</AppText>
            </Pressable>
          );
        })}
      </View>
      {error ? <AppText size={11} color={colors.danger}>{t(error)}</AppText> : null}
    </View>
  );
}

function Field({ label, value, onChange, keyboardType, error, badges = [], note }: {
  label: string; value: string; onChange: (v: string) => void; keyboardType: KeyboardTypeOptions; error?: string; badges?: string[];
  /** Extra spoken context for screen readers (the visible text is rendered by the caller). */
  note?: string;
}) {
  const { t } = useTranslation();
  const { isRTL } = useApp();
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <AppText size={12} color={colors.muted} style={styles.flex}>{label}</AppText>
        {badges.map((b) => (
          <View key={b} style={styles.badge}>
            <AppText size={10} weight="medium" color={colors.dark}>{b}</AppText>
          </View>
        ))}
      </View>
      <TextInput
        accessibilityLabel={badges.length ? `${label} (${badges.join(', ')})` : label}
        accessibilityHint={error ? t(error) : note}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType}
        style={[styles.input, error ? styles.inputError : null, { textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr' }]}
        placeholderTextColor={colors.muted}
      />
      {error ? <AppText size={11} color={colors.danger}>{t(error)}</AppText> : null}
    </View>
  );
}

/** Top-to-bottom order of the form fields, used to announce problems in the order a person meets them. */
const SCREEN_ORDER = ['sex', 'age', 'heightCm', 'weightKg', 'activityLevel', 'goalType', 'adjustmentPct', 'kcal', 'proteinG', 'carbsG', 'fatG', 'water', 'weeklyWorkoutTarget'];

export default function GoalsScreen() {
  const { t } = useTranslation();
  const { state, retry } = useDatabase();
  const [draft, setDraft] = useState<GoalsDraft>(newDraft());
  const [dbLoaded, setDbLoaded] = useState(false);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [issues, setIssues] = useState<DraftIssues>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [saveError, setSaveError] = useState<AppError | null>(null);

  const ready = state.status === 'ready';
  const loaded = state.status === 'unavailable' || dbLoaded; // without a database there is nothing to wait for
  const repos = state.status === 'ready' ? state.repos : null;

  // Reads what the database already has (goals, profile, latest weight). Read only: nothing is created or imported here.
  useEffect(() => {
    if (!repos) return;
    let cancelled = false;
    (async () => {
      const [goals, profile, weight] = await Promise.all([repos.goals.get(), repos.profile.get(), repos.weight.latest()]);
      if (cancelled) return;
      const failed = [goals, profile, weight].find((r) => !r.ok);
      if (failed && !failed.ok) setLoadError(failed.error); // saving stays off until a load succeeds, so stored goals can't be replaced by an empty fallback
      else if (goals.ok && profile.ok && weight.ok) {
        setLoadError(null);
        const fromDb = draftFromSaved({
          goals: goals.value,
          profile: profile.value,
          latestWeight: weight.value ? { weightKg: weight.value.weightKg, localDate: weight.value.localDate } : null,
          today: deviceLocalDate(Date.now()),
        });
        setDraft((current) => mergePrefill(current, fromDb)); // only fields the user has not touched
      }
      setDbLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [repos, reloadKey]);

  // Status changes are spoken once through the screen reader (see services/accessibility.ts). The text stays on screen as well.
  const wasLoading = useRef(false);
  useEffect(() => {
    if (!loaded) {
      wasLoading.current = true;
      announce(t('goals.loading'));
    } else if (wasLoading.current) {
      wasLoading.current = false;
      announce(t('goals.a11y.loaded'));
    }
  }, [loaded, t]);
  useEffect(() => {
    if (loadError) announce(t('goals.loadFailed'));
  }, [loadError, t]);
  const wasStale = useRef(false);
  useEffect(() => {
    if (draft.stale && !wasStale.current) announce(t('goals.stale'));
    wasStale.current = draft.stale;
  }, [draft.stale, t]);

  const issueLabel = (key: string) =>
    ({
      sex: t('goals.sex'), age: t('goals.age'), heightCm: t('goals.height'), weightKg: t('goals.weight'), activityLevel: t('goals.activity'),
      goalType: t('goals.goalTitle'), adjustmentPct: t(draft.goalType === 'lose_fat' ? 'goals.adjustmentDeficit' : 'goals.adjustmentSurplus'),
      kcal: t('goals.kcal'), proteinG: t('goals.protein'), carbsG: t('goals.carbs'), fatG: t('goals.fat'), water: t('goals.water'),
      weeklyWorkoutTarget: t('goals.weeklyTitle'), estimate: t('goals.title'),
    })[key] ?? key;
  /** Speaks which fields need attention (and the calorie conflict text, which belongs to no single field). */
  const announceIssues = (found: DraftIssues) => {
    const keys = Object.keys(found);
    if (keys.length === 0) return;
    const rank = (k: string) => (SCREEN_ORDER.indexOf(k) === -1 ? SCREEN_ORDER.length : SCREEN_ORDER.indexOf(k)); // read in the order the fields appear on screen
    const fields = keys.filter((k) => k !== 'estimate').sort((x, y) => rank(x) - rank(y)).map(issueLabel).join(', ');
    announce([found.estimate ? t(found.estimate) : '', fields ? t('goals.a11y.needsAttention', { fields }) : ''].filter(Boolean).join(' '));
  };

  const touch = () => {
    setSavedOnce(false);
    setSaveError(null);
  };
  const clearIssues = (...keys: string[]) =>
    setIssues((i) => Object.fromEntries(Object.entries(i).filter(([k]) => !keys.includes(k))));
  const editInputs = (patch: Parameters<typeof setInputs>[1]) => {
    touch();
    setDraft((d) => setInputs(d, patch));
    clearIssues(...Object.keys(patch), 'estimate', ...(patch.goalType ? ['adjustmentPct'] : []));
  };
  const editTarget = (field: TargetField, v: string) => {
    touch();
    setDraft((d) => setTarget(d, field, v));
    clearIssues(field);
  };

  const calculate = () => {
    touch();
    const r = calculateEstimate(draft);
    if (!r.ok) {
      const found = r.error.kind === 'validation' ? r.error.issues : {};
      setIssues(found);
      announceIssues(found);
      return;
    }
    setIssues({});
    setDraft(applyEstimate(draft, r.value));
    playSound('tap');
    announce(t('goals.a11y.calculated'));
  };

  const [savedAs, setSavedAs] = useState<'calculated' | 'manual' | 'stale'>('manual');
  const save = async () => {
    if (!repos || loadError) return;
    const input = toGoalsInput(draft);
    if (!input.ok) {
      const found = input.error.kind === 'validation' ? input.error.issues : {};
      setIssues(found);
      announceIssues(found);
      return;
    }
    setIssues({});
    setSaving(true);
    setSaveError(null);
    const r = await repos.goals.save(input.value);
    setSaving(false);
    if (r.ok) {
      const how = draft.stale ? 'stale' : saveSource(draft);
      setSavedAs(how);
      setSavedOnce(true);
      playSound('success');
      announce(t(how === 'stale' ? 'goals.savedStale' : how === 'calculated' ? 'goals.savedEstimate' : 'goals.saved'));
    } else {
      setSaveError(r.error);
      announce(t(errorMessageKey(r.error)));
    }
  };

  if (!loaded) {
    return (
      <Screen withNav={false} avoidKeyboard>
        <AppHeader title={t('goals.title')} />
        <View style={styles.center}>
          <ActivityIndicator color={colors.white} />
          <AppText size={13} color={colors.onGradientMuted}>{t('goals.loading')}</AppText>
        </View>
      </Screen>
    );
  }

  const adjustable = draft.goalType !== 'maintain';
  const BADGE_KEY: Record<Badge, string> = { estimate: 'goals.estimate', outdated: 'goals.outdated', edited: 'goals.edited', preliminary: 'goals.waterEstimate' };
  const badgesFor = (f: TargetField) => fieldBadges(draft, f).map((b) => t(BADGE_KEY[b]));
  const hasCalculated = draft.estimateInfo !== null;
  const hints = visibleHints(draft);
  const hintText = (field: 'age' | 'weight', h: SavedHint | null) =>
    h ? t(`goals.hints.${field}.${h.reason}`, { value: h.value, date: h.on ?? '' }) : undefined;
  const saveBlocked = !ready || saving || loadError !== null;
  const issue = (k: string) => issues[k];

  return (
    <Screen withNav={false} avoidKeyboard>
      <AppHeader title={t('goals.title')} />

      <GlassCard strong style={styles.card}>
        <AppText size={12} color={colors.muted}>{t('goals.intro')}</AppText>
      </GlassCard>

      {state.status === 'unavailable' ? (
        <GlassCard strong style={styles.card}>
          <View style={styles.row}>
            <Icon name="information-circle-outline" size={18} color={colors.danger} />
            <AppText size={13} color={colors.ink} style={styles.flex}>{t(errorMessageKey(state.error))}</AppText>
          </View>
          <Pressable accessibilityRole="button" onPress={retry} style={[styles.btn, styles.btnGhost]}>
            <AppText size={13} weight="medium" color={colors.dark} align="center">{t('goals.retry')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}

      <GlassCard strong style={styles.card}>
        <AppText size={15} weight="medium" color={colors.ink} accessibilityRole="header">{t('goals.detailsTitle')}</AppText>
        <AppText size={11} color={colors.muted}>{t('goals.detailsNote')}</AppText>
        <Chips label={t('goals.sex')} options={SEX} value={draft.sex} onChange={(sex) => editInputs({ sex })} render={(s) => t(`goals.sexOptions.${s}`)} error={issue('sex')} />
        <View style={styles.pair}>
          <View style={styles.flex}><Field label={t('goals.age')} value={draft.age} onChange={(age) => editInputs({ age })} keyboardType="number-pad" error={issue('age')} note={hintText('age', hints.age)} /></View>
          <View style={styles.flex}><Field label={t('goals.height')} value={draft.heightCm} onChange={(heightCm) => editInputs({ heightCm })} keyboardType="decimal-pad" error={issue('heightCm')} /></View>
          <View style={styles.flex}><Field label={t('goals.weight')} value={draft.weightKg} onChange={(weightKg) => editInputs({ weightKg })} keyboardType="decimal-pad" error={issue('weightKg')} note={hintText('weight', hints.weightKg)} /></View>
        </View>
        {hints.age ? <AppText size={11} color={colors.ink}>{hintText('age', hints.age)}</AppText> : null}
        {hints.weightKg ? <AppText size={11} color={colors.ink}>{hintText('weight', hints.weightKg)}</AppText> : null}
        <Chips
          label={t('goals.activity')} options={ACTIVITY_LEVEL} value={draft.activityLevel} onChange={(activityLevel) => editInputs({ activityLevel })}
          render={(a) => t(`goals.activityLevels.${a}`)} error={issue('activityLevel')}
        />
      </GlassCard>

      <GlassCard strong style={styles.card}>
        <AppText size={15} weight="medium" color={colors.ink} accessibilityRole="header">{t('goals.goalTitle')}</AppText>
        <Chips label={t('goals.goalTitle')} options={GOAL_TYPE} value={draft.goalType} onChange={(goalType) => editInputs({ goalType })} render={(g) => t(`goals.goalTypes.${g}`)} error={issue('goalType')} />
        {adjustable ? (
          <>
            <Field
              label={t(draft.goalType === 'lose_fat' ? 'goals.adjustmentDeficit' : 'goals.adjustmentSurplus')}
              value={draft.adjustmentPct} onChange={(adjustmentPct) => editInputs({ adjustmentPct })} keyboardType="decimal-pad" error={issue('adjustmentPct')}
            />
            <AppText size={11} color={colors.muted}>{t('goals.adjustmentHint')}</AppText>
          </>
        ) : null}
        <Pressable accessibilityRole="button" onPress={calculate} style={[styles.btn, styles.btnPrimary]}>
          <AppText size={14} weight="medium" color={colors.white} align="center">{t(hasCalculated ? 'goals.recalculate' : 'goals.calculate')}</AppText>
        </Pressable>
        {Object.keys(issues).some((k) => ['sex', 'age', 'heightCm', 'weightKg', 'activityLevel', 'adjustmentPct'].includes(k)) ? (
          <AppText size={11} color={colors.danger}>{t('goals.fixFields')}</AppText>
        ) : null}
        {issues.estimate ? <AppText size={12} color={colors.danger}>{t(issues.estimate)}</AppText> : null}
        {draft.stale ? <AppText size={12} weight="medium" color={colors.danger}>{t('goals.stale')}</AppText> : null}
        {draft.estimateInfo?.bmrFloorApplied ? <AppText size={11} color={colors.muted}>{t('goals.floorNote')}</AppText> : null}
        {draft.estimateInfo?.limits.map((l) => <AppText key={l} size={11} color={colors.muted}>{t(`goals.limits.${l}`)}</AppText>)}
      </GlassCard>

      <GlassCard strong style={styles.card}>
        <AppText size={15} weight="medium" color={colors.ink} accessibilityRole="header">{t('goals.targetsTitle')}</AppText>
        <Field label={`${t('goals.kcal')} (${t('goals.unitKcal')})`} value={draft.kcal} onChange={(v) => editTarget('kcal', v)} keyboardType="number-pad" error={issue('kcal')} badges={badgesFor('kcal')} />
        <Field label={`${t('goals.protein')} (${t('goals.unitG')})`} value={draft.proteinG} onChange={(v) => editTarget('proteinG', v)} keyboardType="decimal-pad" error={issue('proteinG')} badges={badgesFor('proteinG')} />
        <Field label={`${t('goals.carbs')} (${t('goals.unitG')})`} value={draft.carbsG} onChange={(v) => editTarget('carbsG', v)} keyboardType="decimal-pad" error={issue('carbsG')} badges={badgesFor('carbsG')} />
        <Field label={`${t('goals.fat')} (${t('goals.unitG')})`} value={draft.fatG} onChange={(v) => editTarget('fatG', v)} keyboardType="decimal-pad" error={issue('fatG')} badges={badgesFor('fatG')} />
        <Field label={`${t('goals.water')} (${t('goals.unitMl')})`} value={draft.water} onChange={(v) => editTarget('water', v)} keyboardType="number-pad" error={issue('water')} badges={badgesFor('water')} />
        <AppText size={11} color={colors.muted}>{t('goals.optionalNote')}</AppText>
        <AppText size={11} color={colors.muted}>{t('goals.waterNote')}</AppText>
      </GlassCard>

      <GlassCard strong style={styles.card}>
        <AppText size={15} weight="medium" color={colors.ink} accessibilityRole="header">{t('goals.weeklyTitle')}</AppText>
        <AppText size={11} color={colors.muted}>{t('goals.weeklyNote')}</AppText>
        <Chips
          label={t('goals.weeklyTitle')} options={WEEKLY_TARGET_CHOICES} value={draft.weeklyWorkoutTarget}
          onChange={(n) => {
            touch();
            setDraft((d) => setWeeklyTarget(d, n));
            clearIssues('weeklyWorkoutTarget');
          }}
          render={(n) => String(n)} error={issue('weeklyWorkoutTarget')}
        />
      </GlassCard>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: saveBlocked }}
        disabled={saveBlocked}
        onPress={save}
        style={[styles.btn, styles.btnPrimary, saveBlocked && styles.dim]}
      >
        <AppText size={14} weight="medium" color={colors.white} align="center">{t(saving ? 'goals.saving' : 'goals.save')}</AppText>
      </Pressable>
      {!ready ? <AppText size={11} color={colors.onGradientMuted}>{t('goals.notReady')}</AppText> : null}
      {loadError ? (
        <GlassCard strong style={styles.card}>
          <AppText size={13} color={colors.ink}>{t('goals.loadFailed')}</AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setDbLoaded(false);
              setLoadError(null);
              setReloadKey((k) => k + 1);
            }}
            style={[styles.btn, styles.btnGhost]}
          >
            <AppText size={13} weight="medium" color={colors.dark} align="center">{t('goals.reload')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}
      {saveError ? (
        <View style={styles.row}>
          <Icon name="information-circle-outline" size={16} color={colors.white} />
          <AppText size={12} color={colors.white} style={styles.flex}>{t(errorMessageKey(saveError))}</AppText>
        </View>
      ) : null}
      {savedOnce ? (
        <View style={styles.row}>
          <Icon name="checkmark-circle" size={16} color={colors.white} />
          <AppText size={12} color={colors.white} style={styles.flex}>
            {t(savedAs === 'stale' ? 'goals.savedStale' : savedAs === 'calculated' ? 'goals.savedEstimate' : 'goals.saved')}
          </AppText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  card: { padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pair: { flexDirection: 'row', gap: 10 },
  field: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
  input: {
    minHeight: 44, borderRadius: radius.sm, paddingHorizontal: 12, backgroundColor: 'rgba(255,255,255,0.85)',
    color: colors.ink, fontSize: 15,
  },
  inputError: { borderWidth: 1, borderColor: colors.danger },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.dark },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnPrimary: { backgroundColor: colors.dark },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  dim: { opacity: 0.5 },
});
