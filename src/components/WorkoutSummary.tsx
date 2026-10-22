import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { GlassCard } from './GlassCard';
import { setSummary } from './SessionExerciseCard';
import { setsText } from './SessionNavigation';
import type { TrackingType } from '../domain/schemas/enums';
import type { SessionProgress } from '../domain/sessionProgress';
import type { SessionSummary } from '../domain/setEntry';
import { EFFORT_VALUES, type ExerciseResult } from '../domain/workoutResults';
import { colors, radius } from '../theme';

export interface SummaryRow {
  id: number;
  position: number;
  name: string;
  tracking: TrackingType;
  result: ExerciseResult;
  plannedSets: number | null;
}

interface Props {
  summary: SessionSummary;
  progress: SessionProgress;
  rows: SummaryRow[];
  rpe: number | null;
  busy: boolean;
  onEffort: (value: number | null) => void;
  onHome: () => void;
  onHistory: () => void;
}

/** What a finished workout amounted to, from its saved sets, and the way onward. Nothing here is estimated or compared with other workouts. */
export function WorkoutSummary({ summary, progress, rows, rpe, busy, onEffort, onHome, onHistory }: Props) {
  const { t } = useTranslation();
  const skipped = rows.filter((r) => r.result.loggedSets === 0);
  return (
    <>
      <GlassCard strong style={styles.card}>
        <AppText size={16} weight="semibold" color={colors.ink} accessibilityRole="header">{t('liveSession.summaryTitle')}</AppText>
        <AppText size={14} color={colors.ink}>{t('liveSession.summarySets', { count: summary.loggedSets })}</AppText>
        {progress.plannedSets !== null ? <AppText size={14} color={colors.ink}>{t('liveSession.progressSets', { done: summary.loggedSets, planned: progress.plannedSets })}</AppText> : null}
        <AppText size={14} color={colors.ink}>{t('liveSession.summaryExercises', { done: summary.exercisesWithSets, total: summary.exerciseCount })}</AppText>
        {summary.totalReps > 0 ? <AppText size={14} color={colors.ink}>{t('liveSession.summaryReps', { count: summary.totalReps })}</AppText> : null}
        {summary.volumeKg > 0 ? <AppText size={14} color={colors.ink}>{t('liveSession.summaryVolume', { kg: summary.volumeKg })}</AppText> : null}
        {summary.durationMin !== null ? <AppText size={14} color={colors.ink}>{t('liveSession.summaryTime', { minutes: summary.durationMin })}</AppText> : null}
        {skipped.length > 0 ? (
          <AppText size={13} color={colors.muted}>{t('liveSession.summaryNotDone', { names: skipped.map((r) => r.name).join(', ') })}</AppText>
        ) : null}
      </GlassCard>

      {rows.length > 0 ? (
        <GlassCard strong style={styles.card}>
          <AppText size={16} weight="semibold" color={colors.ink} accessibilityRole="header">{t('liveSession.summaryHighlights')}</AppText>
          {rows.map((r) => {
            const sets = setsText(t, { logged: r.result.loggedSets, planned: r.plannedSets, done: false });
            const best = r.result.best ? t('liveSession.summaryBest', { summary: setSummary(t, r.tracking, r.result.best) }) : null;
            const label = `${r.position}. ${r.name}. ${best ? `${best}. ` : ''}${sets}`;
            return (
              <View key={r.id} role="group" accessibilityLabel={label} style={styles.item}>
                <AppText size={14} weight="medium" color={colors.ink}>{`${r.position}. ${r.name}`}</AppText>
                <AppText size={12} color={colors.muted}>{best ? `${best} · ${sets}` : r.result.loggedSets === 0 ? t('liveSession.noSetsLogged') : sets}</AppText>
              </View>
            );
          })}
        </GlassCard>
      ) : null}

      <GlassCard strong style={styles.card}>
        <View role="group" accessibilityLabel={t('liveSession.effortTitle')} style={styles.item}>
          <AppText size={16} weight="semibold" color={colors.ink} accessibilityRole="header">{t('liveSession.effortTitle')}</AppText>
          <AppText size={12} color={colors.muted}>{rpe === null ? t('liveSession.effortHint') : t('liveSession.effortValue', { value: rpe })}</AppText>
          <View style={styles.chips}>
            {EFFORT_VALUES.map((v) => (
              <Pressable
                key={v}
                accessibilityRole="button"
                accessibilityLabel={t('liveSession.effortOption', { value: v })}
                accessibilityState={{ selected: rpe === v, disabled: busy }}
                disabled={busy}
                onPress={() => onEffort(rpe === v ? null : v)}
                style={[styles.chip, rpe === v && styles.chipOn]}
              >
                <AppText size={14} weight="medium" color={rpe === v ? colors.white : colors.dark} align="center">{String(v)}</AppText>
              </Pressable>
            ))}
          </View>
        </View>
      </GlassCard>

      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onHome} style={[styles.btn, styles.primary]}>
          <AppText size={14} weight="medium" color={colors.white} align="center">{t('liveSession.goHome')}</AppText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onHistory} style={[styles.btn, styles.ghost]}>
          <AppText size={14} weight="medium" color={colors.dark} align="center">{t('liveSession.goHistory')}</AppText>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 10 },
  item: { gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, minWidth: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.8)', paddingHorizontal: 8 },
  chipOn: { backgroundColor: colors.dark },
  actions: { gap: 10 },
  btn: { minHeight: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primary: { backgroundColor: colors.dark },
  ghost: { backgroundColor: 'rgba(255,255,255,0.8)' },
});
