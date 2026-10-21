import React from 'react';
import { ActivityIndicator, I18nManager, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import {
  Poppins_300Light, Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import {
  Cairo_300Light, Cairo_400Regular, Cairo_500Medium, Cairo_600SemiBold, Cairo_700Bold,
} from '@expo-google-fonts/cairo';
import '../i18n';
import { AppProvider, useApp } from '../context/AppContext';
import { colors } from '../theme';

// Layout direction is driven by the root view below, so don't let the OS locale flip it implicitly.
I18nManager.allowRTL(false);

function Shell() {
  const { ready, isRTL } = useApp();
  const [fontsLoaded, fontError] = useFonts({
    Poppins_300Light, Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold,
    Cairo_300Light, Cairo_400Regular, Cairo_500Medium, Cairo_600SemiBold, Cairo_700Bold,
  });

  if (!ready || (!fontsLoaded && !fontError)) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.white} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { direction: isRTL ? 'rtl' : 'ltr' }]}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#6F8B86' } }} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#6F8B86' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
