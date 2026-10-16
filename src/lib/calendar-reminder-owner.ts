/**
 * The headless twin of `remindedOnDevice` (device-sync/app/reminders.ts): who
 * reminds the user of synced events, for the background reminder refresh,
 * which must not create the device sync store. It reads the store's persisted
 * JSON and asks Android once, awaited, instead of listening for changes.
 *
 * Same rule as the store-backed one: the device's calendar app owns the
 * reminders of synced calendars only while it receives the server's events.
 * When any part of Android's side can't be read Bulwark reminds: a double
 * reminder is better than a missed one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CalendarEvent } from '../api/types';
import { deviceSyncAvailable } from '../device-sync/app/available';
import { DEVICE_SYNC_STORAGE_KEY, persistedAccounts, syncOnInApp } from '../device-sync/app/prefs';
import { hasSyncPermissions } from '../device-sync/app/permissions';
import { collectionKey } from '../device-sync/common/ids';
import { collectionDefaultOn } from '../device-sync/engine/selection';
import { getSyncSettings } from '../device-sync/native';
import { CALENDAR_AUTHORITY, type CollectionKey } from '../device-sync/types';

interface PersistedEntry {
  enabled?: Partial<Record<string, boolean>>;
  removedInAndroidSettings?: boolean;
  suspended?: boolean;
  reminderOwner?: string | null;
  calendarSelection?: Record<CollectionKey, boolean>;
  androidAccountName?: string;
  primaryJmapAccounts?: Partial<Record<string, string>>;
}

/**
 * A test for the events whose reminders the device's calendar app fires for
 * this app account, so Bulwark schedules none; null when there are none.
 */
export async function readRemindedOnDevice(
  registryId: string,
  primaryJmapAccountId: string | null,
): Promise<((event: CalendarEvent) => boolean) | null> {
  try {
    if (!deviceSyncAvailable()) return null;
    const entry = persistedAccounts(await AsyncStorage.getItem(DEVICE_SYNC_STORAGE_KEY))[registryId] as
      | PersistedEntry
      | undefined;
    // Unasked means the calendar app, as the engine writes Reminders rows then.
    if (!entry || !syncOnInApp(entry, CALENDAR_AUTHORITY) || (entry.reminderOwner ?? 'device') !== 'device') {
      return null;
    }
    if (!entry.androidAccountName || !(await hasSyncPermissions(CALENDAR_AUTHORITY))) return null;
    const settings = await getSyncSettings(entry.androidAccountName);
    if (settings.masterAutomatic === false || !settings.authorities?.[CALENDAR_AUTHORITY]?.automatic) return null;

    const selection = entry.calendarSelection ?? {};
    const personal = entry.primaryJmapAccounts?.[CALENDAR_AUTHORITY] ?? primaryJmapAccountId;
    return (event) => {
      // Events of shared calendars carry their account and a namespaced copy
      // of calendarIds; the raw ids are in originalCalendarIds.
      const jmapAccountId = event.accountId ?? primaryJmapAccountId;
      if (!jmapAccountId) return false;
      const calendarIds = event.originalCalendarIds ?? event.calendarIds ?? {};
      return Object.entries(calendarIds).some(([calendarId, member]) => {
        if (!member) return false;
        const key = collectionKey(jmapAccountId, calendarId);
        const explicit = selection[key];
        return typeof explicit === 'boolean'
          ? explicit
          : collectionDefaultOn(jmapAccountId === personal, CALENDAR_AUTHORITY, undefined);
      });
    };
  } catch {
    return null;
  }
}
