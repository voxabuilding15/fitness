import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';
import { AppText } from './AppText';
import { colors, NAV_HEIGHT } from '../theme';
import { useIsNarrow } from '../hooks/useIsNarrow';
import { playSound } from '../services/soundService';

type IconName = React.ComponentProps<typeof Icon>['name'];

const ITEMS: { route: string; icon: IconName; labelKey: string }[] = [
  { route: 'index', icon: 'home', labelKey: 'tabs.home' },
  { route: 'workouts', icon: 'clipboard-outline', labelKey: 'tabs.workouts' },
  { route: 'statistics', icon: 'bar-chart', labelKey: 'tabs.statistics' },
  { route: 'profile', icon: 'person', labelKey: 'tabs.profile' },
];

/** Floating dark-teal pill with round white buttons; the active one expands to show its label. */
export function BottomNavigation({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const size = narrow ? 44 : SIZE;
  const activeName = state.routes[state.index].name;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 12), paddingHorizontal: narrow ? 10 : 20 }]}>
      <View style={styles.pill} accessibilityRole="tablist">
        {ITEMS.map((item) => {
          const focused = activeName === item.route;
          const label = t(item.labelKey);
          return (
            <Pressable
              key={item.route}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              onPress={() => {
                playSound('tap');
                if (!focused) navigation.navigate(item.route);
              }}
              style={({ pressed }) => [styles.item, { height: size, borderRadius: size / 2 }, focused ? styles.itemActive : { width: size }, pressed && styles.pressed]}
            >
              <Icon name={item.icon} size={20} color={colors.dark} />
              {focused ? (
                <AppText size={narrow ? 13 : 14} weight="semibold" color={colors.dark} numberOfLines={1}>
                  {label}
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const SIZE = 52;
const styles = StyleSheet.create({
  wrap: { position: 'absolute', start: 0, end: 0, alignItems: 'center', paddingHorizontal: 20 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: NAV_HEIGHT - 8,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: colors.dark,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    maxWidth: 420,
    width: '100%',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  item: {
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  itemActive: { flex: 1, paddingHorizontal: 12 },
  pressed: { opacity: 0.85 },
});
