import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ScheduledAlert } from './calendar-alert-scheduler';

// The reminder scheduling both the foreground sync (calendar-notifications)
// and the headless BulwarkCalendarReminders task run. Store-free on purpose:
// the headless task must not hydrate any store (CLAUDE.md, headless rule).

export const CHANNEL_ID = 'calendar-reminders';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HORIZON_MS = 7 * DAY_MS;
// The events loaded for the horizon: from a day back (an end-relative alert
// of an event that already started) to a week past it (alerts set up to a
// week before the start).
export const LOOKBEHIND_MS = DAY_MS;
export const LOOKAHEAD_MS = 7 * DAY_MS;
// iOS keeps at most 64 pending local notifications per app; leave room for
// the rest of the app.
export const MAX_SCHEDULED = 48;
export const DATA_TAG = 'bulwark-calendar-alert';

export type ReminderKind = 'event' | 'task';

// The language the Android channel was last named in; null until created.
let channelLocale: string | null = null;

export function alertKeyOf(request: Notifications.NotificationRequest): string | null {
  const data = request.content.data as { tag?: string; key?: string } | undefined;
  return data?.tag === DATA_TAG && typeof data.key === 'string' ? data.key : null;
}

export function reminderKindOf(request: Notifications.NotificationRequest): ReminderKind | null {
  if (alertKeyOf(request) === null) return null;
  const data = request.content.data as { kind?: unknown };
  return data.kind === 'task' ? 'task' : 'event';
}

// A reminder worded in another language than the app's now. Ones scheduled
// before reminders recorded their language count as current.
export function isStaleLanguage(request: Notifications.NotificationRequest, locale: string): boolean {
  const data = request.content.data as { locale?: unknown } | undefined;
  return typeof data?.locale === 'string' && data.locale !== locale;
}

// The channel's name shows in the system notification settings, so it is
// (re)named in the app language; setting an existing channel only renames it.
export async function ensureChannel(locale: string, t: (key: string, fallback: string) => string): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (channelLocale === locale) return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: t('calendar.notifications.channel_name', 'Calendar reminders'),
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  } catch {
    // Channel creation failing only degrades to the default channel.
  }
  channelLocale = locale;
}

export async function scheduleOne(alert: ScheduledAlert, locale: string, appAccountId?: string): Promise<void> {
  const data: Record<string, unknown> = {
    tag: DATA_TAG,
    key: alert.key,
    // The language the title and body are in, to reword it on a switch.
    locale,
    eventId: alert.eventId,
    kind: alert.kind,
    // Enough to find the event again when the reminder is tapped.
    serverId: alert.serverId,
    accountId: alert.accountId,
    recurrenceId: alert.recurrenceId,
    startMs: alert.startMs,
    appAccountId,
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  await Notifications.scheduleNotificationAsync({
    // Same key, same identifier: when the foreground sync and the headless
    // task race, the second schedule replaces the first instead of doubling it.
    identifier: `bulwark-cal:${alert.key}`,
    content: {
      title: alert.title,
      body: alert.body,
      sound: 'default',
      data,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(alert.fireTimeMs),
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
  });
}

/**
 * Cancel the pending reminders this code scheduled that are no longer wanted
 * and add the missing ones. `kinds` limits which pending reminders it may
 * touch: the background path passes ['event'], as it never loads tasks and
 * must not cancel the task reminders it didn't derive.
 */
export async function reconcileReminders(
  wanted: ScheduledAlert[],
  locale: string,
  opts: { kinds?: ReminderKind[]; appAccountId?: string } = {},
): Promise<void> {
  const inScope = (request: Notifications.NotificationRequest) => {
    const kind = reminderKindOf(request);
    return kind !== null && (!opts.kinds || opts.kinds.includes(kind));
  };
  const wantedByKey = new Map(wanted.map((a) => [a.key, a]));
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const present = new Set<string>();
  for (const request of pending) {
    if (!inScope(request)) continue;
    const key = alertKeyOf(request)!;
    if (wantedByKey.has(key) && !isStaleLanguage(request, locale)) {
      present.add(key);
    } else {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }
  for (const alert of wanted) {
    if (present.has(alert.key)) continue;
    try {
      await scheduleOne(alert, locale, opts.appAccountId);
    } catch {
      // A single bad trigger must not block the rest.
    }
  }
}

/** Cancel the calendar reminders this app scheduled (of the given kinds, else all). */
export async function cancelReminders(kinds?: ReminderKind[]): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((r) => {
          const kind = reminderKindOf(r);
          return kind !== null && (!kinds || kinds.includes(kind));
        })
        .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)),
    );
  } catch {
    // Nothing to do; the OS keeps whatever it has.
  }
}
