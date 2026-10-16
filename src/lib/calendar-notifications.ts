import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { CalendarEvent } from '../api/types';
import { jmapClient } from '../api/jmap-client';
import { useAuthStore } from '../stores/auth-store';
import { loadEventsInRange, useCalendarStore } from '../stores/calendar-store';
import { useSettingsStore } from '../stores/settings-store';
import { useLocaleStore } from '../stores/locale-store';
import { hasCalendarCapability } from './capabilities';
import { onStateChangeType } from './state-change-bus';
import { getUpcomingAlerts, type ScheduledAlert } from './calendar-alert-scheduler';
import type { CalendarReminderTarget } from '../navigation/pending-calendar-open';
import { onDeviceRemindersChange, remindedOnDevice } from '../device-sync/app/reminders';
import { refreshPushSubscriptionTypes } from './push-notifications';
import {
  HORIZON_MS,
  LOOKAHEAD_MS,
  LOOKBEHIND_MS,
  MAX_SCHEDULED,
  alertKeyOf,
  cancelReminders,
  ensureChannel,
  reconcileReminders,
} from './calendar-reminder-reconcile';

// Local reminders for calendar events and tasks. The webmail polls
// `getPendingAlerts` every minute while a tab is open; a phone is mostly
// asleep, so instead we schedule OS-level local notifications for the alerts
// that fall due in the next few days and cancel the ones that no longer
// apply. The events come from their own upcoming window, not from the month
// the calendar happens to show, and the sync runs from launch, so reminders
// don't depend on the Calendar tab being open. Honours the
// `calendarNotificationsEnabled` setting.

let permissionGranted = false;
let permissionRequested = false;
// Only the Calendar tab asks for notification permission; the launch-time
// sync uses what was granted and never prompts out of the blue.
let mayAskPermission = false;
let rescheduleTimer: ReturnType<typeof setTimeout> | null = null;
let rescheduling: Promise<void> | null = null;
let queued = false;
let syncStarted = false;
let tasksLoadedFor: string | null = null;

function isGranted(status: Notifications.NotificationPermissionsStatus): boolean {
  return status.granted || status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

async function ensurePermission(): Promise<boolean> {
  if (permissionGranted) return true;
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = isGranted(current);
    if (!granted && current.canAskAgain && mayAskPermission && !permissionRequested) {
      permissionRequested = true;
      granted = isGranted(await Notifications.requestPermissionsAsync());
    }
    permissionGranted = granted;
  } catch {
    return false;
  }
  return permissionGranted;
}

/** Cancel every calendar reminder this app scheduled. */
export function cancelAllCalendarNotifications(): Promise<void> {
  return cancelReminders();
}

function isSignedOut(): boolean {
  const { hasRestoredSession, isAuthenticated } = useAuthStore.getState();
  return hasRestoredSession && !isAuthenticated;
}

// The JMAP account the upcoming events are loaded from when they carry no
// account of their own.
function primaryJmapAccountId(): string | null {
  try {
    return jmapClient.accountId;
  } catch {
    return null;
  }
}

/**
 * The events whose alerts can fire within the horizon, straight from the
 * server. `null` when that can't be known (offline, no session yet, the
 * request failed): the caller then leaves the scheduled reminders alone
 * instead of cancelling what it can't re-derive.
 */
async function loadUpcomingEvents(now: number): Promise<CalendarEvent[] | null> {
  if (!jmapClient.isConnected) return null;
  if (!hasCalendarCapability()) return [];
  if (useCalendarStore.getState().calendars.length === 0) {
    await useCalendarStore.getState().fetchCalendars();
  }
  const { calendars } = useCalendarStore.getState();
  if (calendars.length === 0) return null;
  try {
    return await loadEventsInRange(
      calendars,
      calendars.map((c) => c.id),
      new Date(now - LOOKBEHIND_MS).toISOString(),
      new Date(now + HORIZON_MS + LOOKAHEAD_MS).toISOString(),
    );
  } catch {
    return null;
  }
}

// Task reminders read the store's tasks, which the Calendar tab loads. When
// it hasn't, and tasks are switched on, scan them once per account.
async function ensureTasksLoaded(): Promise<void> {
  let accountId: string;
  try {
    accountId = jmapClient.accountId;
  } catch {
    return;
  }
  if (tasksLoadedFor === accountId) return;
  tasksLoadedFor = accountId;
  const { tasks, taskOnlyCalendarIds, fetchTasks } = useCalendarStore.getState();
  if (tasks.length > 0 || taskOnlyCalendarIds.length > 0) return;
  if (!useSettingsStore.getState().enableCalendarTasks) return;
  await fetchTasks();
}

/**
 * Derive the reminders from the upcoming window and reconcile them with
 * what the OS has pending: cancel the reminders this code scheduled that are
 * no longer wanted (event deleted or moved, reminder removed, task
 * completed) and add the new ones. Concurrent calls coalesce.
 */
export async function rescheduleCalendarNotifications(): Promise<void> {
  if (rescheduling) {
    queued = true;
    return rescheduling;
  }
  rescheduling = (async () => {
    try {
      const settings = useSettingsStore.getState();
      // Until the settings load, the switch holds its default, not the
      // user's choice.
      if (!settings.hydrated) return;
      if (!settings.calendarNotificationsEnabled || isSignedOut()) {
        await cancelAllCalendarNotifications();
        return;
      }
      if (!(await ensurePermission())) return;
      const { locale, t } = useLocaleStore.getState();
      await ensureChannel(locale, t);

      const now = Date.now();
      const events = await loadUpcomingEvents(now);
      if (!events) return;
      await ensureTasksLoaded();
      const { tasks, calendars } = useCalendarStore.getState();
      // Events of calendars synced to this device get their reminders from
      // the device's calendar app when the user chose it to remind them
      // (#34); tasks are not synced and keep theirs.
      const onDevice = remindedOnDevice(useAuthStore.getState().activeAccountId, primaryJmapAccountId());
      const ownEvents = onDevice ? events.filter((event) => !onDevice(event)) : events;
      // Reminders fire while the app is closed, so they are worded now, in
      // the app language.
      const wanted = getUpcomingAlerts(ownEvents, tasks, calendars, {
        now,
        horizonMs: HORIZON_MS,
        limit: MAX_SCHEDULED,
      }, t);
      await reconcileReminders(wanted, locale, {
        appAccountId: useAuthStore.getState().activeAccountId ?? undefined,
      });
    } catch {
      // Notifications are best-effort.
    } finally {
      rescheduling = null;
      if (queued) {
        queued = false;
        void rescheduleCalendarNotifications();
      }
    }
  })();
  return rescheduling;
}

function scheduleSoon(): void {
  if (rescheduleTimer) clearTimeout(rescheduleTimer);
  // Debounce: a refresh sets events and tasks in two steps, and a push
  // reaches both the store and the state-change bus.
  rescheduleTimer = setTimeout(() => {
    rescheduleTimer = null;
    void rescheduleCalendarNotifications();
  }, 1500);
}

// expo-notifications drops a notification that fires while the app is in
// the foreground unless a handler asks for it. Only calendar reminders go
// through expo-notifications (mail push is posted by the native messaging
// services), so show those and leave anything else as it was.
function installForegroundHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const show = alertKeyOf(notification.request) !== null;
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    },
  });
}

/** The event or task a calendar reminder notification points at; null for anything else. */
export function reminderTargetOf(request: Notifications.NotificationRequest): CalendarReminderTarget | null {
  if (alertKeyOf(request) === null) return null;
  const data = request.content.data as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const eventId = str(data.eventId);
  if (!eventId) return null;
  return {
    kind: data.kind === 'task' ? 'task' : 'event',
    eventId,
    serverId: str(data.serverId),
    accountId: str(data.accountId),
    recurrenceId: str(data.recurrenceId),
    startMs: typeof data.startMs === 'number' && Number.isFinite(data.startMs) ? data.startMs : undefined,
    appAccountId: str(data.appAccountId),
  };
}

// Responses already acted on: the cold-start response is reported both by
// getLastNotificationResponseAsync and, on some platforms, the listener.
const handledResponses = new Set<string>();

/**
 * Call `open` when the user taps a calendar reminder: the one that launched
 * the app and any tapped while it runs. Only reminders scheduled here are
 * handled; mail push is posted by the native messaging services and its taps
 * arrive through the native tap store (push-notifications), never here.
 * Returns the unsubscribe.
 */
export function startCalendarReminderTapHandling(
  open: (target: CalendarReminderTarget) => void,
): () => void {
  let active = true;
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (!active || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const { request } = response.notification;
    const target = reminderTargetOf(request);
    if (!target || handledResponses.has(request.identifier)) return;
    handledResponses.add(request.identifier);
    // Don't reopen it on the next sign-in or app start.
    void Promise.resolve()
      .then(() => Notifications.clearLastNotificationResponseAsync())
      .catch(() => undefined);
    open(target);
  };
  void Notifications.getLastNotificationResponseAsync().then(handle, () => undefined);
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => {
    active = false;
    subscription.remove();
  };
}

/**
 * Keep local reminders in sync for the rest of the session: at launch,
 * sign-in and account switch, when calendar data changes on the server or
 * in the app, when the app comes back to the foreground, and when the
 * setting flips. Idempotent. `askPermission` lets the sync ask for
 * notification permission; the Calendar tab passes it.
 */
export function startCalendarNotificationSync(options?: { askPermission?: boolean }): void {
  if (options?.askPermission && !mayAskPermission) {
    mayAskPermission = true;
    if (syncStarted) scheduleSoon();
  }
  if (syncStarted) return;
  syncStarted = true;
  installForegroundHandler();
  // Edits in the app, a refresh after a push, tasks loading. Moving the
  // calendar to another window changes no reminder.
  useCalendarStore.subscribe((state, prev) => {
    const sameWindow =
      state.loadedRange?.after === prev.loadedRange?.after &&
      state.loadedRange?.before === prev.loadedRange?.before;
    if (state.tasks !== prev.tasks || (state.events !== prev.events && sameWindow)) {
      scheduleSoon();
    }
  });
  useSettingsStore.subscribe((state, prev) => {
    if (state.calendarNotificationsEnabled !== prev.calendarNotificationsEnabled) {
      // The calendar types are in the push subscription only while this is on
      // (pushTypesFor): they wake the app to refresh reminders in the background.
      const accountId = useAuthStore.getState().activeAccountId;
      if (accountId) void refreshPushSubscriptionTypes(accountId).catch(() => undefined);
    }
    if (
      state.calendarNotificationsEnabled !== prev.calendarNotificationsEnabled ||
      state.hydrated !== prev.hydrated
    ) {
      scheduleSoon();
    }
  });
  useAuthStore.subscribe((state, prev) => {
    if (state.session !== prev.session || state.isAuthenticated !== prev.isAuthenticated) {
      scheduleSoon();
    }
  });
  // Reword the pending reminders and rename the channel in the new language.
  useLocaleStore.subscribe((state, prev) => {
    if (state.locale !== prev.locale) scheduleSoon();
  });
  onStateChangeType('CalendarEvent', scheduleSoon);
  onStateChangeType('Calendar', scheduleSoon);
  // Who reminds of synced events changed, or which calendars sync (#34).
  onDeviceRemindersChange(scheduleSoon);
  AppState.addEventListener('change', (state) => {
    if (state === 'active') scheduleSoon();
  });
  scheduleSoon();
}
