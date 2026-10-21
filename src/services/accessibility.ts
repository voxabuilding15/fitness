import { AccessibilityInfo } from 'react-native';

/**
 * Speaks `message` through the active screen reader (VoiceOver on iOS, TalkBack on Android); does nothing when no screen
 * reader is running. This one mechanism is used for status changes instead of `accessibilityLiveRegion`, which is
 * Android-only and would make TalkBack read the same text twice.
 */
export function announce(message: string): void {
  if (!message) return;
  try {
    AccessibilityInfo.announceForAccessibility(message);
  } catch {
    // an accessibility hint must never break the screen
  }
}
