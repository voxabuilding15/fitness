import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Neutral vector placeholder of an athlete (back view) — used instead of a remote photo. */
export function WorkoutArt({ width = 150, height = 150 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 150 150" accessibilityElementsHidden>
      <Rect x="0" y="0" width="150" height="150" fill="none" />
      <Circle cx="78" cy="30" r="17" fill="#3B3F43" />
      <Path d="M62 40 Q78 52 94 40 L96 52 Q78 60 60 52 Z" fill="#C79A83" />
      <Path d="M30 150 Q34 92 52 70 Q66 58 78 58 Q92 58 106 70 Q124 92 128 150 Z" fill="#23272B" />
      <Path d="M52 70 Q38 78 30 100 L22 132 Q28 136 36 132 L52 100 Z" fill="#D4A58D" />
      <Path d="M106 70 Q120 78 128 100 L136 132 Q130 136 122 132 L106 100 Z" fill="#D4A58D" />
      <Path d="M62 74 L78 96 L94 74" stroke="#4A4F54" strokeWidth="3" fill="none" />
      <Path d="M78 62 L78 150" stroke="#4A4F54" strokeWidth="2.5" />
    </Svg>
  );
}
