import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, NAV_HEIGHT } from '../theme';

interface Props {
  children: React.ReactNode;
  /** reserve space for the floating bottom navigation */
  withNav?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  scrollRef?: React.RefObject<ScrollView | null>;
  /** Keep focused text fields visible above the on-screen keyboard (for long forms). */
  avoidKeyboard?: boolean;
}

/**
 * How a form screen keeps its inputs above the keyboard:
 *  - iOS: the ScrollView adjusts its own insets and scrolls the focused field into view;
 *  - Android: a KeyboardAvoidingView (the window does not reliably resize on edge-to-edge Android);
 *  - elsewhere (web): nothing is needed.
 * Pure so it can be tested; the real keyboard behaviour needs a device.
 */
export function keyboardAvoidanceFor(os: string, enabled: boolean): { wrap: boolean; scrollProps: Partial<ScrollViewProps> } {
  if (!enabled) return { wrap: false, scrollProps: {} };
  if (os === 'ios') return { wrap: false, scrollProps: { automaticallyAdjustKeyboardInsets: true, keyboardDismissMode: 'interactive' } };
  if (os === 'android') return { wrap: true, scrollProps: { keyboardDismissMode: 'on-drag' } };
  return { wrap: false, scrollProps: {} };
}

/** Gradient background + safe-area aware scrolling container shared by every screen. */
export function Screen({ children, withNav = true, contentStyle, scrollRef, avoidKeyboard = false }: Props) {
  const insets = useSafeAreaInsets();
  const avoid = keyboardAvoidanceFor(Platform.OS, avoidKeyboard);
  const scroll = (
    <ScrollView
      {...avoid.scrollProps}
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
  );
  return (
    <View style={styles.root}>
      <LinearGradient colors={colors.gradient} locations={colors.gradientLocations} style={StyleSheet.absoluteFill} />
      {avoid.wrap ? <KeyboardAvoidingView style={styles.flex} behavior="padding">{scroll}</KeyboardAvoidingView> : scroll}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#6F8B86' },
  flex: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 16, width: '100%', maxWidth: 520, alignSelf: 'center' },
});
