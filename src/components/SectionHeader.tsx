import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { colors } from '../theme';

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.row}>
      <AppText size={17} weight="medium" color={colors.onGradient}>{title}</AppText>
      {action ? (
        <Pressable accessibilityRole="link" hitSlop={10} onPress={onAction} style={({ pressed }) => pressed && styles.pressed}>
          <AppText size={13} color={colors.onGradientMuted}>{action}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pressed: { opacity: 0.6 },
});
