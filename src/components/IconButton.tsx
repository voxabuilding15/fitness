import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from './Icon';
import { useApp } from '../context/AppContext';
import { colors, endInset } from '../theme';
import { playSound } from '../services/soundService';

type Name = React.ComponentProps<typeof Icon>['name'];

interface Props {
  icon: Name;
  label: string;
  onPress?: () => void;
  size?: number;
  badge?: boolean;
  iconColor?: string;
}

/** Round translucent icon button used in headers. */
export function IconButton({ icon, label, onPress, size = 44, badge, iconColor = colors.dark }: Props) {
  const { isRTL } = useApp();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        playSound('tap');
        onPress?.();
      }}
      style={({ pressed }) => [
        styles.btn,
        { width: size, height: size, borderRadius: size / 2 },
        pressed && styles.pressed,
      ]}
    >
      <Icon name={icon} size={size * 0.46} color={iconColor} />
      {badge ? <View style={[styles.badge, endInset(isRTL, 10)]} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.7)', transform: [{ scale: 0.96 }] },
  badge: {
    position: 'absolute',
    top: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5484D',
  },
});
