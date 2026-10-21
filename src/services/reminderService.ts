import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ReminderSettings } from '../types/settings';

export type ReminderResult = 'ok' | 'denied' | 'unsupported' | 'error';

/**
 * Schedules weekly local notifications for the chosen days/time.
 * Permission is requested only when the user turns reminders on.
 */
export async function syncReminders(
  reminders: ReminderSettings,
  text: { title: string; body: string },
): Promise<ReminderResult> {
  if (Platform.OS === 'web') return 'unsupported';
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if (!reminders.enabled || reminders.days.length === 0) return 'ok';

    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) return 'denied';

    for (const day of reminders.days) {
      await Notifications.scheduleNotificationAsync({
        content: { title: text.title, body: text.body },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: day + 1, // expo: 1 = Sunday … 7 = Saturday
          hour: reminders.hour,
          minute: reminders.minute,
        },
      });
    }
    return 'ok';
  } catch {
    return 'error';
  }
}
