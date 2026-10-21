import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { MetricSelector } from '../components/MetricSelector';
import { Screen } from '../components/Screen';
import { SectionHeader } from '../components/SectionHeader';
import { WeeklyActivityChart } from '../components/WeeklyActivityChart';
import { errorMessageKey } from '../domain/errors';
import { summarizeSession } from '../domain/setEntry';
import { buildStats, type StatsMetric, type StatsPeriod } from '../domain/statistics';
import { formatNumber } from '../hooks/useFormat';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { useStatistics } from '../hooks/useStatistics';
import { announce } from '../services/accessibility';
import { playSound } from '../services/soundService';
import { useApp } from '../context/AppContext';
import { colors, endInset, radius } from '../theme';

const PERIODS: StatsPeriod[] = ['thisWeek', 'lastWeek', 'thisMonth'];
const METRICS: { id: StatsMetric; icon: React.ComponentProps<typeof Icon>['name'] }[] = [
  { id: 'workouts', icon: 'fitness-outline' },
  { id: 'volume', icon: 'barbell-outline' },
  { id: 'minutes', icon: 'time-outline' },
];

/** Statistics from the person's saved, finished workouts (no sample data): workouts, weight lifted and time per day or week. */
export default function StatisticsScreen() {
  const { t } = useTranslation();
  const { isRTL } = useApp();
  const narrow = useIsNarrow();
  const [metric, setMetric] = useState<StatsMetric>('workouts');
  const [period, setPeriod] = useState<StatsPeriod>('thisWeek');
  const [picked, setPicked] = useState<number | null>(null); // null = today's bucket
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { state, retry, retryDatabase } = useStatistics(period);

  const previous = useRef<string | null>(null);
  const problem = state.status === 'unavailable' ? t('stats.unavailable') : state.status === 'failed' ? `${t('stats.readFailed')} ${t(errorMessageKey(state.error))}` : '';
  useEffect(() => {
    const before = previous.current;
    if (before === state.status) return;
    previous.current = state.status;
    if (state.status === 'ready') {
      if (before === 'loading') announce(t('stats.loaded'));
    } else if (state.status !== 'loading') announce(problem);
  }, [state.status, problem, t]);

  const unitSuffix = metric === 'volume' ? ` ${t('stats.unitKg')}` : metric === 'minutes' ? ` ${t('stats.unitMin')}` : '';
  const fmt = (v: number) => `${formatNumber(v, 1)}${unitSuffix}`;

  const choosePeriod = (p: StatsPeriod) => {
    playSound('tap');
    setPeriod(p);
    setPicked(null);
    setPickerOpen(false);
  };
  const reset = () => {
    setMetric('workouts');
    setPeriod('thisWeek');
    setPicked(null);
    setMenuOpen(false);
  };

  const ready = state.status === 'ready' ? state : null;
  const series = ready ? buildStats(ready.window, ready.rows, metric) : null;
  const selected = ready ? Math.min(picked ?? ready.window.todayIndex, ready.window.buckets.length - 1) : 0;
  const labels = series ? series.points.map((p) => t(`days.${p.labelKey}`)) : [];
  const axisLabels = series ? series.points.map((p) => t(narrow && period !== 'thisMonth' ? `daysShort.${p.labelKey}` : `days.${p.labelKey}`)) : [];
  const latest = ready?.latest ? { session: ready.latest, summary: summarizeSession(ready.latest) } : null;

  return (
    <Screen>
      <AppHeader title={t('stats.title')} right={{ icon: 'ellipsis-horizontal', label: t('common.more'), onPress: () => setMenuOpen((v) => !v) }} />

      {menuOpen ? (
        <GlassCard strong style={styles.menu}>
          <Pressable accessibilityRole="menuitem" style={styles.menuItem} onPress={() => { setAboutOpen((v) => !v); setMenuOpen(false); }}>
            <Icon name="information-circle-outline" size={18} color={colors.dark} />
            <AppText size={14} color={colors.ink}>{t('stats.menuAbout')}</AppText>
          </Pressable>
          <Pressable accessibilityRole="menuitem" style={styles.menuItem} onPress={reset}>
            <Icon name="refresh-outline" size={18} color={colors.dark} />
            <AppText size={14} color={colors.ink}>{t('stats.menuReset')}</AppText>
          </Pressable>
        </GlassCard>
      ) : null}

      <GlassCard style={styles.outer}>
        <MetricSelector value={metric} onChange={setMetric} items={METRICS.map((m) => ({ id: m.id, icon: m.icon, label: t(`stats.metric.${m.id}`) }))} />

        <GlassCard strong style={styles.chartCard}>
          {state.status === 'loading' ? (
            <View style={styles.row}>
              <ActivityIndicator color={colors.dark} />
              <AppText size={13} color={colors.ink}>{t('stats.loading')}</AppText>
            </View>
          ) : null}

          {state.status === 'unavailable' || state.status === 'failed' ? (
            <View style={styles.problem}>
              <AppText size={13} color={colors.ink}>{problem}</AppText>
              <Pressable accessibilityRole="button" onPress={state.status === 'unavailable' ? retryDatabase : retry} style={styles.retry}>
                <AppText size={14} weight="medium" color={colors.dark} align="center">{t('stats.reload')}</AppText>
              </Pressable>
            </View>
          ) : null}

          {series ? (
            <>
              <View style={styles.summaryRow}>
                <View style={styles.flex}>
                  <AppText size={26} weight="semibold" color={colors.ink}>{fmt(series.total)}</AppText>
                  <AppText size={12} color={colors.muted}>{t(`stats.total.${metric}`)}</AppText>
                </View>
                <View style={styles.pickerWrap}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('stats.periodPicker')}
                    accessibilityState={{ expanded: pickerOpen }}
                    onPress={() => setPickerOpen((v) => !v)}
                    style={styles.picker}
                  >
                    <AppText size={12} weight="medium" color={colors.ink}>{t(`stats.period.${period}`)}</AppText>
                    <Icon name="chevron-down" size={14} color={colors.ink} />
                  </Pressable>
                </View>
              </View>
              {series.workouts === 0 ? <AppText size={12} color={colors.muted}>{t('stats.emptyPeriod')}</AppText> : null}

              <WeeklyActivityChart
                points={series.points}
                labels={labels}
                axisLabels={axisLabels}
                selectedIndex={selected}
                onSelect={setPicked}
                formatValue={fmt}
              />

              {pickerOpen ? (
                <View style={[styles.dropdown, endInset(isRTL, 14)]} accessibilityRole="menu">
                  {PERIODS.map((p) => (
                    <Pressable key={p} accessibilityRole="menuitem" onPress={() => choosePeriod(p)} style={[styles.option, p === period && styles.optionActive]}>
                      <AppText size={13} weight={p === period ? 'semibold' : 'regular'} color={p === period ? colors.white : colors.ink}>
                        {t(`stats.period.${p}`)}
                      </AppText>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </GlassCard>
      </GlassCard>

      {aboutOpen ? (
        <GlassCard strong style={styles.about}>
          <Icon name="information-circle-outline" size={18} color={colors.dark} />
          <AppText size={12} color={colors.ink} style={styles.flex}>{t('stats.aboutBody')}</AppText>
        </GlassCard>
      ) : null}

      {ready ? (
        <>
          <SectionHeader title={t('stats.recentWorkout')} action={t('common.seeAll')} onAction={() => router.push('/history')} />
          {latest ? (
            <GlassCard strong style={styles.latest}>
              <AppText size={18} weight="semibold" color={colors.ink} accessibilityRole="header">{latest.session.name}</AppText>
              <AppText size={12} color={colors.muted}>{latest.session.localDate}</AppText>
              <View style={styles.facts}>
                <View style={styles.fact}>
                  <AppText size={12} color={colors.muted}>{t('stats.latestSets')}</AppText>
                  <AppText size={18} weight="semibold" color={colors.ink}>{formatNumber(latest.summary.loggedSets)}</AppText>
                </View>
                <View style={styles.fact}>
                  <AppText size={12} color={colors.muted}>{t('stats.latestVolume')}</AppText>
                  <AppText size={18} weight="semibold" color={colors.ink}>{`${formatNumber(latest.summary.volumeKg, 1)} ${t('stats.unitKg')}`}</AppText>
                </View>
                <View style={styles.fact}>
                  <AppText size={12} color={colors.muted}>{t('stats.latestTime')}</AppText>
                  <AppText size={18} weight="semibold" color={colors.ink}>{`${formatNumber(latest.summary.durationMin ?? 0)} ${t('stats.unitMin')}`}</AppText>
                </View>
              </View>
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/session/[id]', params: { id: String(latest.session.id) } })} style={styles.retry}>
                <AppText size={14} weight="medium" color={colors.dark} align="center">{t('stats.openWorkout')}</AppText>
              </Pressable>
            </GlassCard>
          ) : (
            <GlassCard strong style={styles.latest}>
              <AppText size={13} color={colors.ink}>{t('stats.noLatest')}</AppText>
            </GlassCard>
          )}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  menu: { padding: 6, borderRadius: radius.md, alignSelf: 'flex-end', minWidth: 200, zIndex: 5 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 12 },
  outer: { padding: 12, gap: 12 },
  chartCard: { padding: 14, borderRadius: radius.lg, zIndex: 2 },
  summaryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  pickerWrap: { alignItems: 'flex-end' },
  picker: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.white,
    borderRadius: radius.pill, paddingHorizontal: 14, height: 34,
  },
  dropdown: {
    position: 'absolute', top: 58, backgroundColor: colors.white, borderRadius: 14, padding: 4,
    minWidth: 150, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  option: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
  optionActive: { backgroundColor: colors.dark },
  about: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  problem: { gap: 10 },
  retry: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: colors.white },
  latest: { padding: 16, gap: 8 },
  facts: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  fact: { flex: 1, minWidth: 90, gap: 2 },
});
