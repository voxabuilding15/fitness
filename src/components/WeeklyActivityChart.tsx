import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { colors } from '../theme';
import { playSound } from '../services/soundService';
import type { ChartPoint } from '../types/activity';

interface Props {
  points: ChartPoint[];
  labels: string[];
  /** compact labels for the axis; falls back to `labels` */
  axisLabels?: string[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  formatValue: (v: number) => string;
  height?: number;
}

/** Bar chart built from structured data: dark-teal selected bar, light bars for the rest. */
export function WeeklyActivityChart({ points, labels, axisLabels = labels, selectedIndex, onSelect, formatValue, height = 190 }: Props) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const BUBBLE = 26;
  const plot = height - BUBBLE - 26; // room for value bubble and axis labels

  return (
    <View style={{ height }} accessibilityRole="adjustable">
      <View style={styles.bars}>
        {points.map((p, i) => {
          const selected = i === selectedIndex;
          const h = Math.max(18, (p.value / max) * plot);
          return (
            <Pressable
              key={p.labelKey}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${labels[i]}: ${formatValue(p.value)}`}
              onPress={() => {
                playSound('tap');
                onSelect(i);
              }}
              style={styles.col}
            >
              <View style={{ height: BUBBLE, justifyContent: 'center' }}>
                {selected ? (
                  <View style={styles.bubble}>
                    <AppText size={11} weight="semibold" color={colors.white}>{formatValue(p.value)}</AppText>
                  </View>
                ) : null}
              </View>
              <View style={styles.track}>
                <View style={[styles.bar, { height: h }, selected ? styles.barSelected : styles.barIdle]} />
              </View>
              <AppText size={10} weight={selected ? 'semibold' : 'regular'} color={colors.ink} align="center" numberOfLines={1} style={styles.axis}>
                {axisLabels[i]}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'stretch' },
  col: { flex: 1, alignItems: 'center' },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 14, borderTopRightRadius: 14, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  barIdle: { backgroundColor: colors.barIdle, borderWidth: 1, borderColor: 'rgba(11,59,58,0.12)' },
  barSelected: { backgroundColor: colors.dark },
  bubble: { backgroundColor: colors.dark, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  axis: { marginTop: 6, width: '100%' },
});
