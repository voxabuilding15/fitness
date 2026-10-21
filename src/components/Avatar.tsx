import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { colors } from '../theme';

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0] ?? '').join('').toUpperCase();

/** Placeholder avatar (initials) — no remote or copyrighted photo is bundled. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  return (
    <View style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      <AppText size={size * 0.36} weight="semibold" color={colors.white} align="center">
        {initials(name)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#2E6B66',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
