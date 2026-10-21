import React from 'react';
import { Image } from 'react-native';

/** App logo shown in the Home header. */
export function AppLogo({ size = 46 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/logo.png')}
      accessibilityIgnoresInvertColors
      accessible={false}
      style={{ width: size, height: size, borderRadius: size * 0.3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)' }}
    />
  );
}
