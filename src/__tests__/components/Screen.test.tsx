/* eslint-disable @typescript-eslint/no-require-imports -- react-test-renderer ships with jest-expo (a transitive dev dependency) */
/**
 * Keyboard avoidance of the shared Screen. This checks WHICH mechanism is requested per platform; it cannot show that
 * the keyboard really stops covering a field. That needs an iOS / Android device or simulator.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text } from 'react-native';
import { Screen, keyboardAvoidanceFor } from '../../components/Screen';

jest.setTimeout(30_000); // the first render pays for loading react-native; parallel coverage runs can exceed the 5 s default

const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

jest.mock('expo-linear-gradient', () => ({ LinearGradient: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const render = (os: string, props: { avoidKeyboard?: boolean } = {}) => {
  const restore = jest.replaceProperty(Platform, 'OS', os as never);
  let tree: any;
  act(() => { tree = TestRenderer.create(<Screen {...props}><Text>child</Text></Screen>); });
  restore.restore();
  return tree;
};
const scroll = (tree: any) => tree.root.findByType(ScrollView);
const kav = (tree: any) => tree.root.findAllByType(KeyboardAvoidingView);

describe('keyboardAvoidanceFor', () => {
  it('does nothing unless asked', () => {
    for (const os of ['ios', 'android', 'web']) expect(keyboardAvoidanceFor(os, false)).toEqual({ wrap: false, scrollProps: {} });
  });
  it('iOS: the scroll view adjusts its own insets; Android: a KeyboardAvoidingView; web: nothing', () => {
    expect(keyboardAvoidanceFor('ios', true)).toEqual({ wrap: false, scrollProps: { automaticallyAdjustKeyboardInsets: true, keyboardDismissMode: 'interactive' } });
    expect(keyboardAvoidanceFor('android', true)).toEqual({ wrap: true, scrollProps: { keyboardDismissMode: 'on-drag' } });
    expect(keyboardAvoidanceFor('web', true)).toEqual({ wrap: false, scrollProps: {} });
  });
});

describe('Screen', () => {
  it('iOS with avoidKeyboard: the scroll view adjusts for the keyboard and there is no second wrapper (no double adjustment)', () => {
    const t = render('ios', { avoidKeyboard: true });
    expect(scroll(t).props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(scroll(t).props.keyboardShouldPersistTaps).toBe('handled'); // taps on buttons still work with the keyboard open
    expect(kav(t)).toHaveLength(0);
  });
  it('Android with avoidKeyboard: the scroll view is inside a KeyboardAvoidingView with padding', () => {
    const t = render('android', { avoidKeyboard: true });
    expect(kav(t)).toHaveLength(1);
    expect(kav(t)[0].props.behavior).toBe('padding');
    expect(kav(t)[0].findByType(ScrollView)).toBeTruthy();
    expect(scroll(t).props.automaticallyAdjustKeyboardInsets).toBeUndefined();
  });
  it('every other screen is unchanged: no avoidance props and no wrapper on any platform', () => {
    for (const os of ['ios', 'android', 'web']) {
      const t = render(os);
      expect(kav(t)).toHaveLength(0);
      expect(scroll(t).props.automaticallyAdjustKeyboardInsets).toBeUndefined();
      expect(scroll(t).props.keyboardDismissMode).toBeUndefined();
      expect(t.root.findAllByType(Text).map((n: any) => n.props.children)).toContain('child');
    }
  });
});
