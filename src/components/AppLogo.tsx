import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

/** Dotted fitness-style mark from the design: a small grid of dots forming a chevron. */
export function AppLogo({ size = 46 }: { size?: number }) {
  const dots: [number, number, number][] = [
    [2, 0, 3], [1, 1, 4], [0, 2, 5], [1, 3, 4], [2, 4, 3], [3, 1, 3], [3, 3, 3], [4, 2, 4],
  ];
  return (
    <View style={{ width: size, height: size, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size * 0.6} height={size * 0.6} viewBox="0 0 50 50">
        {dots.map(([cx, cy, r], i) => (
          <Circle key={i} cx={6 + cx * 9.5} cy={6 + cy * 9.5} r={r} fill="#FFFFFF" />
        ))}
      </Svg>
    </View>
  );
}
