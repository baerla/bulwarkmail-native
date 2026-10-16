import { describe, it, expect, vi, beforeEach } from 'vitest';
import AsyncStorage from '@react-native-async-storage/async-storage';

const h = vi.hoisted(() => ({
  available: true,
  permitted: true,
  settings: { masterAutomatic: true, authorities: { 'com.android.calendar': { automatic: true } } } as unknown,
  settingsError: false,
}));

vi.mock('../../device-sync/app/available', () => ({ deviceSyncAvailable: () => h.available }));
vi.mock('../../device-sync/app/permissions', () => ({ hasSyncPermissions: async () => h.permitted }));
vi.mock('../../device-sync/native', () => ({
  getSyncSettings: async () => {
    if (h.settingsError) throw new Error('no bridge');
    return h.settings;
  },
}));

import { readRemindedOnDevice } from '../calendar-reminder-owner';
import { DEVICE_SYNC_STORAGE_KEY } from '../../device-sync/app/prefs';
import { CALENDAR_AUTHORITY } from '../../device-sync/types';
import type { CalendarEvent } from '../../api/types';

const REGISTRY_ID = 'user@example.com@mail.example.com';
const store = (entry: Record<string, unknown>) =>
  AsyncStorage.setItem(DEVICE_SYNC_STORAGE_KEY, JSON.stringify({ state: { accounts: { [REGISTRY_ID]: entry } } }));
const entry = (over: Record<string, unknown> = {}) => ({
  enabled: { [CALENDAR_AUTHORITY]: true },
  reminderOwner: 'device',
  calendarSelection: {},
  intervalSeconds: {},
  lastRun: {},
  contactsSelection: {},
  androidAccountName: 'user@example.com',
  ...over,
});
const event = (calendarId: string) => ({ id: 'e', calendarIds: { [calendarId]: true } }) as unknown as CalendarEvent;

beforeEach(async () => {
  await AsyncStorage.clear();
  h.available = true;
  h.permitted = true;
  h.settingsError = false;
  h.settings = { masterAutomatic: true, authorities: { [CALENDAR_AUTHORITY]: { automatic: true } } };
});

describe('readRemindedOnDevice', () => {
  it('is null when device sync is not stored for the account', async () => {
    expect(await readRemindedOnDevice(REGISTRY_ID, 'acc-1')).toBeNull();
  });

  it('is null when the app owns the reminders', async () => {
    await store(entry({ reminderOwner: 'app' }));
    expect(await readRemindedOnDevice(REGISTRY_ID, 'acc-1')).toBeNull();
  });

  it('is null when Android sync cannot be read: Bulwark reminds', async () => {
    await store(entry());
    h.settingsError = true;
    expect(await readRemindedOnDevice(REGISTRY_ID, 'acc-1')).toBeNull();
  });

  it('is null when the calendar permission is missing or auto-sync is off', async () => {
    await store(entry());
    h.permitted = false;
    expect(await readRemindedOnDevice(REGISTRY_ID, 'acc-1')).toBeNull();
    h.permitted = true;
    h.settings = { masterAutomatic: false, authorities: { [CALENDAR_AUTHORITY]: { automatic: true } } };
    expect(await readRemindedOnDevice(REGISTRY_ID, 'acc-1')).toBeNull();
  });

  it('is null when device sync is unavailable on this build', async () => {
    await store(entry());
    h.available = false;
    expect(await readRemindedOnDevice(REGISTRY_ID, 'acc-1')).toBeNull();
  });

  it('flags the events of selected calendars and not of deselected ones', async () => {
    await store(entry({ calendarSelection: { 'acc-1/cal-off': false } }));
    const onDevice = await readRemindedOnDevice(REGISTRY_ID, 'acc-1');
    expect(onDevice).not.toBeNull();
    expect(onDevice!(event('cal-on'))).toBe(true);
    expect(onDevice!(event('cal-off'))).toBe(false);
  });

  it('is null on malformed persisted JSON', async () => {
    await AsyncStorage.setItem(DEVICE_SYNC_STORAGE_KEY, '{not json');
    expect(await readRemindedOnDevice(REGISTRY_ID, 'acc-1')).toBeNull();
  });
});
