import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
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
import { WorkoutCard } from '../components/WorkoutCard';
import { useApp } from '../context/AppContext';
import { WORKOUTS, TODAYS_WORKOUT_ID, getWorkout } from '../data/workouts';
import { useFormat } from '../hooks/useFormat';
import { activityProvider, statusFor } from '../services/activityService';
import { matches } from '../services/workoutService';
import { colors, radius } from '../theme';

const STAT_ICON = { steps: 'footsteps', calories: 'flame', distance: 'walk' } as const;
const STAT_LABEL = { steps: 'home.stepsLabel', calories: 'home.caloriesLabel', distance: 'home.distanceLabel' } as const;
const STAT_UNIT = { steps: 'common.steps', kcal: 'common.kcal', km: 'common.km' } as const;

export default function HomeScreen() {
  const { t } = useTranslation();
  const { settings } = useApp();
  // the stored name; null = none (yet, or the database is unavailable): no name is ever invented, and the built-in demo profile is never used
  const name = useProfileName();
  const { formatDate, formatNumber } = useFormat();
  const [query, setQuery] = useState('');
  const [showDeviceNote, setShowDeviceNote] = useState(false);

  const firstName = (name ?? '').trim().split(/\s+/)[0] ?? '';
  const todayWorkout = getWorkout(TODAYS_WORKOUT_ID)!;
  const stats = activityProvider.getToday();
  const searching = query.trim().length > 0;

  // Search covers workout titles and exercise names in the current language
  const results = useMemo(() => {
    if (!searching) return [];
    return WORKOUTS.flatMap((w) => {
      const title = t(`workouts.${w.id}`);
      const exerciseHits = w.exercises.filter((e) => matches(t(`exercises.${e.id}`), query));
      const out: { key: string; workoutId: string; title: string; subtitle?: string }[] = [];
      if (matches(title, query)) out.push({ key: w.id, workoutId: w.id, title });
      exerciseHits.forEach((e) =>
        out.push({ key: `${w.id}-${e.id}`, workoutId: w.id, title: t(`exercises.${e.id}`), subtitle: title }),
      );
      return out;
    });
  }, [query, searching, t]);

  // Split the welcome line so the user's name can be bold wherever it lands in the translation
  const line1 = firstName ? t('home.welcomeLine1', { name: '\u0000' }).split('\u0000') : [t('home.welcomeNoName'), ''];

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
              <Pressable
                key={r.key}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/workout/[id]', params: { id: r.workoutId } })}
                style={({ pressed }) => [styles.result, pressed && { opacity: 0.8 }]}
              >
                <View style={styles.flex}>
                  <AppText size={14} weight="medium" color={colors.ink}>{r.title}</AppText>
                  {r.subtitle ? <AppText size={12} color={colors.muted}>{r.subtitle}</AppText> : null}
                </View>
                <Icon name="chevron-forward" size={18} color={colors.ink} />
              </Pressable>
            ))
          )}
        </View>
      ) : (
        <>
          <View style={styles.gap}>
            <SectionHeader title={t('home.todaysStats')} action={t('common.viewMore')} onAction={() => router.navigate('/statistics')} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cards} style={styles.bleed}>
              {stats.map((s) => (
                <StatCard
                  key={s.id}
                  label={t(STAT_LABEL[s.id])}
                  value={formatNumber(s.value, s.unit === 'km' ? 1 : 0)}
                  unit={t(STAT_UNIT[s.unit])}
                  status={t(`home.status${statusFor(s.value, s.goal).replace(/^./, (c) => c.toUpperCase())}`)}
                  progress={s.value / s.goal}
                  icon={STAT_ICON[s.id]}
                />
              ))}
            </ScrollView>
            <View style={styles.demoRow}>
              <Icon name="flask-outline" size={13} color={colors.onGradientMuted} />
              <AppText size={11} color={colors.onGradientMuted}>{t('common.demoData')}</AppText>
            </View>
          </View>

          <View style={styles.gap}>
            <SectionHeader title={t('home.todaysWorkout')} action={t('home.workoutViewMore')} onAction={() => router.navigate('/workouts')} />
            <WorkoutCard workout={todayWorkout} onPlay={() => router.push({ pathname: '/workout/[id]', params: { id: todayWorkout.id } })} />
          </View>
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
  demoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { alignItems: 'center', gap: 6, padding: 24 },
  result: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
});
