import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader } from '../components/AppHeader';
import { AppText } from '../components/AppText';
import { GlassCard } from '../components/GlassCard';
import { Icon } from '../components/Icon';
import { Screen } from '../components/Screen';
import { useApp } from '../context/AppContext';
import { getWorkout } from '../data/workouts';
import { useWorkoutSession } from '../hooks/useWorkoutSession';
import { playSound } from '../services/soundService';
import { adjustForLevel, formatClock, overlappingCautions } from '../services/workoutService';
import { colors, radius } from '../theme';
import type { Exercise } from '../types/workout';

function Button({ label, icon, onPress, variant = 'primary', disabled }: {
  label: string; icon: React.ComponentProps<typeof Icon>['name']; onPress: () => void;
  variant?: 'primary' | 'ghost'; disabled?: boolean;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        playSound('tap');
        onPress();
      }}
      style={({ pressed }) => [styles.btn, primary ? styles.btnPrimary : styles.btnGhost, disabled && styles.disabled, pressed && { opacity: 0.85 }]}
    >
      <Icon name={icon} size={18} color={primary ? colors.white : colors.dark} />
      <AppText size={14} weight="medium" color={primary ? colors.white : colors.dark} numberOfLines={1}>{label}</AppText>
    </Pressable>
  );
}

export default function WorkoutDetailsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const workout = getWorkout(String(id));
  const { t } = useTranslation();
  const { settings } = useApp();

  const exercises = useMemo(
    () => (workout ? workout.exercises.map((e) => adjustForLevel(e, settings.experience)) : []),
    [workout, settings.experience],
  );
  const { state, dispatch } = useWorkoutSession(exercises);

  if (!workout) {
    return (
      <Screen withNav={false}>
        <AppHeader title={t('tabs.workouts')} />
        <GlassCard strong style={styles.empty}>
          <AppText size={15} color={colors.ink} align="center">{t('workouts.notFound')}</AppText>
          <Button label={t('workouts.goHome')} icon="arrow-back" onPress={() => router.replace('/workouts')} />
        </GlassCard>
      </Screen>
    );
  }

  const amount = (e: Exercise) =>
    e.reps ? t('session.reps', { count: e.reps }) : t('session.seconds', { count: e.seconds });
  const current = exercises[state.exerciseIndex];
  const resting = state.restLeft > 0;
  const running = state.status === 'running';

  return (
    <Screen withNav={false}>
      <AppHeader title={t(`workouts.${workout.id}`)} />

      <GlassCard strong style={styles.timerCard}>
        <AppText size={12} color={colors.muted} align="center">{t('session.timer')}</AppText>
        <AppText size={44} weight="semibold" color={colors.ink} align="center" accessibilityLiveRegion="polite">
          {formatClock(state.elapsed)}
        </AppText>

        {state.status === 'idle' ? (
          <AppText size={13} color={colors.muted} align="center">{t('session.idleHint')}</AppText>
        ) : state.status === 'finished' ? (
          <View style={styles.centerCol}>
            <Icon name="trophy-outline" size={28} color={colors.dark} />
            <AppText size={16} weight="semibold" color={colors.ink} align="center">{t('session.finished')}</AppText>
            <AppText size={13} color={colors.muted} align="center">
              {t('session.finishedBody', { count: exercises.length, clock: formatClock(state.elapsed) })}
            </AppText>
          </View>
        ) : (
          <View style={styles.centerCol}>
            <AppText size={12} color={colors.muted} align="center">{t('session.current')}</AppText>
            <AppText size={18} weight="semibold" color={colors.ink} align="center">{t(`exercises.${current.id}`)}</AppText>
            <AppText size={13} color={colors.ink} align="center">
              {t('session.setOf', { current: state.setIndex + 1, total: current.sets })} · {amount(current)}
            </AppText>
            {resting ? (
              <View style={styles.restBadge}>
                <Icon name="hourglass-outline" size={14} color={colors.white} />
                <AppText size={12} weight="medium" color={colors.white}>{t('session.restLeft', { clock: formatClock(state.restLeft) })}</AppText>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.controls}>
          {state.status !== 'finished' ? (
            <Button
              label={running ? t('session.pause') : state.status === 'paused' ? t('session.resume') : t('session.start')}
              icon={running ? 'pause' : 'play'}
              onPress={() => dispatch({ type: 'TOGGLE' })}
            />
          ) : null}
          {running && !resting ? (
            <Button label={t('session.completeSet')} icon="checkmark" variant="ghost" onPress={() => dispatch({ type: 'COMPLETE_SET' })} />
          ) : null}
          {running && resting ? (
            <Button label={t('session.skipRest')} icon="play-skip-forward" variant="ghost" onPress={() => dispatch({ type: 'SKIP_REST' })} />
          ) : null}
          {state.status !== 'idle' ? (
            <Button label={t('session.reset')} icon="refresh" variant="ghost" onPress={() => dispatch({ type: 'RESET' })} />
          ) : null}
        </View>
      </GlassCard>

      <View style={styles.listHeader}>
        <AppText size={17} weight="medium" color={colors.onGradient}>{t('session.exercises')}</AppText>
        <AppText size={12} color={colors.onGradientMuted}>{t('session.levelNote', { level: t(`profile.levels.${settings.experience}`) })}</AppText>
      </View>

      {exercises.map((e, i) => {
        const active = state.status !== 'idle' && state.status !== 'finished' && i === state.exerciseIndex;
        const done = state.status === 'finished' || i < state.exerciseIndex;
        const cautions = overlappingCautions(e, settings.cautionAreas);
        return (
          <View key={e.id} style={[styles.exercise, active && styles.exerciseActive]}>
            <View style={[styles.index, done && styles.indexDone]}>
              {done ? <Icon name="checkmark" size={16} color={colors.white} /> : <AppText size={13} weight="semibold" color={colors.dark} align="center">{i + 1}</AppText>}
            </View>
            <View style={styles.flex}>
              <AppText size={14} weight="medium" color={colors.ink}>{t(`exercises.${e.id}`)}</AppText>
              <AppText size={12} color={colors.muted}>
                {t('session.setsReps', { sets: e.sets, amount: amount(e) })} · {t('session.rest', { count: e.restSec })}
              </AppText>
              {cautions.length ? (
                <View style={styles.caution}>
                  <Icon name="warning-outline" size={12} color="#8A4B00" />
                  <AppText size={11} color="#8A4B00">
                    {t('session.cautionBadge', { areas: cautions.map((a) => t(`profile.areas.${a}`)).join(', ') })}
                  </AppText>
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  empty: { padding: 24, gap: 16, alignItems: 'center' },
  timerCard: { padding: 18, gap: 6, alignItems: 'stretch' },
  centerCol: { alignItems: 'center', gap: 4, marginTop: 6 },
  restBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.dark, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, marginTop: 4 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, paddingHorizontal: 18, borderRadius: radius.pill },
  btnPrimary: { backgroundColor: colors.dark },
  btnGhost: { backgroundColor: colors.white },
  disabled: { opacity: 0.5 },
  listHeader: { gap: 2 },
  exercise: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.55)', borderWidth: 1, borderColor: 'transparent' },
  exerciseActive: { backgroundColor: 'rgba(255,255,255,0.9)', borderColor: colors.dark },
  index: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  indexDone: { backgroundColor: colors.dark },
  caution: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, backgroundColor: '#FFE9C7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
});
