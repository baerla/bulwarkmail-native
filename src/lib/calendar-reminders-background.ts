import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { getCalendars } from '../api/calendar';
import { CAPABILITIES } from '../api/types';
import { translate } from '../i18n';
import { useSettingsStore } from '../stores/settings-store';
import { openClient } from '../widgets/jmap';
import { getUpcomingAlerts, type AlertTranslate } from './calendar-alert-scheduler';
import { loadEventsInRange } from './calendar-events-range';
import { readRemindedOnDevice } from './calendar-reminder-owner';
import {
  HORIZON_MS,
  LOOKAHEAD_MS,
  LOOKBEHIND_MS,
  MAX_SCHEDULED,
  cancelReminders,
  ensureChannel,
  reconcileReminders,
  withReminderLock,
} from './calendar-reminder-reconcile';
import { ACCOUNT_REGISTRY_KEY, SETTINGS_STORAGE_KEY, notificationLocale } from './push-background-task';

// Brings the scheduled event reminders up to date without the app UI: run as
// the headless task BulwarkCalendarReminders when a calendar push arrives and
// from a 6-hourly job, so an event created or moved elsewhere gets its
// reminder, and the 7-day horizon keeps moving, while the app stays closed.
//
// Like every headless path (CLAUDE.md) it reads the persisted settings and
// account registry itself and talks to the server with a detached client,
// never the stores or the `jmapClient` singleton. It serves the active
// account only, as the foreground sync does, and touches only reminders of
// events: tasks come from the store, which is not loaded here.

async function readCalendarNotificationsEnabled(): Promise<boolean | null> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return true; // first launch: the setting's default is on
    const state = (JSON.parse(raw) as { calendarNotificationsEnabled?: unknown });
    return state.calendarNotificationsEnabled !== false;
  } catch {
    return null;
  }
}

async function readActiveAccountId(): Promise<string | null | undefined> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_REGISTRY_KEY);
    if (!raw) return null;
    const id = (JSON.parse(raw) as { state?: { activeAccountId?: unknown } }).state?.activeAccountId;
    return typeof id === 'string' && id ? id : null;
  } catch {
    // Can't tell who is signed in: leave the reminders as they are.
    return undefined;
  }
}

/** Always resolves; every failure leaves the pending reminders as they were. */
export function refreshCalendarRemindersInBackground(): Promise<void> {
  return withReminderLock(refresh);
}

async function refresh(): Promise<void> {
  try {
    // The queries are sent in the calendar time zone setting (lib/calendar-timezone
    // reads it from this store), which a cold headless runtime has not loaded;
    // without it floating and all-day events would get other fire times than
    // the foreground gives them.
    const settings = useSettingsStore.getState();
    if (!settings.hydrated) await settings.hydrate();
    const enabled = await readCalendarNotificationsEnabled();
    // Unreadable settings: the foreground decides next time it runs.
    if (enabled === null) return;
    const accountId = await readActiveAccountId();
    if (accountId === undefined) return;
    if (!enabled || !accountId) {
      await cancelReminders(['event']);
      return;
    }
    // Never prompt from the background.
    if (!(await Notifications.getPermissionsAsync()).granted) return;

    // null: offline, or no usable credentials. Keep what is scheduled.
    const client = await openClient(accountId);
    if (!client) return;
    if (!(CAPABILITIES.CALENDARS in (client.currentSession?.capabilities ?? {}))) {
      await cancelReminders(['event']);
      return;
    }
    const calendars = await getCalendars(client);
    if (calendars.length === 0) return;

    const now = Date.now();
    const events = await loadEventsInRange(
      calendars,
      calendars.map((c) => c.id),
      new Date(now - LOOKBEHIND_MS).toISOString(),
      new Date(now + HORIZON_MS + LOOKAHEAD_MS).toISOString(),
      client,
    );
    // Events of calendars synced to the device get their reminders from the
    // device's calendar app when the user chose it to remind them (#34).
    const onDevice = await readRemindedOnDevice(accountId, client.accountId);
    const own = onDevice ? events.filter((event) => !onDevice(event)) : events;

    const locale = await notificationLocale();
    const t: AlertTranslate = (key, fallback, params) => translate(locale, key, fallback, params);
    await ensureChannel(locale, t);
    const wanted = getUpcomingAlerts(own, [], calendars, {
      now,
      horizonMs: HORIZON_MS,
      limit: MAX_SCHEDULED,
    }, t);
    await reconcileReminders(wanted, locale, { kinds: ['event'], appAccountId: accountId });
  } catch (err) {
    console.warn('[calendar-reminders] background refresh failed', err);
  }
}
