import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppLogo } from '../components/AppLogo';
import { AppText } from '../components/AppText';
import { Avatar } from '../components/Avatar';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { IconButton } from '../components/IconButton';
import { Screen } from '../components/Screen';
import { useProfileName } from '../context/ProfileContext';
import { SectionHeader } from '../components/SectionHeader';
import { StatCard } from '../components/StatCard';
import { useApp } from '../context/AppContext';
import { errorMessageKey } from '../domain/errors';
import { normalizeForSearch } from '../domain/exerciseLibrary';
import { useExerciseName } from '../hooks/useExerciseLibrary';
import { useFormat } from '../hooks/useFormat';
import { useHome } from '../hooks/useHome';
import { colors, radius } from '../theme';

/** Statuses for a progress ratio, as on the old Home tiles. */
const statusKey = (ratio: number) => (ratio >= 0.7 ? 'home.statusGood' : ratio >= 0.4 ? 'home.statusAverage' : 'home.statusLow');

export default function HomeScreen() {
  const { t } = useTranslation();
  const { settings } = useApp();
  // the stored name; null = none (yet, or the database is unavailable): no name is ever invented, and the built-in demo profile is never used
  const name = useProfileName();
  const { formatDate, formatNumber } = useFormat();
  const nameOf = useExerciseName();
  const { state, retry, retryDatabase } = useHome();
  const [query, setQuery] = useState('');
  const [showDeviceNote, setShowDeviceNote] = useState(false);

  const firstName = (name ?? '').trim().split(/\s+/)[0] ?? '';
  const searching = query.trim().length > 0;

  // Search covers the person's saved workouts and the exercise library (hidden exercises excluded), by displayed name
  const results = useMemo(() => {
    if (!searching || state.status !== 'ready') return [];
    const q = normalizeForSearch(query);
    const workouts = state.templates.filter((w) => normalizeForSearch(w.name).includes(q)).map((w) => ({
      key: `w${w.id}`, title: w.name, subtitle: t('home.resultWorkout'), go: () => router.push({ pathname: '/templates/[id]', params: { id: String(w.id) } }),
    }));
    const exercises = state.exercises.filter((e) => !e.isArchived && normalizeForSearch(nameOf(e)).includes(q)).map((e) => ({
      key: `e${e.id}`, title: nameOf(e), subtitle: t('home.resultExercise'), go: () => router.push({ pathname: '/exercises/[id]', params: { id: String(e.id) } }),
    }));
    return [...workouts, ...exercises];
  }, [query, searching, state, nameOf, t]);

  // Split the welcome line so the user's name can be bold wherever it lands in the translation
  const line1 = firstName ? t('home.welcomeLine1', { name: '\u0000' }).split('\u0000') : [t('home.welcomeNoName'), ''];
  const ready = state.status === 'ready' ? state : null;
  const next = ready && !ready.active ? ready.templates[0] ?? null : null; // newest saved workout (the list is newest first)

  return (
    <Screen>
      <View style={styles.header}>
        <AppLogo />
        <View style={styles.headerRight}>
          <IconButton icon="phone-portrait-outline" label={t('home.device')} onPress={() => setShowDeviceNote((v) => !v)} />
          <IconButton icon="notifications-outline" label={t('home.notifications')} badge={!settings.reminders.enabled} onPress={() => router.push('/reminders')} />
          <Pressable accessibilityRole="button" accessibilityLabel={t('home.avatar')} onPress={() => router.navigate('/profile')}>
            <Avatar name={name ?? ''} size={44} />
          </Pressable>
        </View>
      </View>

      {showDeviceNote ? (
        <GlassCard style={styles.notice} strong>
          <Icon name="information-circle-outline" size={20} color={colors.dark} />
          <AppText size={12} color={colors.ink} style={styles.flex}>{t('home.deviceNotice')}</AppText>
        </GlassCard>
      ) : null}

      <View>
        <AppText size={21} weight="light" color={colors.onGradientMuted} style={styles.welcome}>
          {line1[0]}
          {firstName ? <AppText size={21} weight="bold" color={colors.onGradient}>{firstName}</AppText> : null}
          {line1[1]}
        </AppText>
        <AppText size={21} weight="semibold" color={colors.onGradient} style={styles.welcome}>{t('home.welcomeLine2')}</AppText>
        <AppText size={12} color={colors.onGradientMuted} style={styles.date}>{t('home.today', { date: formatDate(new Date()) })}</AppText>
      </View>

      <View style={styles.search}>
        <View style={styles.searchIcon}>
          <Icon name="search" size={18} color={colors.dark} />
        </View>
        <TextInput
          accessibilityLabel={t('home.searchLabel')}
          value={query}
          onChangeText={setQuery}
          placeholder={t('home.searchPlaceholder')}
          placeholderTextColor={colors.muted}
          returnKeyType="search"
          style={[styles.searchInput, { textAlign: settings.language === 'ar' ? 'right' : 'left' }]}
        />
        {searching ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} hitSlop={10} onPress={() => setQuery('')} style={styles.clear}>
            <Icon name="close-circle" size={20} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {searching ? (
        <View style={styles.gap}>
          <SectionHeader title={t('home.resultsTitle')} />
          {results.length === 0 ? (
            <GlassCard style={styles.empty} strong>
              <Icon name="search-outline" size={28} color={colors.dark} />
              <AppText size={15} weight="semibold" color={colors.ink} align="center">{t('home.noResultsTitle')}</AppText>
              <AppText size={13} color={colors.muted} align="center">{t('home.noResultsBody', { query: query.trim() })}</AppText>
            </GlassCard>
          ) : (
            results.map((r) => (
              <Pressable key={r.key} accessibilityRole="button" accessibilityLabel={`${r.title}, ${r.subtitle}`} onPress={r.go} style={({ pressed }) => [styles.result, pressed && { opacity: 0.8 }]}>
                <View style={styles.flex}>
                  <AppText size={14} weight="medium" color={colors.ink}>{r.title}</AppText>
                  <AppText size={12} color={colors.muted}>{r.subtitle}</AppText>
                </View>
                <Icon name="chevron-forward" size={18} color={colors.ink} />
              </Pressable>
            ))
          )}
        </View>
      ) : (
        <>
          <View style={styles.gap}>
            <SectionHeader title={t('home.thisWeek')} action={t('common.viewMore')} onAction={() => router.navigate('/statistics')} />
            {state.status === 'loading' ? (
              <View style={styles.row}>
                <ActivityIndicator color={colors.onGradient} />
                <AppText size={13} color={colors.onGradientMuted}>{t('home.loading')}</AppText>
              </View>
            ) : null}
            {state.status === 'unavailable' || state.status === 'failed' ? (
              <GlassCard strong style={styles.card}>
                <AppText size={13} color={colors.ink}>
                  {state.status === 'unavailable' ? t('home.unavailable') : `${t('home.readFailed')} ${t(errorMessageKey(state.error))}`}
                </AppText>
                <Pressable accessibilityRole="button" onPress={state.status === 'unavailable' ? retryDatabase : retry} style={styles.btn}>
                  <AppText size={14} weight="medium" color={colors.dark} align="center">{t('home.reload')}</AppText>
                </Pressable>
              </GlassCard>
            ) : null}
            {ready ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} style={styles.bleed}>
                <StatCard
                  label={t('home.weekWorkoutsLabel')}
                  value={formatNumber(ready.summary.weekWorkouts)}
                  unit={ready.summary.weeklyTarget === null ? '' : t('home.ofTarget', { target: ready.summary.weeklyTarget })}
                  status={ready.summary.progress === null ? undefined : t(statusKey(ready.summary.progress))}
                  progress={ready.summary.progress ?? undefined}
                  icon="fitness-outline"
                />
                <StatCard label={t('home.timeTodayLabel')} value={formatNumber(ready.summary.todayMinutes)} unit={t('stats.unitMin')} icon="time-outline" />
                <StatCard label={t('home.liftedTodayLabel')} value={formatNumber(ready.summary.todayVolumeKg, 1)} unit={t('stats.unitKg')} icon="barbell-outline" />
              </ScrollView>
            ) : null}
          </View>

          {ready ? (
            <View style={styles.gap}>
              <SectionHeader title={t('home.yourWorkout')} action={t('home.workoutViewMore')} onAction={() => router.navigate('/workouts')} />
              <GlassCard strong style={styles.card}>
                {ready.active ? (
                  <>
                    <AppText size={16} weight="semibold" color={colors.ink}>{t('liveSession.inProgressBanner', { name: ready.active.name })}</AppText>
                    <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/session/[id]', params: { id: String(ready.active!.id) } })} style={[styles.btn, styles.primary]}>
                      <AppText size={14} weight="medium" color={colors.white} align="center">{t('liveSession.resume')}</AppText>
                    </Pressable>
                  </>
                ) : next ? (
                  <>
                    <AppText size={16} weight="semibold" color={colors.ink}>{next.name}</AppText>
                    <AppText size={12} color={colors.muted}>{t('home.exercisesTotal', { count: next.exercises.length })}</AppText>
                    <Pressable accessibilityRole="button" accessibilityLabel={`${t('home.openWorkout')}: ${next.name}`} onPress={() => router.push({ pathname: '/templates/[id]', params: { id: String(next.id) } })} style={[styles.btn, styles.primary]}>
                      <AppText size={14} weight="medium" color={colors.white} align="center">{t('home.openWorkout')}</AppText>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <AppText size={15} weight="medium" color={colors.ink}>{t('home.noWorkoutsTitle')}</AppText>
                    <AppText size={13} color={colors.muted}>{t('home.noWorkoutsBody')}</AppText>
                    <Pressable accessibilityRole="button" onPress={() => router.push('/templates/form')} style={[styles.btn, styles.primary]}>
                      <AppText size={14} weight="medium" color={colors.white} align="center">{t('home.createWorkout')}</AppText>
                    </Pressable>
                  </>
                )}
              </GlassCard>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md },
  welcome: { lineHeight: 32 },
  date: { marginTop: 4 },
  search: {
    height: 58, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.4)',
    borderWidth: 1, borderColor: colors.glassBorder, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 10,
  },
  searchIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, height: '100%' },
  clear: { paddingHorizontal: 8 },
  gap: { gap: 12 },
  bleed: { marginHorizontal: -20 },
  cards: { paddingHorizontal: 20, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 10 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: colors.white },
  primary: { backgroundColor: colors.dark },
  empty: { alignItems: 'center', gap: 6, padding: 24 },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
});
