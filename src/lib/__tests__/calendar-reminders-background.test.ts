import { describe, it, expect, vi, beforeEach } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

const h = vi.hoisted(() => ({
  pending: [] as Array<{ identifier: string; content: { data: Record<string, unknown> } }>,
  permission: { granted: true, canAskAgain: true },
  client: null as unknown,
  calendars: [{ id: 'cal-1', name: 'Personal' }] as unknown[],
  calendarsError: false,
  events: [] as unknown[],
  eventsError: false,
  onDevice: null as ((e: { id: string }) => boolean) | null,
  hydrate: vi.fn(async () => undefined),
  hydrated: false,
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' }, NativeModules: {} }));
vi.mock('expo-notifications', () => ({
  getPermissionsAsync: vi.fn(async () => ({ ...h.permission })),
  requestPermissionsAsync: vi.fn(async () => ({ granted: true })),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  getAllScheduledNotificationsAsync: vi.fn(async () => h.pending),
  cancelScheduledNotificationAsync: vi.fn(async () => undefined),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));
vi.mock('../../widgets/jmap', () => ({ openClient: vi.fn(async () => h.client) }));
vi.mock('../../api/calendar', () => ({
  getCalendars: vi.fn(async () => {
    if (h.calendarsError) throw new Error('offline');
    return h.calendars;
  }),
}));
vi.mock('../calendar-events-range', () => ({
  loadEventsInRange: vi.fn(async () => {
    if (h.eventsError) throw new Error('offline');
    return h.events;
  }),
}));
vi.mock('../../stores/settings-store', () => ({
  useSettingsStore: { getState: () => ({ hydrated: h.hydrated, hydrate: h.hydrate }) },
}));
vi.mock('../calendar-reminder-owner', () => ({ readRemindedOnDevice: vi.fn(async () => h.onDevice) }));

import * as Notifications from 'expo-notifications';
import { refreshCalendarRemindersInBackground } from '../calendar-reminders-background';
import { DATA_TAG } from '../calendar-reminder-reconcile';

const SOON = () => new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const event = (id: string) => ({
  id, title: `Event ${id}`, start: SOON(), utcStart: SOON(), duration: 'PT1H', calendarIds: { 'cal-1': true },
  alerts: { a1: { trigger: { '@type': 'OffsetTrigger', offset: '-PT30M' }, action: 'display' } },
});
const req = (identifier: string, key: string, kind: string) => ({
  identifier, content: { data: { tag: DATA_TAG, key, kind, locale: 'en' } },
});
const setSettings = (state: Record<string, unknown>) =>
  // The settings store persists its snapshot flat, not under zustand's `state`.
  AsyncStorage.setItem('webmail:settings:v1', JSON.stringify(state));
const setActive = (id: string | null) =>
  AsyncStorage.setItem('account-registry', JSON.stringify({ state: { accounts: [], activeAccountId: id } }));

beforeEach(async () => {
  await AsyncStorage.clear();
  vi.clearAllMocks();
  h.pending = [];
  h.permission = { granted: true, canAskAgain: true };
  h.client = { currentSession: { capabilities: { 'urn:ietf:params:jmap:calendars': {} } }, accountId: 'jmap-1' };
  h.calendars = [{ id: 'cal-1', name: 'Personal' }];
  h.calendarsError = false;
  h.events = [];
  h.eventsError = false;
  h.onDevice = null;
  h.hydrated = false;
  await setSettings({ calendarNotificationsEnabled: true });
  await setActive('acc-1');
});

describe('refreshCalendarRemindersInBackground', () => {
  it('schedules the reminders of upcoming events', async () => {
    h.events = [event('e1')];
    await refreshCalendarRemindersInBackground();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0]).toMatchObject({
      content: { title: 'Event e1', body: 'Starts in 30 minutes' },
    });
  });

  it('cancels pending event reminders when the setting is off, leaving task reminders', async () => {
    await setSettings({ calendarNotificationsEnabled: false });
    h.events = [event('e1')]; // would be scheduled if the setting were ignored
    h.pending = [req('e', 'k1', 'event'), req('t', 'k2', 'task')];
    await refreshCalendarRemindersInBackground();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('e');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels pending event reminders when no account is signed in', async () => {
    await setActive(null);
    h.pending = [req('e', 'k1', 'event')];
    await refreshCalendarRemindersInBackground();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('e');
  });

  it('schedules nothing and does not prompt when notification permission is missing', async () => {
    h.permission = { granted: false, canAskAgain: true };
    h.events = [event('e1')];
    await refreshCalendarRemindersInBackground();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('leaves the schedule untouched when there is no client (offline or no credentials)', async () => {
    h.client = null;
    h.pending = [req('e', 'k1', 'event')];
    await refreshCalendarRemindersInBackground();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('leaves the schedule untouched when the event fetch fails', async () => {
    h.eventsError = true;
    h.pending = [req('e', 'k1', 'event')];
    await refreshCalendarRemindersInBackground();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('leaves the schedule untouched when the calendars cannot be read or are empty', async () => {
    h.pending = [req('e', 'k1', 'event')];
    h.calendarsError = true;
    await refreshCalendarRemindersInBackground();
    h.calendarsError = false;
    h.calendars = [];
    await refreshCalendarRemindersInBackground();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('skips events of calendars the device calendar app reminds of', async () => {
    h.events = [event('device'), event('own')];
    h.onDevice = (e) => e.id === 'device';
    await refreshCalendarRemindersInBackground();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0]).toMatchObject({
      content: { title: 'Event own' },
    });
  });

  it('hydrates the settings store first, so the calendar time zone override applies to the queries', async () => {
    h.events = [event('e1')];
    await refreshCalendarRemindersInBackground();
    expect(h.hydrate).toHaveBeenCalledTimes(1);
    expect(h.hydrate.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(Notifications.scheduleNotificationAsync).mock.invocationCallOrder[0]);
  });

  it('never rejects', async () => {
    vi.mocked(Notifications.getPermissionsAsync).mockRejectedValueOnce(new Error('boom'));
    await expect(refreshCalendarRemindersInBackground()).resolves.toBeUndefined();
  });
});
