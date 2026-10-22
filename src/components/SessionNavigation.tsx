import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { GlassCard } from './GlassCard';
import type { ExerciseProgress, SessionProgress } from '../domain/sessionProgress';
import { colors, radius } from '../theme';

/** A thin filled bar. `ratio` is 0..1; the visible text next to it says the same thing in words. */
export function Bar({ ratio, tint = colors.dark }: { ratio: number; tint?: string }) {
  return (
    <View style={styles.track} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={[styles.fill, { width: `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`, backgroundColor: tint }]} />
    </View>
  );
}

/** Sets and exercises done so far in the running workout. */
export function ProgressCard({ progress }: { progress: SessionProgress }) {
  const { t } = useTranslation();
  const sets = progress.plannedSets === null ? t('liveSession.progressSetsOnly', { done: progress.loggedSets }) : t('liveSession.progressSets', { done: progress.loggedSets, planned: progress.plannedSets });
  const exercises = t('liveSession.summaryExercises', { done: progress.exercisesDone, total: progress.exerciseCount });
  return (
    <GlassCard strong style={styles.card}>
      <View role="group" accessibilityLabel={`${sets}. ${exercises}`} style={styles.body}>
        <AppText size={14} weight="medium" color={colors.ink}>{sets}</AppText>
        <AppText size={12} color={colors.muted}>{exercises}</AppText>
        {progress.ratio !== null ? <Bar ratio={progress.ratio} /> : null}
      </View>
    </GlassCard>
  );
}

export interface StripItem { id: number; position: number; name: string; progress: ExerciseProgress; active: boolean }

/** `Sets 2 of 3` / `Sets logged 2`, in words. */
export function setsText(t: (k: string, o?: Record<string, string | number>) => string, p: ExerciseProgress): string {
  return p.planned === null ? t('liveSession.exSetsOnly', { logged: p.logged }) : t('liveSession.exSets', { logged: p.logged, planned: p.planned });
}

/** One numbered chip per exercise to jump to it; finished ones are marked, the current one is selected. Logged sets are never touched by moving around. */
export function ExerciseStrip({ items, onSelect }: { items: StripItem[]; onSelect: (id: number) => void }) {
  const { t } = useTranslation();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip} accessibilityRole="tablist">
      {items.map((i) => (
        <Pressable
          key={i.id}
          accessibilityRole="tab"
          accessibilityState={{ selected: i.active }}
          accessibilityLabel={[t('liveSession.exerciseNav', { position: i.position, total: items.length, name: i.name }), setsText(t, i.progress), ...(i.progress.done ? [t('liveSession.exDone')] : [])].join(', ')}
          onPress={() => onSelect(i.id)}
          style={[styles.chip, i.active && styles.chipActive, i.progress.done && !i.active && styles.chipDone]}
        >
          <AppText size={13} weight={i.active ? 'semibold' : 'medium'} color={i.active ? colors.white : colors.ink}>{`${i.position}${i.progress.done ? ' ✓' : ''}`}</AppText>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** An exercise that is not the current one: its name and progress on one line; pressing it makes it the current one. */
export function CompactExerciseRow({ item, total, onSelect }: { item: StripItem; total: number; onSelect: (id: number) => void }) {
  const { t } = useTranslation();
  const sets = setsText(t, item.progress);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[t('liveSession.exerciseNav', { position: item.position, total, name: item.name }), sets, ...(item.progress.done ? [t('liveSession.exDone')] : [])].join(', ')}
      onPress={() => onSelect(item.id)}
      style={styles.compact}
    >
      <AppText size={14} weight="medium" color={colors.ink} style={styles.flex} numberOfLines={1}>{`${item.position}. ${item.name}`}</AppText>
      <AppText size={12} color={colors.muted}>{`${sets}${item.progress.done ? ' ✓' : ''}`}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { padding: 14 },
  body: { gap: 6 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(11,59,58,0.15)', overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  strip: { gap: 8, paddingVertical: 2 },
  chip: { minHeight: 44, minWidth: 44, borderRadius: radius.pill, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.8)' },
  chipActive: { backgroundColor: colors.dark },
  chipDone: { backgroundColor: 'rgba(255,255,255,0.55)' },
  compact: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.7)' },
});
