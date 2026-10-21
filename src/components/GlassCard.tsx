import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { colors, radius, shadow } from '../theme';

interface Props extends ViewProps {
  style?: StyleProp<ViewStyle>;
  strong?: boolean;
}

export function GlassCard({ style, strong, ...rest }: Props) {
  return <View {...rest} style={[styles.card, strong && styles.strong, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.glass,
    borderColor: colors.glassBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    ...shadow,
  },
  strong: { backgroundColor: colors.glassStrong },
});
