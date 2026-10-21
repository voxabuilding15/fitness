import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { colors, radius } from '../theme';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { playSound } from '../services/soundService';

type IconName = React.ComponentProps<typeof Icon>['name'];

interface Props<T extends string> {
  items: { id: T; label: string; icon: IconName }[];
  value: T;
  onChange: (id: T) => void;
}

/** Row of pill selectors, one per metric. */
export function MetricSelector<T extends string>({ items, value, onChange }: Props<T>) {
  const narrow = useIsNarrow();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              playSound('tap');
              onChange(item.id);
            }}
            style={[styles.pill, narrow && styles.pillNarrow, active && styles.active]}
          >
            {!narrow ? <Icon name={item.icon} size={15} color={colors.dark} /> : null}
            <AppText size={12} weight={active ? 'semibold' : 'medium'} color={colors.dark} numberOfLines={1} style={styles.label}>
              {item.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  pill: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(11,59,58,0.45)',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  pillNarrow: { paddingHorizontal: 6 },
  active: { backgroundColor: colors.white, borderColor: colors.white },
  label: { flexShrink: 1 },
});
