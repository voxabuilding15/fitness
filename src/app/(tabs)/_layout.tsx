import React from 'react';
import { Tabs } from 'expo-router/js-tabs';
import { BottomNavigation } from '../../components/BottomNavigation';

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomNavigation {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="workouts" />
      <Tabs.Screen name="statistics" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
