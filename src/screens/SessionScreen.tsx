import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Screen } from '../components/Screen';
import { useDatabase } from '../context/DatabaseContext';
import { errorMessageKey, type AppError } from '../domain/errors';
import type { Exercise, WorkoutSessionDetail } from '../domain/models';
import { summarizeTargets } from '../domain/templateSummary';
import { useExerciseName } from '../hooks/useExerciseLibrary';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

type Load =
  | { status: 'loading' }
  | { status: 'missing' }
  | { status: 'failed'; error: AppError }
  | { status: 'ready'; session: WorkoutSessionDetail; exercises: Exercise[] };

/**
 * A persisted workout session, read back from the database: its name, status and exercises in the order they were
 * started with, each with the targets recorded when the session started. The template is never read here, so renaming,
 * editing or deleting it cannot change what an old session shows. A row with no recorded targets (a session from before
 * they were recorded, or an exercise added by hand) shows none. Logging sets is a later milestone.
 */
export default function SessionScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const sessionId = /^\d+$/.test(String(id ?? '')) ? Number(id) : null;
  const { state: db, retry } = useDatabase();
  const nameOf = useExerciseName();
  const repos = db.status === 'ready' ? db.repos : null;
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (!repos || sessionId === null) return;
      void attempt;
      let cancelled = false;
      (async () => {
        const s = await repos.sessions.get(sessionId);
        if (cancelled) return;
        if (!s.ok) return setLoad(s.error.kind === 'not_found' ? { status: 'missing' } : { status: 'failed', error: s.error });
        const ex = await repos.exercises.list({ includeArchived: true });
        if (cancelled) return;
        if (!ex.ok) return setLoad({ status: 'failed', error: ex.error });
        setLoad({ status: 'ready', session: s.value, exercises: ex.value });
      })();
      return () => {
        cancelled = true;
      };
    }, [repos, sessionId, attempt]),
  );

  const status = sessionId === null ? 'missing' : db.status === 'unavailable' ? 'unavailable' : db.status === 'loading' ? 'loading' : load.status;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === status) return;
    const before = previous.current;
    previous.current = status;
    if (status === 'missing') announce(t('liveSession.notFound'));
    else if (status === 'failed') announce(t('liveSession.readFailed'));
    else if (status === 'unavailable') announce(t('liveSession.unavailable'));
    else if (status === 'ready' && before !== null) announce(t('liveSession.loaded'));
  }, [status, t]);

  if (status !== 'ready' || load.status !== 'ready') {
    const text = status === 'missing' ? t('liveSession.notFound') : status === 'unavailable' ? t('liveSession.unavailable') : status === 'failed' && load.status === 'failed' ? `${t('liveSession.readFailed')} ${t(errorMessageKey(load.error))}` : t('liveSession.loading');
    return (
      <Screen withNav={false}>
        <AppHeader title={t('liveSession.title')} />
        <GlassCard strong style={styles.card}>
          <View style={styles.row}>
            {status === 'loading' ? <ActivityIndicator color={colors.dark} /> : null}
            <AppText size={13} color={colors.ink}>{text}</AppText>
          </View>
          {status === 'unavailable' || status === 'failed' ? (
            <Pressable accessibilityRole="button" onPress={status === 'unavailable' ? retry : () => { setLoad({ status: 'loading' }); setAttempt((n) => n + 1); }} style={styles.btn}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.reload')}</AppText>
            </Pressable>
          ) : null}
        </GlassCard>
      </Screen>
    );
  }

  const { session, exercises } = load;
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const anyPlan = session.exercises.some((e) => e.plan);
  const statusKey = session.status === 'in_progress' ? 'statusInProgress' : session.status === 'completed' ? 'statusCompleted' : 'statusDiscarded';
  return (
    <Screen withNav={false}>
      <AppHeader title={t('liveSession.title')} />
      <GlassCard strong style={styles.card}>
        <AppText size={20} weight="semibold" color={colors.ink} accessibilityRole="header">{session.name}</AppText>
        <AppText size={12} color={colors.muted}>{`${t(`liveSession.${statusKey}`)} · ${t('liveSession.startedOn', { date: session.localDate })}`}</AppText>
        <AppText size={14} weight="medium" color={colors.ink} accessibilityRole="header">{t('liveSession.exercises')}</AppText>
        {session.exercises.map((se, i) => {
          const ex = byId.get(se.exerciseId);
          const name = se.exerciseName ?? (ex ? nameOf(ex) : '');
          const summary = se.plan ? summarizeTargets(t, se.plan) : null;
          return (
            <View key={se.id} style={styles.item} accessible accessibilityLabel={`${se.position}. ${name}${summary ? `, ${t('liveSession.planned', { summary })}` : ''}`}>
              <AppText size={15} weight="medium" color={colors.ink}>{t('liveSession.exerciseRow', { position: se.position, name })}</AppText>
              {summary ? <AppText size={12} color={colors.muted}>{t('liveSession.planned', { summary })}</AppText> : null}
            </View>
          );
        })}
        {!anyPlan ? <AppText size={11} color={colors.muted}>{t('liveSession.noPlan')}</AppText> : null}
      </GlassCard>
      <AppText size={12} color={colors.onGradientMuted}>{t('liveSession.next')}</AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 10 },
  item: { gap: 2, paddingVertical: 4 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(255,255,255,0.8)' },
});
