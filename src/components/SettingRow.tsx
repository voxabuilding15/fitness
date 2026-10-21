import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { colors, radius } from '../theme';
import { playSound } from '../services/soundService';

type IconName = React.ComponentProps<typeof Icon>['name'];

interface Props {
  icon: IconName;
  label: string;
  value?: string;
  onPress?: () => void;
  expanded?: boolean;
  toggle?: { value: boolean; onChange: (v: boolean) => void };
}

/** Rounded settings row: circular icon · label · chevron or switch. */
export function SettingRow({ icon, label, value, onPress, toggle, expanded }: Props) {
  const content = (
    <>
      <View style={styles.iconCircle}>
        <Icon name={icon} size={18} color={colors.dark} />
      </View>
      <View style={styles.texts}>
        <AppText size={14} weight="medium" color={colors.ink} numberOfLines={1}>{label}</AppText>
        {value ? <AppText size={11} color={colors.muted} numberOfLines={1}>{value}</AppText> : null}
      </View>
      {toggle ? (
        <Switch
          accessibilityLabel={label}
          value={toggle.value}
          onValueChange={toggle.onChange}
          trackColor={{ false: '#9DB0AC', true: colors.dark }}
          thumbColor={colors.white}
          // @ts-expect-error react-native-web only: keeps the thumb white when on
          activeThumbColor={colors.white}
        />
      ) : (
        <Icon name={expanded ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.ink} />
      )}
    </>
  );

  if (toggle) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      onPress={() => {
        playSound('tap');
        onPress?.();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.7)' },
  iconCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.75)',
    alignItems: 'center', justifyContent: 'center',
  },
  texts: { flex: 1 },
});
