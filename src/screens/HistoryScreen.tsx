import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Screen } from '../components/Screen';
import { errorMessageKey } from '../domain/errors';
import type { WorkoutSession } from '../domain/models';
import { useWorkoutHistory } from '../hooks/useWorkoutHistory';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

const minutes = (s: WorkoutSession) => (s.endedAt === null ? null : Math.max(0, Math.round((s.endedAt - s.startedAt) / 60_000)));

/** Finished workouts, newest first. Each row opens the saved workout (its sets and summary) on the session screen. */
export default function HistoryScreen() {
  const { t } = useTranslation();
  const { state, loadMore, loadingMore, moreError, retry, retryDatabase } = useWorkoutHistory();

  const previous = useRef<string | null>(null);
  const problem = state.status === 'unavailable' ? t('history.unavailable') : state.status === 'failed' ? `${t('history.readFailed')} ${t(errorMessageKey(state.error))}` : '';
  useEffect(() => {
    const before = previous.current;
    if (before === state.status) return;
    previous.current = state.status;
    if (state.status === 'loading') announce(t('history.loading'));
    else if (state.status === 'ready') {
      if (before === 'loading') announce(t('history.loaded'));
    } else announce(problem);
  }, [state.status, problem, t]);

  const shown = state.status === 'ready' ? state.items.length : 0;
  const shownBefore = useRef(0);
  useEffect(() => {
    if (shown > shownBefore.current && shownBefore.current > 0) announce(t('history.moreLoaded', { count: shown }));
    shownBefore.current = shown;
  }, [shown, t]);

  return (
    <Screen withNav={false}>
      <AppHeader title={t('history.title')} />
      <AppText size={13} color={colors.onGradientMuted}>{t('history.subtitle')}</AppText>

      {state.status === 'loading' ? (
        <GlassCard strong style={styles.card}>
          <View style={styles.row}>
            <ActivityIndicator color={colors.dark} />
            <AppText size={13} color={colors.ink}>{t('history.loading')}</AppText>
          </View>
        </GlassCard>
      ) : null}

      {state.status === 'unavailable' || state.status === 'failed' ? (
        <GlassCard strong style={styles.card}>
          <AppText size={13} color={colors.ink}>{problem}</AppText>
          <Pressable accessibilityRole="button" onPress={state.status === 'unavailable' ? retryDatabase : retry} style={[styles.btn, styles.ghost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('history.reload')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}

      {state.status === 'ready' && state.items.length === 0 ? (
        <GlassCard strong style={styles.card}>
          <AppText size={15} weight="medium" color={colors.ink} accessibilityRole="header">{t('history.empty')}</AppText>
          <AppText size={13} color={colors.ink}>{t('history.emptyHint')}</AppText>
        </GlassCard>
      ) : null}

      {state.status === 'ready' && state.items.length > 0 ? (
        <>
          <AppText size={12} color={colors.onGradientMuted}>{t('history.count', { count: state.items.length })}</AppText>
          <View style={styles.list}>
            {state.items.map((s) => {
              const min = minutes(s);
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${s.name}, ${s.localDate}${min === null ? '' : `, ${t('history.minutes', { minutes: min })}`}`}
                  onPress={() => router.push({ pathname: '/session/[id]', params: { id: String(s.id) } })}
                  style={styles.item}
                >
                  <AppText size={16} weight="medium" color={colors.ink}>{s.name}</AppText>
                  <AppText size={12} color={colors.muted}>{min === null ? s.localDate : `${s.localDate} · ${t('history.minutes', { minutes: min })}`}</AppText>
                </Pressable>
              );
            })}
          </View>
          {moreError ? <AppText size={12} color={colors.white}>{`${t('history.moreFailed')} ${t(errorMessageKey(moreError))}`}</AppText> : null}
          {state.hasMore ? (
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: loadingMore, busy: loadingMore }} disabled={loadingMore} onPress={() => void loadMore()} style={[styles.btn, styles.ghost, loadingMore && styles.dim]}>
              <AppText size={14} weight="medium" color={colors.dark} align="center">{t(loadingMore ? 'history.loadingMore' : 'history.loadMore')}</AppText>
            </Pressable>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 12 },
  list: { gap: 10 },
  item: { minHeight: 56, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.85)', gap: 2 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  ghost: { backgroundColor: 'rgba(255,255,255,0.8)' },
  dim: { opacity: 0.5 },
});
