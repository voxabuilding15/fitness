import React from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, NAV_HEIGHT } from '../theme';

interface Props {
  children: React.ReactNode;
  /** reserve space for the floating bottom navigation */
  withNav?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scrollRef?: React.RefObject<ScrollView | null>;
}

/** Gradient background + safe-area aware scrolling container shared by every screen. */
export function Screen({ children, withNav = true, contentStyle, scrollRef }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <LinearGradient colors={colors.gradient} locations={colors.gradientLocations} style={StyleSheet.absoluteFill} />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 12,
            paddingBottom: (withNav ? NAV_HEIGHT + 28 : 24) + insets.bottom,
          },
          contentStyle,
        ]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#6F8B86' },
  content: { paddingHorizontal: 20, gap: 16, width: '100%', maxWidth: 520, alignSelf: 'center' },
});
