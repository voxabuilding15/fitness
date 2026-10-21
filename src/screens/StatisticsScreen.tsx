import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { HeartRateWave } from '../components/HeartRateWave';
import { Icon } from '../components/Icon';
import { MetricSelector } from '../components/MetricSelector';
import { Screen } from '../components/Screen';
import { SectionHeader } from '../components/SectionHeader';
import { WeeklyActivityChart } from '../components/WeeklyActivityChart';
import { formatNumber } from '../hooks/useFormat';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { DAILY_STEP_GOAL, activityProvider, defaultSelectedIndex } from '../services/activityService';
import { playSound } from '../services/soundService';
import { useApp } from '../context/AppContext';
import { colors, endInset, radius } from '../theme';
import type { MetricId, PeriodId } from '../types/activity';

const PERIODS: PeriodId[] = ['thisWeek', 'lastWeek', 'thisMonth'];
const METRICS: MetricId[] = ['steps', 'heartRate', 'regularity'];

export default function StatisticsScreen() {
  const { t } = useTranslation();
  const { isRTL } = useApp();
  const narrow = useIsNarrow();
  const [metric, setMetric] = useState<MetricId>('steps');
  const [period, setPeriod] = useState<PeriodId>('thisWeek');
  const [selected, setSelected] = useState(defaultSelectedIndex('thisWeek'));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [waveWidth, setWaveWidth] = useState(0);

  const series = useMemo(() => activityProvider.getSeries(metric, period), [metric, period]);
  const recent = useMemo(() => activityProvider.getRecentWorkout(), []);
  const labels = series.points.map((p) => t(`days.${p.labelKey}`));
  // weekly bars get 3-letter labels on very small screens; monthly bars (W1…) are already short
  const axisLabels = series.points.map((p) => t(narrow && period !== 'thisMonth' ? `daysShort.${p.labelKey}` : `days.${p.labelKey}`));

  const unitSuffix = metric === 'regularity' ? '%' : metric === 'heartRate' ? ` ${t('common.bpm')}` : '';
  const fmt = (v: number) => `${formatNumber(v)}${unitSuffix}`;

  const choosePeriod = (p: PeriodId) => {
    playSound('tap');
    setPeriod(p);
    setSelected(defaultSelectedIndex(p));
    setPickerOpen(false);
  };
  const reset = () => {
    setMetric('steps');
    setPeriod('thisWeek');
    setSelected(defaultSelectedIndex('thisWeek'));
    setMenuOpen(false);
  };

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
        <MetricSelector
          value={metric}
          onChange={(m) => setMetric(m)}
          items={METRICS.map((id) => ({ id, label: t(`stats.metric.${id}`) }))}
        />

        <GlassCard strong style={styles.chartCard}>
          <View style={styles.summaryRow}>
            <View style={styles.flex}>
              <AppText size={26} weight="semibold" color={colors.ink}>{fmt(series.average)}</AppText>
              <AppText size={12} color={colors.muted}>{t(`stats.avg.${metric}`)}</AppText>
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

          <WeeklyActivityChart
            points={series.points}
            labels={labels}
            axisLabels={axisLabels}
            selectedIndex={selected}
            onSelect={setSelected}
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
        </GlassCard>
      </GlassCard>

      {aboutOpen ? (
        <GlassCard strong style={styles.about}>
          <Icon name="information-circle-outline" size={18} color={colors.dark} />
          <AppText size={12} color={colors.ink} style={styles.flex}>
            {t('common.demoNote')} {t('stats.aboutBody', { goal: formatNumber(DAILY_STEP_GOAL) })}
          </AppText>
        </GlassCard>
      ) : null}

      <SectionHeader title={t('stats.recentWorkout')} action={t('common.seeAll')} onAction={() => router.navigate('/workouts')} />
      <View style={styles.recent}>
        <View style={[styles.tile, styles.hrCard]} onLayout={(e) => setWaveWidth(e.nativeEvent.layout.width)}>
          <View style={styles.hrBadge}>
            <Icon name="heart-outline" size={18} color={colors.dark} />
          </View>
          <View style={styles.wave}>
            <HeartRateWave trace={recent.heartRateTrace} width={waveWidth} height={90} />
          </View>
          <View style={styles.hrText}>
            <AppText size={13} color={colors.ink}>{t('stats.heartRate')}</AppText>
            <AppText size={22} weight="semibold" color={colors.ink}>
              {recent.heartRateBpm} <AppText size={12} color={colors.ink}>{t('common.bpm')}</AppText>
            </AppText>
          </View>
        </View>
        <View style={styles.rightCol}>
          <View style={[styles.tile, styles.small]}>
            <View style={styles.smallBadge}><Icon name="flame" size={16} color={colors.accent} /></View>
            <AppText size={13} color={colors.ink}>{t('stats.calories')}</AppText>
            <AppText size={18} weight="semibold" color={colors.ink}>
              {recent.calories} <AppText size={11} color={colors.ink}>{t('common.kcal')}</AppText>
            </AppText>
          </View>
          <View style={[styles.tile, styles.small]}>
            <View style={styles.smallBadge}><Icon name="alarm-outline" size={16} color={colors.dark} /></View>
            <AppText size={13} color={colors.ink}>{t('stats.duration')}</AppText>
            <AppText size={18} weight="semibold" color={colors.ink}>
              {recent.durationMinutes} <AppText size={11} color={colors.ink}>{t('stats.minutes')}</AppText>
            </AppText>
          </View>
        </View>
      </View>
      <View style={styles.demoRow}>
        <Icon name="flask-outline" size={13} color={colors.onGradientMuted} />
        <AppText size={11} color={colors.onGradientMuted}>{t('common.demoData')}</AppText>
      </View>
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
  recent: { flexDirection: 'row', gap: 12, height: 250 },
  tile: { backgroundColor: '#B7C6C3', borderRadius: radius.lg, borderWidth: 1, borderColor: colors.glassBorder, overflow: 'hidden' },
  hrCard: { flex: 1.05, padding: 14, justifyContent: 'space-between' },
  hrBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  wave: { position: 'absolute', start: 0, end: 0, top: 70 },
  hrText: { gap: 2, zIndex: 2 },
  rightCol: { flex: 1, gap: 12 },
  small: { flex: 1, padding: 12, justifyContent: 'center', gap: 4, backgroundColor: '#C3CFCC' },
  smallBadge: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  demoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
