import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';

type Name = React.ComponentProps<typeof Ionicons>['name'];

const MIRRORED: Record<string, Name> = {
  'chevron-forward': 'chevron-back',
  'arrow-back': 'arrow-forward',
  'chevron-back': 'chevron-forward',
};

/** Ionicons wrapper that swaps directional glyphs in RTL layouts. */
export function Icon({ name, size = 20, color = '#0B3B3A' }: { name: Name; size?: number; color?: string }) {
  const { isRTL } = useApp();
  const resolved = isRTL && MIRRORED[name as string] ? MIRRORED[name as string] : name;
  return <Ionicons name={resolved} size={size} color={color} />;
}
