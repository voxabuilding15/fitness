import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader, goBack } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { useDatabase } from '../context/DatabaseContext';
import { errorMessageKey, type AppError } from '../domain/errors';
import type { Exercise } from '../domain/models';
import { useExerciseName } from '../hooks/useExerciseLibrary';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

type Load = { status: 'loading' } | { status: 'ready'; exercise: Exercise } | { status: 'missing' } | { status: 'failed'; error: AppError };

export default function ExerciseDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const exerciseId = /^\d+$/.test(String(id ?? '')) ? Number(id) : null;
  const { state: db, retry } = useDatabase();
  const nameOf = useExerciseName();
  const repos = db.status === 'ready' ? db.repos : null;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);

  const fetchOne = useCallback(async () => {
    if (!repos || exerciseId === null) return;
    const r = await repos.exercises.get(exerciseId);
    if (r.ok) setLoad({ status: 'ready', exercise: r.value });
    else setLoad(r.error.kind === 'not_found' ? { status: 'missing' } : { status: 'failed', error: r.error });
  }, [repos, exerciseId]);

  // read again whenever the screen is shown (for example after coming back from the edit form)
  useFocusEffect(
    useCallback(() => {
      void fetchOne();
    }, [fetchOne]),
  );

  const status = exerciseId === null ? 'missing' : db.status === 'unavailable' ? 'unavailable' : db.status === 'loading' ? 'loading' : load.status;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    const before = previous.current;
    if (before === status) return;
    previous.current = status;
    if (status === 'missing') announce(t('library.notFound'));
    else if (status === 'failed') announce(t('library.readFailed'));
    else if (status === 'unavailable') announce(t('library.unavailable'));
  }, [status, t]);

  const say = (text: string, problem = false) => {
    setMessage({ text, problem });
    announce(text);
  };
  const failure = (error: AppError) => say(error.kind === 'constraint' && error.constraint === 'foreign_key' ? t('library.inUse') : t(errorMessageKey(error)), true);

  const setHidden = async (hidden: boolean) => {
    if (!repos || load.status !== 'ready' || busy) return;
    setBusy(true);
    const r = await repos.exercises.setArchived(load.exercise.id, hidden);
    setBusy(false);
    if (r.ok) {
      setLoad({ status: 'ready', exercise: r.value });
      say(t(hidden ? 'library.hiddenDone' : 'library.shownDone'));
    } else failure(r.error);
  };
  const remove = async () => {
    if (!repos || load.status !== 'ready' || busy) return;
    setBusy(true);
    const r = await repos.exercises.delete(load.exercise.id);
    setBusy(false);
    setConfirmDelete(false);
    if (r.ok) {
      announce(t('library.deleted'));
      goBack();
    } else failure(r.error);
  };

  if (status !== 'ready') {
    return (
      <Screen withNav={false}>
        <AppHeader title={t('library.title')} />
        <GlassCard strong style={styles.card}>
          {status === 'loading' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.dark} />
              <AppText size={13} color={colors.ink}>{t('library.loading')}</AppText>
            </View>
          ) : (
            <AppText size={13} color={colors.ink}>
              {status === 'missing' ? t('library.notFound') : status === 'unavailable' ? t('library.unavailable') : `${t('library.readFailed')} ${load.status === 'failed' ? t(errorMessageKey(load.error)) : ''}`}
            </AppText>
          )}
          {status === 'unavailable' || status === 'failed' ? (
            <Pressable accessibilityRole="button" onPress={status === 'unavailable' ? retry : () => void fetchOne()} style={[styles.btn, styles.btnGhost]}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t('library.reload')}</AppText>
            </Pressable>
          ) : null}
        </GlassCard>
      </Screen>
    );
  }

  const ex = (load as Extract<Load, { status: 'ready' }>).exercise;
  const builtIn = ex.source === 'seed';
  const row = (label: string, value: string) => (
    <View style={styles.fact} key={label}>
      <AppText size={12} color={colors.muted}>{label}</AppText>
      <AppText size={15} color={colors.ink}>{value}</AppText>
    </View>
  );
  return (
    <Screen withNav={false}>
      <AppHeader title={nameOf(ex)} />
      <GlassCard strong style={styles.card}>
        <View style={styles.row}>
          <AppText size={20} weight="semibold" color={colors.ink} accessibilityRole="header" style={styles.flex}>{nameOf(ex)}</AppText>
          <View style={styles.badge}>
            <AppText size={10} weight="medium" color={colors.dark}>{t(builtIn ? 'library.builtIn' : 'library.custom')}</AppText>
          </View>
          {ex.isArchived ? (
            <View style={styles.badge}>
              <AppText size={10} weight="medium" color={colors.dark}>{t('library.hidden')}</AppText>
            </View>
          ) : null}
        </View>
        {row(t('library.category'), t(`library.categories.${ex.category}`))}
        {row(t('library.primary'), t(`library.muscles.${ex.primaryMuscle}`))}
        {ex.secondaryMuscles.length ? row(t('library.secondary'), ex.secondaryMuscles.map((m) => t(`library.muscles.${m}`)).join(', ')) : null}
        {row(t('library.equipment'), t(`library.equipmentNames.${ex.equipment}`))}
        {row(t('library.tracking'), t(`library.trackingTypes.${ex.trackingType}`))}
        {builtIn ? <AppText size={11} color={colors.muted}>{t('library.builtInNote')}</AppText> : null}
      </GlassCard>

      <View style={styles.actions}>
        {builtIn ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/exercises/form', params: { copyFrom: String(ex.id) } })}
              style={[styles.btn, styles.btnPrimary]}
            >
              <AppText size={14} weight="medium" color={colors.white} align="center">{t('library.duplicate')}</AppText>
            </Pressable>
            <AppText size={11} color={colors.onGradientMuted}>{t('library.duplicateHint')}</AppText>
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/exercises/form', params: { id: String(ex.id) } })} style={[styles.btn, styles.btnPrimary]}>
            <AppText size={14} weight="medium" color={colors.white} align="center">{t('library.edit')}</AppText>
          </Pressable>
        )}
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => void setHidden(!ex.isArchived)} style={[styles.btn, styles.btnGhost, busy && styles.dim]}>
          <AppText size={14} weight="medium" color={colors.dark} align="center">{t(ex.isArchived ? 'library.unhide' : 'library.hide')}</AppText>
        </Pressable>
        {!builtIn && !confirmDelete ? (
          <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.danger} align="center">{t('library.delete')}</AppText>
          </Pressable>
        ) : null}
        {!builtIn && confirmDelete ? (
          <GlassCard strong style={styles.card}>
            <AppText size={13} color={colors.ink}>{t('library.deleteConfirm')}</AppText>
            <View style={styles.row}>
              <Pressable accessibilityRole="button" disabled={busy} onPress={() => void remove()} style={[styles.btn, styles.btnDanger, styles.flex, busy && styles.dim]}>
                <AppText size={14} weight="medium" color={colors.white} align="center">{t('library.deleteConfirmYes')}</AppText>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(false)} style={[styles.btn, styles.btnGhost, styles.flex]}>
                <AppText size={14} weight="medium" color={colors.dark} align="center">{t('library.keep')}</AppText>
              </Pressable>
            </View>
          </GlassCard>
        ) : null}
      </View>

      {message ? (
        <View style={styles.row}>
          <Icon name={message.problem ? 'information-circle-outline' : 'checkmark-circle'} size={16} color={colors.white} />
          <AppText size={12} color={colors.white} style={styles.flex}>{message.text}</AppText>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  card: { padding: 16, gap: 12 },
  fact: { gap: 2 },
  actions: { gap: 10 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  btnPrimary: { backgroundColor: colors.dark },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  btnDanger: { backgroundColor: colors.danger },
  dim: { opacity: 0.5 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
});
