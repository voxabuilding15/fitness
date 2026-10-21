import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Screen } from '../components/Screen';
import { errorMessageKey } from '../domain/errors';
import { useTemplates } from '../hooks/useTemplates';
import { announce } from '../services/accessibility';
import { colors, radius } from '../theme';

/** The person's own workouts (templates), newest edit first. */
export default function TemplatesScreen() {
  const { t } = useTranslation();
  const { state, retry, retryDatabase } = useTemplates();

  const previous = useRef<string | null>(null);
  const problem = state.status === 'unavailable' ? `${t(errorMessageKey(state.error))} ${t('templates.unavailable')}` : state.status === 'failed' ? `${t('templates.readFailed')} ${t(errorMessageKey(state.error))}` : '';
  useEffect(() => {
    const before = previous.current;
    if (before === state.status) return;
    previous.current = state.status;
    if (state.status === 'loading') announce(t('templates.loading'));
    else if (state.status === 'ready') {
      if (before === 'loading') announce(t('templates.loaded'));
    } else announce(problem);
  }, [state.status, problem, t]);

  const create = () => router.push('/templates/form');
  return (
    <Screen withNav={false}>
      <AppHeader title={t('templates.title')} right={state.status === 'ready' ? { icon: 'add', label: t('templates.create'), onPress: create } : undefined} />
      <AppText size={13} color={colors.onGradientMuted}>{t('templates.subtitle')}</AppText>

      {state.status === 'loading' ? (
        <GlassCard strong style={styles.card}>
          <View style={styles.row}>
            <ActivityIndicator color={colors.dark} />
            <AppText size={13} color={colors.ink}>{t('templates.loading')}</AppText>
          </View>
        </GlassCard>
      ) : null}

      {state.status === 'unavailable' || state.status === 'failed' ? (
        <GlassCard strong style={styles.card}>
          <AppText size={13} color={colors.ink}>{problem}</AppText>
          <Pressable accessibilityRole="button" onPress={state.status === 'unavailable' ? retryDatabase : retry} style={[styles.btn, styles.btnGhost]}>
            <AppText size={14} weight="medium" color={colors.dark} align="center">{t('templates.reload')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}

      {state.status === 'ready' && state.templates.length === 0 ? (
        <GlassCard strong style={styles.card}>
          <AppText size={15} weight="medium" color={colors.ink} accessibilityRole="header">{t('templates.empty')}</AppText>
          <AppText size={13} color={colors.ink}>{t('templates.emptyHint')}</AppText>
          <Pressable accessibilityRole="button" onPress={create} style={[styles.btn, styles.btnPrimary]}>
            <AppText size={14} weight="medium" color={colors.white} align="center">{t('templates.create')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}

      {state.status === 'ready' && state.templates.length > 0 ? (
        <>
          <AppText size={12} color={colors.onGradientMuted}>{t('templates.count', { count: state.templates.length })}</AppText>
          <View style={styles.list}>
            {state.templates.map((tpl) => (
              <Pressable
                key={tpl.id}
                accessibilityRole="button"
                accessibilityLabel={`${tpl.name}, ${t('templates.exerciseCount', { count: tpl.exercises.length })}`}
                onPress={() => router.push({ pathname: '/templates/[id]', params: { id: String(tpl.id) } })}
                style={styles.item}
              >
                <AppText size={16} weight="medium" color={colors.ink}>{tpl.name}</AppText>
                <AppText size={12} color={colors.muted}>{t('templates.exerciseCount', { count: tpl.exercises.length })}</AppText>
              </Pressable>
            ))}
          </View>
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
  btnPrimary: { backgroundColor: colors.dark },
  btnGhost: { backgroundColor: 'rgba(255,255,255,0.8)' },
});
