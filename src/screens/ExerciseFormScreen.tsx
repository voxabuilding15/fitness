import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader, goBack } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { ChoiceChips, MultiChips, TextField } from '../components/FormControls';
import { GlassCard } from '../components/GlassCard';
import { Screen } from '../components/Screen';
import { useDatabase } from '../context/DatabaseContext';
import { errorMessageKey } from '../domain/errors';
import {
  emptyExerciseForm, formFromExercise, MAX_SECONDARY_MUSCLES, planExerciseSave, setPrimaryMuscle, toggleSecondaryMuscle,
  type ExerciseForm, type ExerciseFormIssues,
} from '../domain/exerciseLibrary';
import type { Exercise } from '../domain/models';
import { EQUIPMENT, EXERCISE_CATEGORY, MUSCLE, TRACKING_TYPE } from '../domain/schemas/enums';
import { useExerciseName } from '../hooks/useExerciseLibrary';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

type Source =
  | { status: 'loading' }
  | { status: 'ready'; form: ExerciseForm; others: Exercise[]; editing: Exercise | null }
  | { status: 'missing' }
  | { status: 'failed'; message: string };

const asId = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);

/** Create an exercise, edit one of your own (`?id=`), or start from a copy of any exercise (`?copyFrom=`). */
export default function ExerciseFormScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; copyFrom?: string }>();
  const editId = asId(params.id);
  const copyId = asId(params.copyFrom);
  const wanted = editId ?? copyId;
  const { state: db, retry } = useDatabase();
  const nameOf = useExerciseName();
  const nameOfRef = useRef(nameOf);
  useEffect(() => {
    nameOfRef.current = nameOf;
  });
  const repos = db.status === 'ready' ? db.repos : null;
  const [source, setSource] = useState<Source>({ status: 'loading' });
  const [form, setForm] = useState<ExerciseForm | null>(null);
  const [issues, setIssues] = useState<ExerciseFormIssues>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!repos) return;
    let cancelled = false;
    (async () => {
      const all = await repos.exercises.list({ includeArchived: true });
      if (cancelled) return;
      if (!all.ok) return setSource({ status: 'failed', message: t(errorMessageKey(all.error)) });
      const found = wanted === null ? null : all.value.find((e) => e.id === wanted) ?? null;
      if (wanted !== null && (!found || (editId !== null && found.source !== 'user'))) return setSource({ status: 'missing' });
      const start = found ? formFromExercise(found, nameOfRef.current) : emptyExerciseForm();
      // a copy starts with every detail but the name: the person names it themselves
      setForm(editId === null && found ? { ...start, name: '' } : start);
      setSource({ status: 'ready', form: start, others: all.value, editing: editId !== null ? found : null });
    })();
    return () => {
      cancelled = true;
    };
  }, [repos, wanted, editId, t]);

  const title = t(editId !== null ? 'library.editTitle' : copyId !== null ? 'library.copyTitle' : 'library.newTitle');
  const status = db.status === 'unavailable' ? 'unavailable' : db.status === 'loading' ? 'loading' : source.status;
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (announced.current === status) return;
    announced.current = status;
    if (status === 'missing') announce(t('library.notFound'));
    else if (status === 'failed') announce(t('library.readFailed'));
    else if (status === 'unavailable') announce(t('library.unavailable'));
  }, [status, t]);

  if (status !== 'ready' || !form || source.status !== 'ready') {
    return (
      <Screen withNav={false}>
        <AppHeader title={title} />
        <GlassCard strong style={styles.card}>
          {status === 'loading' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.dark} />
              <AppText size={13} color={colors.ink}>{t('library.loading')}</AppText>
            </View>
          ) : (
            <AppText size={13} color={colors.ink}>
              {status === 'missing' ? t('library.notFound') : status === 'unavailable' ? t('library.unavailable') : `${t('library.readFailed')} ${source.status === 'failed' ? source.message : ''}`}
            </AppText>
          )}
          {status === 'unavailable' ? (
            <Pressable accessibilityRole="button" onPress={retry} style={[styles.btn, styles.btnGhost]}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t('library.reload')}</AppText>
            </Pressable>
          ) : null}
        </GlassCard>
      </Screen>
    );
  }

  const edit = (next: ExerciseForm) => {
    setForm(next);
    setSaveError(null);
  };
  const save = async () => {
    if (!repos || saving) return;
    const plan = planExerciseSave(form, source.others, nameOf, source.editing?.id);
    if (!plan.ok) {
      const found = plan.error.kind === 'validation' ? (plan.error.issues as ExerciseFormIssues) : {};
      setIssues(found);
      const fields = (['name', 'category', 'primaryMuscle', 'equipment', 'trackingType', 'secondaryMuscles'] as const)
        .filter((k) => found[k])
        .map((k) => t(`library.fieldNames.${k}`))
        .join(', ');
      announce(fields ? t('library.needsAttention', { fields }) : t(errorMessageKey(plan.error)));
      return;
    }
    setIssues({});
    setSaving(true);
    const r = source.editing ? await repos.exercises.update(source.editing.id, plan.value) : await repos.exercises.create(plan.value);
    setSaving(false);
    if (r.ok) {
      announce(t(source.editing ? 'library.saved' : 'library.created'));
      goBack();
    } else {
      const text = t(errorMessageKey(r.error));
      setSaveError(text);
      announce(text);
    }
  };

  return (
    <Screen withNav={false} avoidKeyboard>
      <AppHeader title={title} />
      <GlassCard strong style={styles.card}>
        <TextField label={t('library.name')} value={form.name} onChange={(v) => edit({ ...form, name: v })} error={issues.name} maxLength={80} />
        <ChoiceChips label={t('library.category')} options={EXERCISE_CATEGORY} value={form.category} onChange={(v) => edit({ ...form, category: v })} renderLabel={(v) => t(`library.categories.${v}`)} error={issues.category} />
        <ChoiceChips label={t('library.primary')} options={MUSCLE} value={form.primaryMuscle} onChange={(v) => v && edit(setPrimaryMuscle(form, v))} renderLabel={(v) => t(`library.muscles.${v}`)} error={issues.primaryMuscle} />
        <MultiChips
          label={t('library.secondary')}
          options={MUSCLE.filter((m) => m !== form.primaryMuscle)}
          values={form.secondaryMuscles}
          onToggle={(m) => edit(toggleSecondaryMuscle(form, m))}
          renderLabel={(v) => t(`library.muscles.${v}`)}
          note={t('library.secondaryNote', { count: MAX_SECONDARY_MUSCLES })}
        />
        <ChoiceChips label={t('library.equipment')} options={EQUIPMENT} value={form.equipment} onChange={(v) => edit({ ...form, equipment: v })} renderLabel={(v) => t(`library.equipmentNames.${v}`)} error={issues.equipment} />
        <ChoiceChips label={t('library.tracking')} options={TRACKING_TYPE} value={form.trackingType} onChange={(v) => edit({ ...form, trackingType: v })} renderLabel={(v) => t(`library.trackingTypes.${v}`)} error={issues.trackingType} />
        {saveError ? <AppText size={12} color={colors.danger}>{saveError}</AppText> : null}
      </GlassCard>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={() => void save()} style={[styles.btn, styles.btnPrimary, saving && styles.dim]}>
        <AppText size={14} weight="medium" color={colors.white} align="center">{t(saving ? 'library.saving' : 'library.save')}</AppText>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={goBack} style={[styles.btn, styles.btnGhost]}>
        <AppText size={14} weight="medium" color={colors.dark} align="center">{t('library.cancel')}</AppText>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 14 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnPrimary: { backgroundColor: colors.dark },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  dim: { opacity: 0.5 },
});
