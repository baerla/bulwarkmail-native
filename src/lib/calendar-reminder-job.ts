import { NativeModules, Platform } from 'react-native';

// The periodic job that refreshes the calendar reminders in the background
// (BulwarkCalendarReminderJobService, Android only): scheduled while reminders
// are on and someone is signed in, cancelled otherwise so a disabled feature
// never wakes the device.

interface CalendarReminderJobModule {
  scheduleCalendarReminderJob?: () => Promise<boolean>;
  cancelCalendarReminderJob?: () => Promise<void>;
}

/** Best effort: never throws, and does nothing off Android or in a build without the native methods. */
export async function setCalendarReminderJob(enabled: boolean): Promise<void> {
  if (Platform.OS !== 'android') return;
  const native = NativeModules.BulwarkFcm as CalendarReminderJobModule | undefined;
  try {
    if (enabled) await native?.scheduleCalendarReminderJob?.();
    else await native?.cancelCalendarReminderJob?.();
  } catch {
    // The foreground sync still keeps the reminders current while the app runs.
  }
}
