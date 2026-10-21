import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { colors, radius } from '../theme';

type IconName = React.ComponentProps<typeof Icon>['name'];

interface Props {
  label: string;
  value: string;
  unit: string;
  status: string;
  progress: number; // 0..1
  icon: IconName;
}

const RING = 54;
const STROKE = 5;

/** Today's-stats tile: label, value + unit, status badge and an orange progress ring around an icon. */
export function StatCard({ label, value, unit, status, progress, icon }: Props) {
  const r = (RING - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.card} accessible accessibilityLabel={`${label}: ${value} ${unit}, ${status}`}>
      <AppText size={13} color={colors.ink} numberOfLines={1}>{label}</AppText>
      <AppText size={17} weight="semibold" color={colors.ink} numberOfLines={1}>
        {value} <AppText size={13} weight="medium" color={colors.ink}>{unit}</AppText>
      </AppText>
      <View style={styles.bottom}>
        <View style={styles.badge}>
          <AppText size={11} weight="medium" color={colors.white}>{status}</AppText>
        </View>
        <View style={styles.ringWrap}>
          <Svg width={RING} height={RING} style={styles.svg}>
            <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colors.accentSoft} strokeWidth={STROKE} fill="none" />
            <Circle
              cx={RING / 2} cy={RING / 2} r={r} stroke={colors.accent} strokeWidth={STROKE} fill="none"
              strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} rotation={-90} origin={`${RING / 2}, ${RING / 2}`}
            />
          </Svg>
          <View style={styles.iconCircle}>
            <Icon name={icon} size={20} color={colors.white} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 156,
    height: 142,
    padding: 14,
    borderRadius: radius.md,
    backgroundColor: colors.tile,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    justifyContent: 'space-between',
  },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  badge: { backgroundColor: colors.dark, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  svg: { position: 'absolute' },
  iconCircle: {
    width: RING - 16, height: RING - 16, borderRadius: (RING - 16) / 2,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
});
