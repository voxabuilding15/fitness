import React from 'react';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { colors } from '../theme';

interface Props {
  trace: number[];
  width: number;
  height: number;
}

/** Smooth area chart of a (sample) heart-rate trace with a marker on the last value. */
export function HeartRateWave({ trace, width, height }: Props) {
  if (trace.length < 2 || width <= 0) return null;
  const min = Math.min(...trace);
  const max = Math.max(...trace);
  const span = Math.max(1, max - min);
  const pad = 8;
  const pts = trace.map((v, i) => ({
    x: (i / (trace.length - 1)) * width,
    y: pad + (1 - (v - min) / span) * (height - pad * 2),
  }));
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const cx = (pts[i - 1].x + pts[i].x) / 2;
    d += ` C ${cx} ${pts[i - 1].y}, ${cx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`;
  }
  const area = `${d} L ${width} ${height} L 0 ${height} Z`;
  const marker = pts[Math.floor(pts.length * 0.7)];
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="hr" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#4C8C85" stopOpacity={0.85} />
          <Stop offset="1" stopColor="#4C8C85" stopOpacity={0.25} />
        </LinearGradient>
      </Defs>
      <Path d={area} fill="url(#hr)" />
      <Path d={d} stroke={colors.dark} strokeWidth={1.5} fill="none" />
      <Circle cx={marker.x} cy={marker.y} r={4} fill={colors.dark} />
    </Svg>
  );
}
