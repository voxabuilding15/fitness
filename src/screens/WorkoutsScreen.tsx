import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppText } from '../components/AppText';
import { Screen } from '../components/Screen';
import { WorkoutCard } from '../components/WorkoutCard';
import { WORKOUTS } from '../data/workouts';
import { colors, radius } from '../theme';

export default function WorkoutsScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <View>
        <AppText size={24} weight="semibold" color={colors.onGradient}>{t('workouts.title')}</AppText>
        <AppText size={13} color={colors.onGradientMuted}>{t('workouts.subtitle')}</AppText>
      </View>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('library.libraryLink')}
        accessibilityHint={t('library.libraryLinkHint')}
        onPress={() => router.push('/exercises')}
        style={styles.link}
      >
        <AppText size={14} weight="medium" color={colors.dark}>{t('library.libraryLink')}</AppText>
        <AppText size={11} color={colors.muted}>{t('library.libraryLinkHint')}</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('templates.link')}
        accessibilityHint={t('templates.linkHint')}
        onPress={() => router.push('/templates')}
        style={styles.link}
      >
        <AppText size={14} weight="medium" color={colors.dark}>{t('templates.link')}</AppText>
        <AppText size={11} color={colors.muted}>{t('templates.linkHint')}</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={t('history.link')}
        accessibilityHint={t('history.linkHint')}
        onPress={() => router.push('/history')}
        style={styles.link}
      >
        <AppText size={14} weight="medium" color={colors.dark}>{t('history.link')}</AppText>
        <AppText size={11} color={colors.muted}>{t('history.linkHint')}</AppText>
      </Pressable>
      <View style={styles.list}>
        {WORKOUTS.map((w) => (
          <WorkoutCard key={w.id} workout={w} onPlay={() => router.push({ pathname: '/workout/[id]', params: { id: w.id } })} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: 14 },
  link: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: 16, paddingVertical: 10, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.8)' },
});
