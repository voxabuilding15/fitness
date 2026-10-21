import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppText } from './AppText';
import { GlassCard } from './GlassCard';
import { colors } from '../theme';

/** What the exercise hints can and cannot check, in plain words (see `useRecommendations().limits`). Renders nothing without lines. */
export function HintsCard({ lines }: { lines: string[] }) {
  const { t } = useTranslation();
  if (lines.length === 0) return null;
  return (
    <GlassCard strong style={styles.card}>
      <View role="group" accessibilityLabel={t('recs.limitsTitle')} style={styles.body}>
        <AppText size={12} weight="medium" color={colors.ink} accessibilityRole="header">{t('recs.limitsTitle')}</AppText>
        {lines.map((l) => <AppText key={l} size={12} color={colors.muted}>{l}</AppText>)}
      </View>
    </GlassCard>
  );
}

/** The short per-exercise hint lines under a name. */
export function HintLines({ lines }: { lines: string[] }) {
  return <>{lines.map((l) => <AppText key={l} size={11} color={colors.dark}>{l}</AppText>)}</>;
}

const styles = StyleSheet.create({ card: { padding: 12 }, body: { gap: 4 } });
