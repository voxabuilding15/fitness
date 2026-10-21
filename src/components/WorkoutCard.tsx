import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { WorkoutArt } from './WorkoutArt';
import { useApp } from '../context/AppContext';
import { colors, endInset, radius, shadow } from '../theme';
import { playSound } from '../services/soundService';
import type { Workout } from '../types/workout';

interface Props {
  workout: Workout;
  onPlay: () => void;
}

/** Large workout card: title, counts, calorie/time chips, artwork and the round play button. */
export function WorkoutCard({ workout, onPlay }: Props) {
  const { t } = useTranslation();
  const { isRTL } = useApp();
  const title = t(`workouts.${workout.id}`);
  const open = () => {
    playSound('tap');
    onPlay();
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${t('home.exercisesCount', { count: workout.exercises.length })}`}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.art, endInset(isRTL, -6)]} pointerEvents="none">
        <WorkoutArt />
      </View>
      <View style={styles.info}>
        <AppText size={20} weight="medium" color={colors.ink} style={styles.title}>{title}</AppText>
        <AppText size={13} color={colors.muted}>{t('home.exercisesCount', { count: workout.exercises.length })}</AppText>
        <View style={styles.chips}>
          <View style={styles.chip}>
            <Icon name="flame" size={13} color={colors.accent} />
            <AppText size={11} weight="medium" color={colors.ink}>{t('home.calChip', { value: workout.estimatedCalories })}</AppText>
          </View>
          <View style={styles.chip}>
            <Icon name="timer-outline" size={13} color={colors.dark} />
            <AppText size={11} weight="medium" color={colors.ink}>{t('home.minChip', { value: workout.estimatedMinutes })}</AppText>
          </View>
        </View>
      </View>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={t('home.playWorkout')}
        style={({ pressed }) => [styles.play, endInset(isRTL, 16), pressed && styles.pressed]}
      >
        <Icon name="play" size={18} color={colors.white} />
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 160,
    borderRadius: radius.lg,
    backgroundColor: '#C7D2CF',
    borderWidth: 1,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
    padding: 18,
    ...shadow,
  },
  pressed: { opacity: 0.9 },
  art: { position: 'absolute', bottom: -8 },
  info: { maxWidth: '68%', gap: 4 },
  title: { lineHeight: 26 },
  chips: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.white,
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: radius.pill,
  },
  play: {
    position: 'absolute', bottom: 14, width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center',
  },
});
