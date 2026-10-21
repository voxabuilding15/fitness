import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Screen } from '../components/Screen';
import { WorkoutCard } from '../components/WorkoutCard';
import { WORKOUTS } from '../data/workouts';
import { colors } from '../theme';

export default function WorkoutsScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <View>
        <AppText size={24} weight="semibold" color={colors.onGradient}>{t('workouts.title')}</AppText>
        <AppText size={13} color={colors.onGradientMuted}>{t('workouts.subtitle')}</AppText>
      </View>
      <View style={styles.list}>
        {WORKOUTS.map((w) => (
          <WorkoutCard key={w.id} workout={w} onPlay={() => router.push({ pathname: '/workout/[id]', params: { id: w.id } })} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ list: { gap: 14 } });
