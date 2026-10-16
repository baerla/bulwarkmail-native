# Reliable Calendar Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An event at 16:00 with a "30 minutes before" alert posts its notification at 15:30, even when the event was created in the webmail and the app hasn't been opened since.

**Architecture:** Keep expo-notifications local notifications as the delivery mechanism. Make them exact with two manifest permissions (Part A). Make the schedule fresh by moving the reconcile logic and event loading into store-free `src/lib` modules, running them in a headless task `BulwarkCalendarReminders`, and triggering that task from a JMAP push of `CalendarEvent`/`Calendar` and from a 6-hourly JobScheduler job (Part B).

**Tech Stack:** React Native / Expo SDK 54, expo-notifications, Zustand (foreground only), vitest (node env), Kotlin (hand-maintained `android/`), JobScheduler, HeadlessJS.

**Spec:** [ADR](2026-10-16-calendar-reminders-adr.md) (why), [plan](2026-10-16-calendar-reminders-plan.md) (what), [handoff](2026-10-16-calendar-reminders-handoff.md) (code map, watch-outs). This document is the ordered, task-level execution of them.

## Global Constraints

- `android/` is edited by hand; never `app.config.js` for Android manifest or native changes. Never edit or commit `ios/`.
- Headless code paths (`src/lib/calendar-reminders-background.ts`, `calendar-reminder-reconcile.ts`, `calendar-events-range.ts`, and anything they import) must not import stores, screens or Expo UI modules, and must not use the `jmapClient` singleton. `expo-notifications` is allowed (it is the delivery mechanism).
- `index.ts` gets no new top-level imports; the new task module is `require()`d lazily.
- The background path reconciles only reminders with `kind: 'event'` and only for the active account.
- If the calendar or network can't be read, leave pending reminders untouched. If Android's device-sync state can't be read, Bulwark reminds (double reminder beats a missed one).
- `PushRouting.decide` (Kotlin) and `carriesNoMail` (TS) must keep agreeing: a calendar-only push never posts a mail notification.
- Notification text is unchanged. No new dependencies.
- Reuse existing webmail i18n keys; always pass English fallbacks to `t()`. Do not edit `locales/<lang>/common.json`.
- Conventional-Commit messages in plain language; commits end with the `Co-Authored-By` line from the session attribution.
- CI gates: `npm run typecheck` and `npm test` must pass after every task.

## Review Focus

1. **Concurrent reconcile (foreground + headless in the same process).** Two runs can both see a reminder as missing and schedule it twice. Expected: one notification. Pinned in Task 2 with deterministic notification identifiers.
2. **Task reminders during a background run.** The background path doesn't load tasks. Expected: pending `kind: 'task'` reminders survive untouched. Pinned in Task 2.
3. **Signed-out / setting-off / revoked-notification-permission in the background.** Expected: setting off cancels event reminders; signed out cancels; permission missing schedules nothing and never prompts. Pinned in Task 4.
4. **Offline or `Calendar/get` empty.** Expected: pending reminders untouched. Pinned in Task 4.
5. **Push types toggled off.** Expected: with the setting off, `CalendarEvent`/`Calendar` leave the subscription, and the periodic job is cancelled (no wakeups for a disabled feature). Pinned in Tasks 5 and 7.

---

## File Structure

| File | Responsibility |
|---|---|
| `android/app/src/main/AndroidManifest.xml` | Exact-alarm permissions; register the new JobService |
| `patches/expo-notifications+*.patch` (only if Task 1 finds a gap) | Exact alarms / boot receiver |
| `src/lib/calendar-reminder-reconcile.ts` (new) | Store-free: constants, channel, `scheduleOne`, `reconcileReminders`, `cancelReminders` |
| `src/lib/calendar-events-range.ts` (new) | Store-free `loadEventsInRange(client, …)` and its helpers |
| `src/lib/calendar-reminder-owner.ts` (new) | Store-free device-owned-reminder filter reading persisted device-sync JSON |
| `src/lib/calendar-reminders-background.ts` (new) | `refreshCalendarRemindersInBackground()` |
| `src/lib/calendar-notifications.ts` | Keeps foreground wiring only; delegates to the modules above |
| `src/stores/calendar-store.ts` | Re-exports/uses `calendar-events-range` |
| `src/lib/push-notifications.ts` | `pushTypesFor` adds calendar types; resubscribe on setting flip |
| `android/.../sync/PushRouting.kt` | `calendarReminders` flag in `Decision` |
| `android/.../BulwarkCalendarReminderJobService.kt` (new) | Push-triggered one-off job + 6-hourly periodic job |
| `android/.../BulwarkFcmModule.kt` | `scheduleCalendarReminderJob` / `cancelCalendarReminderJob` |
| `android/.../BulwarkMessagingService.kt`, `BulwarkUnifiedPushService.kt` | Start the one-off job when `decision.calendarReminders` |
| `index.ts` | Register `BulwarkCalendarReminders` |
| `docs/parity/05-calendar.md`, `docs/parity/08-settings-push-i18n-ui.md`, `docs/device-sync.md` | Doc updates |

Branch: continue on `claude/calendar-reminder-notifications-31f774` (or create it from `main`).

---

### Task 1: Environment and expo-notifications spike

**Files:**
- Read: `node_modules/expo-notifications/android/**`
- Possibly create: `patches/expo-notifications+<version>.patch`

**Interfaces:**
- Produces: a yes/no answer to (a) exact alarm use and (b) boot receiver, recorded in the commit message or the handoff doc. Tasks 2+ do not depend on it; Task 3 does.

- [ ] **Step 1: Install and establish a green baseline**

```bash
npm install
npm run typecheck && npm test
```
Expected: both pass. If not, stop and report; the baseline is broken independent of this work.

- [ ] **Step 2: Check how DATE triggers are scheduled**

```bash
grep -rn "setExactAndAllowWhileIdle\|canScheduleExactAlarms\|setAndAllowWhileIdle\|AlarmManager" node_modules/expo-notifications/android/src --include=*.kt --include=*.java | head -30
grep -rn "RECEIVE_BOOT_COMPLETED\|BOOT_COMPLETED" node_modules/expo-notifications/android/src/main/AndroidManifest.xml
```
Record: (a) does the scheduler call `setExactAndAllowWhileIdle` when `canScheduleExactAlarms()` is true? (b) does the library manifest declare `RECEIVE_BOOT_COMPLETED` and a boot receiver?

- [ ] **Step 3: If (a) or (b) is "no", write a patch**

Edit the file under `node_modules/expo-notifications/...`, then:
```bash
npx patch-package expo-notifications
```
Expected: a new file in `patches/`. If both are "yes", skip this step.

- [ ] **Step 4: Commit (only if a patch was created)**

```bash
git add patches/
git commit -m "fix(calendar): make expo-notifications use exact alarms"
```

---

### Task 2: Part A, exact-alarm permissions

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml:2-16` (permission block)

**Interfaces:**
- Produces: nothing code-level. Ships on its own.

- [ ] **Step 1: Add the permissions after `POST_NOTIFICATIONS` (line 4)**

```xml
  <!-- Calendar reminders must fire on the minute, also in Doze. USE_EXACT_ALARM
       is granted at install on Android 13+ for calendar apps; Android 12 has only
       SCHEDULE_EXACT_ALARM, which is granted by default there. -->
  <uses-permission android:name="android.permission.USE_EXACT_ALARM"/>
  <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32"/>
```

- [ ] **Step 2: Verify the merged manifest builds**

```bash
cd android && ./gradlew :app:processDebugMainManifest && cd ..
```
Expected: BUILD SUCCESSFUL. (Skip with a note if no Android SDK in this environment; CI/device build covers it.)

- [ ] **Step 3: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml
git commit -m "fix(calendar): fire event reminders on time while the phone sleeps"
```

---

### Task 3: Store-free reconcile module

**Files:**
- Create: `src/lib/calendar-reminder-reconcile.ts`
- Create: `src/lib/__tests__/calendar-reminder-reconcile.test.ts`
- Modify: `src/lib/calendar-notifications.ts` (delegate)
- Test (must stay green): `src/lib/__tests__/calendar-notifications.test.ts`

**Interfaces:**
- Consumes: `ScheduledAlert` from `./calendar-alert-scheduler` (fields used: `key`, `title`, `body`, `fireTimeMs`, `eventId`, `kind`, `serverId`, `accountId`, `recurrenceId`, `startMs`).
- Produces:
```ts
export const CHANNEL_ID = 'calendar-reminders';
export const DATA_TAG = 'bulwark-calendar-alert';
export const DAY_MS: number;
export const HORIZON_MS: number;      // 7 days
export const LOOKBEHIND_MS: number;   // 1 day
export const LOOKAHEAD_MS: number;    // 7 days
export const MAX_SCHEDULED = 48;
export type ReminderKind = 'event' | 'task';
export function alertKeyOf(request: Notifications.NotificationRequest): string | null;
export function reminderKindOf(request: Notifications.NotificationRequest): ReminderKind | null;
export function isStaleLanguage(request: Notifications.NotificationRequest, locale: string): boolean;
export function ensureChannel(locale: string, t: (key: string, fallback: string) => string): Promise<void>;
export function scheduleOne(alert: ScheduledAlert, locale: string, appAccountId?: string): Promise<void>;
export function reconcileReminders(
  wanted: ScheduledAlert[],
  locale: string,
  opts?: { kinds?: ReminderKind[]; appAccountId?: string },
): Promise<void>;
export function cancelReminders(kinds?: ReminderKind[]): Promise<void>;
```
`reconcileReminders` with `kinds` ignores pending reminders of other kinds entirely (neither cancels nor counts them as present). `scheduleOne` uses `identifier: \`bulwark-cal:${alert.key}\`` so a concurrent second schedule replaces rather than duplicates.

- [ ] **Step 1: Write the failing tests**

Model the mocks on the head of `calendar-notifications.test.ts` (mock `react-native` with `Platform.OS = 'android'` and `expo-notifications`). Pending entries are `{ identifier, content: { data } }`.

```ts
// src/lib/__tests__/calendar-reminder-reconcile.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  pending: [] as Array<{ identifier: string; content: { data: Record<string, unknown> } }>,
}));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-notifications', () => ({
  setNotificationChannelAsync: vi.fn(async () => undefined),
  getAllScheduledNotificationsAsync: vi.fn(async () => h.pending),
  cancelScheduledNotificationAsync: vi.fn(async () => undefined),
  scheduleNotificationAsync: vi.fn(async () => 'id'),
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

import * as Notifications from 'expo-notifications';
import { reconcileReminders, DATA_TAG } from '../calendar-reminder-reconcile';

const alert = (key: string, over: Record<string, unknown> = {}) => ({
  key, eventId: key, kind: 'event', title: 'T', body: 'B',
  fireTimeMs: Date.now() + 60_000, startMs: Date.now() + 120_000, ...over,
}) as never;
const req = (identifier: string, key: string, kind = 'event', locale = 'en') => ({
  identifier, content: { data: { tag: DATA_TAG, key, kind, locale } },
});

beforeEach(() => { h.pending = []; vi.clearAllMocks(); });

describe('reconcileReminders', () => {
  it('cancels reminders that are no longer wanted and adds missing ones', async () => {
    h.pending = [req('p1', 'old'), req('p2', 'keep')];
    await reconcileReminders([alert('keep'), alert('new')], 'en');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('p1');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('p2');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('with kinds: ["event"] leaves task reminders alone', async () => {
    h.pending = [req('t1', 'task-key', 'task'), req('e1', 'gone', 'event')];
    await reconcileReminders([], 'en', { kinds: ['event'] });
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('e1');
  });

  it('rewords a reminder scheduled in another language', async () => {
    h.pending = [req('p1', 'k', 'event', 'de')];
    await reconcileReminders([alert('k')], 'en');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('p1');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('schedules with a deterministic identifier so concurrent runs cannot duplicate', async () => {
    await reconcileReminders([alert('k1')], 'en');
    expect(vi.mocked(Notifications.scheduleNotificationAsync).mock.calls[0][0]).toMatchObject({
      identifier: 'bulwark-cal:k1',
    });
  });

  it('survives one failing schedule', async () => {
    vi.mocked(Notifications.scheduleNotificationAsync).mockRejectedValueOnce(new Error('bad'));
    await reconcileReminders([alert('a'), alert('b')], 'en');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/calendar-reminder-reconcile.test.ts`
Expected: FAIL, module `../calendar-reminder-reconcile` not found.

- [ ] **Step 3: Create the module**

Move (don't copy) from `calendar-notifications.ts`: `CHANNEL_ID`, `DAY_MS`, `HORIZON_MS`, `LOOKBEHIND_MS`, `LOOKAHEAD_MS`, `MAX_SCHEDULED`, `DATA_TAG`, `alertKeyOf`, `isStaleLanguage`, and the channel and `scheduleOne` logic. Keep the existing explanatory comments. Differences from the originals: `ensureChannel(locale, t)` takes the locale and `t` as parameters instead of reading `useLocaleStore`; `scheduleOne` takes `appAccountId` instead of reading `useAuthStore`, and adds `identifier`.

```ts
// src/lib/calendar-reminder-reconcile.ts
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { ScheduledAlert } from './calendar-alert-scheduler';

// Store-free on purpose: the headless BulwarkCalendarReminders task runs this
// without hydrating any store (see calendar-reminders-background.ts).

// ...moved constants (with their comments)...

export type ReminderKind = 'event' | 'task';

let channelLocale: string | null = null;

// ...alertKeyOf, isStaleLanguage moved verbatim, exported...

export function reminderKindOf(request: Notifications.NotificationRequest): ReminderKind | null {
  if (alertKeyOf(request) === null) return null;
  const data = request.content.data as { kind?: unknown };
  return data.kind === 'task' ? 'task' : 'event';
}

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
    tag: DATA_TAG, key: alert.key, locale, eventId: alert.eventId, kind: alert.kind,
    serverId: alert.serverId, accountId: alert.accountId, recurrenceId: alert.recurrenceId,
    startMs: alert.startMs, appAccountId,
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  await Notifications.scheduleNotificationAsync({
    // Same key, same identifier: when the foreground sync and the headless
    // task race, the second schedule replaces the first instead of doubling it.
    identifier: `bulwark-cal:${alert.key}`,
    content: { title: alert.title, body: alert.body, sound: 'default', data },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: new Date(alert.fireTimeMs),
      ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
    },
  });
}

export async function reconcileReminders(
  wanted: ScheduledAlert[],
  locale: string,
  opts: { kinds?: ReminderKind[]; appAccountId?: string } = {},
): Promise<void> {
  const inScope = (r: Notifications.NotificationRequest) => {
    const kind = reminderKindOf(r);
    return kind !== null && (!opts.kinds || opts.kinds.includes(kind));
  };
  const wantedByKey = new Map(wanted.map((a) => [a.key, a]));
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  const present = new Set<string>();
  for (const request of pending) {
    if (!inScope(request)) continue;
    const key = alertKeyOf(request)!;
    if (wantedByKey.has(key) && !isStaleLanguage(request, locale)) present.add(key);
    else await Notifications.cancelScheduledNotificationAsync(request.identifier);
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

export async function cancelReminders(kinds?: ReminderKind[]): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((r) => reminderKindOf(r) !== null && (!kinds || kinds.includes(reminderKindOf(r)!)))
        .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)),
    );
  } catch {
    // Nothing to do; the OS keeps whatever it has.
  }
}
```

- [ ] **Step 4: Rewire `calendar-notifications.ts`**

- Import the constants, `alertKeyOf`, `ensureChannel`, `reconcileReminders`, `cancelReminders` from `./calendar-reminder-reconcile`; delete the moved definitions.
- `cancelAllCalendarNotifications` becomes `export const cancelAllCalendarNotifications = () => cancelReminders();`.
- In `rescheduleCalendarNotifications`: `await ensureChannel(locale, t)` (read `useLocaleStore.getState()` there) and replace the pending/cancel/schedule loop with `await reconcileReminders(wanted, locale, { appAccountId: useAuthStore.getState().activeAccountId ?? undefined });`.
- Keep `reminderTargetOf` and tap handling using the imported `alertKeyOf`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/__tests__/calendar-reminder-reconcile.test.ts src/lib/__tests__/calendar-notifications.test.ts && npm run typecheck`
Expected: PASS. If `calendar-notifications.test.ts` asserts on the previous scheduling call shape, it needs only the added `identifier` field; update the assertion, nothing else.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calendar-reminder-reconcile.ts src/lib/calendar-notifications.ts src/lib/__tests__/calendar-reminder-reconcile.test.ts src/lib/__tests__/calendar-notifications.test.ts
git commit -m "refactor(calendar): move reminder reconcile out of the store-coupled module"
```

---

### Task 4: Store-free event loading and reminder-owner filter

**Files:**
- Create: `src/lib/calendar-events-range.ts`
- Create: `src/lib/calendar-reminder-owner.ts`
- Modify: `src/stores/calendar-store.ts:317-388` (`loadEventsInRange`) and its helper imports
- Create: `src/lib/__tests__/calendar-reminder-owner.test.ts`
- Test (must stay green): `src/stores/__tests__/` calendar tests, `calendar-notifications.test.ts`

**Interfaces:**
- Consumes: `persistedAccounts(raw)` from `src/device-sync/app/prefs.ts`; `DEVICE_SYNC_STORAGE_KEY` (as used in `push-notifications.ts`); `selectionFor`, `isCollectionSelected`, `syncOnInApp` (currently in `stores/device-sync-store.ts`; see Step 1).
- Produces:
```ts
// calendar-events-range.ts
export async function loadEventsInRange(
  calendars: Calendar[], calendarIds: string[], after: string, before: string,
  client?: JMAPClient,           // default: the jmapClient singleton
): Promise<CalendarEvent[]>;
// calendar-reminder-owner.ts
export async function readRemindedOnDevice(
  registryId: string, primaryJmapAccountId: string | null,
): Promise<((event: CalendarEvent) => boolean) | null>;
```

- [ ] **Step 1: Map the dependencies before moving code**

```bash
sed -n 8,50p src/stores/calendar-store.ts
grep -n "supportsSyntheticCalendarIds\|queryExpandedEvents\|fetchEvents\|hydrateExpandedOccurrences\|queryEvents\|isCalendarAccessDenied\|noteCalendarAccessError\|mapServerEventToStoreEvent" src/stores/calendar-store.ts | head -30
grep -n "^import" src/stores/device-sync-store.ts
```
For each helper `loadEventsInRange` calls, record whether it comes from `src/api/calendar.ts` (bound to the singleton) or is defined in the store file. The API helpers are singleton-bound: if they have no client parameter, add an optional trailing `client` parameter to the ones the range loader uses, defaulting to `jmapClient`, rather than duplicating them. `mapServerEventToStoreEvent` and the `knownMasters`/access-denied maps that live in the store file move with the loader only if the loader needs them; otherwise inject them as callbacks. The goal: `calendar-events-range.ts` imports nothing from `src/stores/*`, `locale-store`, or `device-sync/app/request`.

- [ ] **Step 2: Move the loader**

Create `calendar-events-range.ts` with `loadEventsInRange` (body unchanged except the added `client` plumbing) and move the pure helpers it needs. In `calendar-store.ts`: `import { loadEventsInRange } from '../lib/calendar-events-range'; export { loadEventsInRange };` and delete the old body. Keep the doc comment above it.

- [ ] **Step 3: Verify the move is behavior-neutral**

Run: `npm run typecheck && npx vitest run src/stores src/lib/__tests__/calendar-notifications.test.ts`
Expected: PASS.
Then confirm purity: `grep -n "from '\.\./stores\|locale-store\|device-sync/app/request" src/lib/calendar-events-range.ts` prints nothing.

- [ ] **Step 4: Write the failing test for the owner filter**

`readRemindedOnDevice` reads AsyncStorage (in-memory mock from `src/test-setup.ts`) and mocks `getSyncSettings` from `device-sync/native`, `hasSyncPermissions`, and `deviceSyncAvailable`. Cases:

```ts
it('is null when device sync is not enabled for the account', ...)          // no persisted entry
it('is null when the device owns reminders but Android sync cannot be read', ...) // getSyncSettings rejects -> Bulwark reminds
it('is null when reminderOwner is "app"', ...)
it('flags events of selected calendars when Android says the calendar receives', ...)
it('never throws on malformed persisted JSON', ...)                          // returns null
```
Use the persisted shape that `persistedAccounts` parses (`{ state: { accounts: { [registryId]: AccountDeviceSync } } }`); copy a fixture from `src/stores/__tests__/device-sync-store.test.ts`.

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/calendar-reminder-owner.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 6: Implement `calendar-reminder-owner.ts`**

Port `remindedOnDevice` from `src/device-sync/app/reminders.ts:84-109` (and its helpers `deviceOwnsReminders`, `calendarReceives`) so that:
- the account entry comes from `persistedAccounts(await AsyncStorage.getItem(DEVICE_SYNC_STORAGE_KEY))[registryId]` instead of `useDeviceSyncStore`;
- Android's state is read once, awaited (no listener set), via `getSyncSettings` and `hasSyncPermissions`;
- every failure path returns `null`.

The pure selection helpers (`selectionFor`, `isCollectionSelected`, `syncOnInApp`) live in `stores/device-sync-store.ts`. If they are exported as plain functions, importing the module would still pull in the store, so move them to `src/device-sync/common/` (next to `collectionKey`) and re-export them from the store file so no other import changes. Do not duplicate them.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run src/lib/__tests__/calendar-reminder-owner.test.ts src/stores src/device-sync && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src
git commit -m "refactor(calendar): load events and read the reminder owner without the stores"
```

---

### Task 5: Headless refresh

**Files:**
- Create: `src/lib/calendar-reminders-background.ts`
- Create: `src/lib/__tests__/calendar-reminders-background.test.ts`
- Modify: `index.ts` (register the task)

**Interfaces:**
- Consumes: Task 3 (`reconcileReminders`, `cancelReminders`, `ensureChannel`, `HORIZON_MS`, `LOOKBEHIND_MS`, `LOOKAHEAD_MS`, `MAX_SCHEDULED`), Task 4 (`loadEventsInRange`, `readRemindedOnDevice`), `openClient` from `src/widgets/jmap.ts`, `notificationLocale` from `src/lib/push-background-task.ts`, `getUpcomingAlerts(events, tasks, calendars, { now, horizonMs, limit }, t)` from `calendar-alert-scheduler`, `getDictionary`/`t` factory used by `push-background-task.ts` (find how it builds `t` from a locale: `grep -n "getDictionary" src/lib/push-background-task.ts`).
- Produces: `export async function refreshCalendarRemindersInBackground(): Promise<void>` (never rejects).

- [ ] **Step 1: Find how to read the active account and the calendars**

```bash
grep -n "activeAccountId" src/stores/account-store.ts src/stores/auth-store.ts | head
grep -n "export async function \(getCalendars\|fetchCalendars\)\|Calendar/get" src/api/calendar.ts | head
grep -n "calendarNotificationsEnabled\|partialize" src/stores/settings-store.ts | head
```
Settings are persisted under `webmail:settings:v1` (see `push-background-task.ts:27`) as `{ state: {...} }`; the registry under `account-registry` (`push-background-task.ts:33`). Use the same read-and-parse style as `emailNotificationsAllowed` there, with local key constants and a comment that they mirror the stores (as `push-background-task.ts` does). The Calendar fetch needs a client-parameterised variant: use `client.request([['Calendar/get', { accountId, ids: null }, '0']], [CAPABILITIES.CORE, CAPABILITIES.CALENDARS])`, mapping the result the same way `fetchCalendars` in `calendar-store.ts` does (shared calendars are namespaced `${accountId}:${id}`; mirror that mapping or reuse a pure mapper if one exists).

- [ ] **Step 2: Write the failing tests**

Mock `@react-native-async-storage/async-storage` (already global), `expo-notifications`, `../../widgets/jmap` (`openClient`), `../calendar-events-range`, `../calendar-reminder-owner`, `../push-background-task` (`notificationLocale`). Cases, each asserting on `Notifications.scheduleNotificationAsync` / `cancelScheduledNotificationAsync`:

```ts
it('schedules the reminders of upcoming events')
it('cancels pending event reminders when the setting is off, leaving task reminders')
it('cancels pending event reminders when signed out (no active account)')
it('schedules nothing and does not prompt when notification permission is missing')   // requestPermissionsAsync not called
it('leaves the schedule untouched when openClient returns null (offline / no credentials)')
it('leaves the schedule untouched when the event fetch throws')
it('leaves the schedule untouched when the account has no calendars')
it('skips events of calendars the device calendar app reminds of')
it('never rejects')
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/calendar-reminders-background.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/calendar-reminders-background.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
// ...no store, screen or Expo UI imports (CLAUDE.md, headless rule)...

export async function refreshCalendarRemindersInBackground(): Promise<void> {
  try {
    const settings = await readPersistedSettings();       // { calendarNotificationsEnabled, enableCalendarTasks } | null
    // Unreadable settings: the foreground decides next time it runs.
    if (!settings) return;
    const accountId = await readActiveAccountId();
    if (!settings.calendarNotificationsEnabled || !accountId) {
      await cancelReminders(['event']);
      return;
    }
    const granted = (await Notifications.getPermissionsAsync()).granted;
    if (!granted) return;                                  // never prompt from the background

    const client = await openClient(accountId);
    if (!client) return;                                   // offline or revoked: keep what is scheduled
    const calendars = await loadCalendars(client);
    if (!calendars || calendars.length === 0) return;
    if (!hasCalendarCapabilityOf(client.currentSession)) { await cancelReminders(['event']); return; }

    const now = Date.now();
    const events = await loadEventsInRange(
      calendars, calendars.map((c) => c.id),
      new Date(now - LOOKBEHIND_MS).toISOString(),
      new Date(now + HORIZON_MS + LOOKAHEAD_MS).toISOString(),
      client,
    );
    const onDevice = await readRemindedOnDevice(accountId, primaryAccountOf(client));
    const own = onDevice ? events.filter((e) => !onDevice(e)) : events;

    const locale = await notificationLocale();
    const t = translatorFor(locale);
    await ensureChannel(locale, t);
    const wanted = getUpcomingAlerts(own, [], calendars, { now, horizonMs: HORIZON_MS, limit: MAX_SCHEDULED }, t)
      .filter((a) => a.kind === 'event');
    await reconcileReminders(wanted, locale, { kinds: ['event'], appAccountId: accountId });
  } catch (err) {
    console.warn('[calendar-reminders] background refresh failed', err);
  }
}
```
Fill the small helpers (`readPersistedSettings`, `readActiveAccountId`, `loadCalendars`, `hasCalendarCapabilityOf`, `primaryAccountOf`, `translatorFor`) with the findings from Step 1, each a few lines, each returning `null`/`false` on any error. `hasCalendarCapability()` in `./capabilities` reads the singleton; check `client.currentSession?.capabilities` for `CAPABILITIES.CALENDARS` directly.

- [ ] **Step 5: Register the headless task in `index.ts`**

After the `BulwarkDeviceSync` block:

```ts
// Calendar reminders (Android): a calendar push or the 6-hourly job runs this
// to bring the scheduled reminders up to date without opening the app.
// Required on first use so an app start does not load it.
AppRegistry.registerHeadlessTask('BulwarkCalendarReminders', () => async () => {
  const { refreshCalendarRemindersInBackground } = require('./src/lib/calendar-reminders-background') as typeof import('./src/lib/calendar-reminders-background');
  await refreshCalendarRemindersInBackground();
});
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run src/lib/__tests__/calendar-reminders-background.test.ts && npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/calendar-reminders-background.ts src/lib/__tests__/calendar-reminders-background.test.ts index.ts
git commit -m "feat(calendar): refresh event reminders in a background task"
```

---

### Task 6: Calendar types in the push subscription

**Files:**
- Modify: `src/lib/push-notifications.ts:233-247` (`pushTypesFor`), plus the resubscribe trigger
- Test: `src/lib/__tests__/push-notifications.test.ts` (extend near lines 438-453)

**Interfaces:**
- Consumes: persisted settings JSON (`webmail:settings:v1`, `calendarNotificationsEnabled`, default `true` when absent).
- Produces: `pushTypesFor(accountId, session)` includes `CalendarEvent` and `Calendar` iff the session advertises `CAPABILITIES.CALENDARS` and the setting is on (deduplicated with device-sync types).

- [ ] **Step 1: Write failing tests (extend the existing describe)**

```ts
it('adds the calendar types when calendar notifications are on and the server has calendars', async () => {
  // settings in AsyncStorage: calendarNotificationsEnabled true / absent
  expect(await pushTypesFor(ACCOUNT_ID, SYNC_SESSION as unknown as JMAPSession))
    .toEqual(expect.arrayContaining(['EmailDelivery', 'CalendarEvent', 'Calendar']));
});
it('leaves them out when calendar notifications are off', ...)
it('leaves them out when the session has no calendars capability', ...)
it('lists each type once when device sync also wants the calendar types', ...)
```
Check the existing tests' expectations at lines 438-453: those that expect exactly `['EmailDelivery']` must now set `calendarNotificationsEnabled: false` in the mocked settings, since the default is on. That is an intentional behavior change; adjust the fixtures, not the assertions.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/push-notifications.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

In `pushTypesFor`, after the device-sync `extra`, add:

```ts
// Calendar reminders (docs/plans/2026-10-16-calendar-reminders-adr.md): a
// calendar change must wake the app so the scheduled reminders follow it.
if (CAPABILITIES.CALENDARS in capabilities && (await calendarRemindersEnabled())) {
  for (const type of ['CalendarEvent', 'Calendar']) if (!extra.includes(type)) extra.push(type);
}
```
`calendarRemindersEnabled()` reads `SETTINGS_STORAGE_KEY` via AsyncStorage (same pattern as `emailNotificationsAllowed` in `push-background-task.ts`; reuse that key constant by exporting it rather than redefining) and returns `true` when the key is absent, `false` when `calendarNotificationsEnabled === false`, and `false` on read errors only if that matches the existing helpers' convention (fail toward the default, which is on, to avoid dropping reminders).

- [ ] **Step 4: Resubscribe when the setting flips**

`refreshPushSubscriptionTypes(accountId)` (line ~1270) already updates an existing subscription. Find where device-sync toggles call it (`grep -n "refreshPushSubscriptionTypes" -r src`) and add a `useSettingsStore.subscribe` listener in `startCalendarNotificationSync` that calls it for the active account when `calendarNotificationsEnabled` changes. Keep the import lazy or local if it would create a cycle (`push-notifications` must not import `calendar-notifications`).

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/lib && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/push-notifications.ts src/lib/calendar-notifications.ts src/lib/__tests__/push-notifications.test.ts
git commit -m "feat(calendar): subscribe to calendar changes so reminders follow them"
```

---

### Task 7: Native trigger: routing flag and JobService

**Files:**
- Modify: `android/app/src/main/java/com/anonymous/bulwarkmobile/sync/PushRouting.kt`
- Create: `android/app/src/main/java/com/anonymous/bulwarkmobile/BulwarkCalendarReminderJobService.kt`
- Modify: `android/app/src/main/java/com/anonymous/bulwarkmobile/BulwarkMessagingService.kt:32`, `BulwarkUnifiedPushService.kt:37`
- Modify: `android/app/src/main/AndroidManifest.xml` (service entry beside line 78)
- Check for existing Kotlin unit tests for `PushRouting`: `ls android/app/src/test 2>/dev/null`

**Interfaces:**
- Produces:
```kotlin
// PushRouting.Decision gains:
val calendarReminders: Boolean   // true when any account's changed types include CalendarEvent or Calendar
// DeviceSyncPushRouter.route(context, data) now returns a RouteResult
data class RouteResult(val startMailTask: Boolean, val calendarReminders: Boolean)
// BulwarkCalendarReminderJobService.Companion
fun scheduleNow(context: Context): Boolean          // one-off job, fixed id, network required
fun schedulePeriodic(context: Context): Boolean     // 6 h, persisted, network required
fun cancelPeriodic(context: Context)
```
Job ids: `ONE_OFF_JOB_ID = 0x42554c40`, `PERIODIC_JOB_ID = 0x42554c41` (outside the push block `0x42554c00..0x42554c1f`). A fixed one-off id means a burst of pushes coalesces into one pending job.

- [ ] **Step 1: Extend `PushRouting.decide`**

Add `calendarReminders: Boolean` to `Decision`. In the loop, `if (calendar) calendarReminders = true` (note: set it from the types alone, independent of `routes`, since reminders don't need device sync). Update the class doc comment to mention it. `startMailTask` logic is untouched, which keeps agreement with `carriesNoMail`.

If a Kotlin test source set exists, add cases: a calendar-only StateChange gives `calendarReminders = true, startMailTask = false`; a mail+calendar change gives both; a malformed `changed` gives `startMailTask = true`. If none exists, state that in the commit message and cover it in device verification (Task 9).

- [ ] **Step 2: Update `DeviceSyncPushRouter.route` and its two callers**

Return `RouteResult`; the failure path returns `RouteResult(startMailTask = true, calendarReminders = false)`. In both messaging services:

```kotlin
val routed = DeviceSyncPushRouter.route(applicationContext, data)
if (routed.calendarReminders) BulwarkCalendarReminderJobService.scheduleNow(applicationContext)
if (routed.startMailTask && !isAppInForeground()) startHeadlessTask(applicationContext, data)
```
(Keep each service's existing surrounding code and comments; only the variable and the added line change. In the foreground the app's own EventSource already reschedules, and the job refuses cleanly, see Step 3.)

- [ ] **Step 3: Create the JobService**

Model it on `BulwarkPushJobService.kt`: same `HeadlessJsTaskEventListener` bookkeeping, `HeadlessJs.withReadyReactContext(application) { ... }`, `onRefused` → `jobFinished`. The task config is `HeadlessJsTaskConfig("BulwarkCalendarReminders", Arguments.createMap(), 30_000, true)`; check `BulwarkPushTaskService.taskConfig(...)` for the exact constructor arguments (timeout, `allowedInForeground`) and mirror them. Companion:

```kotlin
companion object {
    private const val TAG = "BulwarkCalReminders"
    private const val ONE_OFF_JOB_ID = 0x42554c40
    private const val PERIODIC_JOB_ID = 0x42554c41
    private const val PERIOD_MS = 6 * 60 * 60 * 1000L

    fun scheduleNow(context: Context): Boolean = schedule(context) {
        JobInfo.Builder(ONE_OFF_JOB_ID, component(context))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setExpedited(true) }
            .build()
    }

    fun schedulePeriodic(context: Context): Boolean = schedule(context) {
        JobInfo.Builder(PERIODIC_JOB_ID, component(context))
            .setPeriodic(PERIOD_MS)
            .setPersisted(true)   // needs RECEIVE_BOOT_COMPLETED, present in the manifest merge (Task 1)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .build()
    }

    fun cancelPeriodic(context: Context) {
        try { context.getSystemService(JobScheduler::class.java).cancel(PERIODIC_JOB_ID) } catch (e: Exception) { Log.w(TAG, "cancel failed", e) }
    }

    private fun component(c: Context) = ComponentName(c, BulwarkCalendarReminderJobService::class.java)
    private fun schedule(c: Context, build: () -> JobInfo): Boolean = try {
        c.getSystemService(JobScheduler::class.java).schedule(build()) == JobScheduler.RESULT_SUCCESS
    } catch (e: Exception) { Log.w(TAG, "job not scheduled", e); false }
}
```
Guard `schedulePeriodic` against rescheduling an identical pending job on every app launch (which resets its period timer): if `scheduler.getPendingJob(PERIODIC_JOB_ID) != null`, return `true` without rescheduling.

`setPersisted(true)` requires `RECEIVE_BOOT_COMPLETED`; if Task 1 showed the library does not merge it, add `<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>` to the manifest here.

- [ ] **Step 4: Register in the manifest, beside line 78**

```xml
<service android:name=".BulwarkCalendarReminderJobService" android:permission="android.permission.BIND_JOB_SERVICE" android:exported="false"/>
```

- [ ] **Step 5: Build**

```bash
cd android && ./gradlew :app:compileDebugKotlin && cd ..
```
Expected: BUILD SUCCESSFUL (and any Kotlin unit tests from Step 1 pass via `./gradlew :app:testDebugUnitTest`).

- [ ] **Step 6: Commit**

```bash
git add android
git commit -m "feat(calendar): start the reminder refresh from calendar pushes"
```

---

### Task 8: Native periodic job: JS bridge and lifecycle

**Files:**
- Modify: `android/.../BulwarkFcmModule.kt` (two `@ReactMethod`s)
- Modify: the JS wrapper for `BulwarkFcmModule` (`grep -n "NativeModules.BulwarkFcm" -r src` to find it, likely `src/lib/push-notifications.ts` or a `native-fcm` file)
- Modify: `src/lib/calendar-notifications.ts` (`startCalendarNotificationSync`, `rescheduleCalendarNotifications`)
- Modify: sign-out path (`src/stores/auth-store.ts`, where `cancelAllCalendarNotifications` is already called, check with `grep -n cancelAllCalendarNotifications -r src`)
- Test: extend `src/lib/__tests__/calendar-notifications.test.ts`

**Interfaces:**
- Produces: `BulwarkFcm.scheduleCalendarReminderJob(): Promise<boolean>` and `BulwarkFcm.cancelCalendarReminderJob(): Promise<void>`; JS helpers `setCalendarReminderJob(enabled: boolean): Promise<void>` (no-op off Android or if the native module is missing).

- [ ] **Step 1: Write the failing tests**

In `calendar-notifications.test.ts`, mock the JS wrapper and assert:
```ts
it('schedules the periodic job when reminders are on and the user is signed in')
it('cancels the periodic job when the setting is switched off')
it('cancels the periodic job when signed out')
```
(Drive them through `rescheduleCalendarNotifications`, which already branches on `calendarNotificationsEnabled` and `isSignedOut`.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/__tests__/calendar-notifications.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Native methods**

```kotlin
@ReactMethod
fun scheduleCalendarReminderJob(promise: Promise) {
    promise.resolve(BulwarkCalendarReminderJobService.schedulePeriodic(reactApplicationContext))
}

@ReactMethod
fun cancelCalendarReminderJob(promise: Promise) {
    BulwarkCalendarReminderJobService.cancelPeriodic(reactApplicationContext)
    promise.resolve(null)
}
```

- [ ] **Step 4: JS side**

Add `setCalendarReminderJob(enabled)` next to the existing FCM wrapper (Android only, try/catch, never throws). In `rescheduleCalendarNotifications`, in the branch `!calendarNotificationsEnabled || isSignedOut()` call `await setCalendarReminderJob(false)` after cancelling; after permission and channel succeed (the "on" path), call `void setCalendarReminderJob(true)`. This covers launch, sign-in, and the setting flip, since all call `rescheduleCalendarNotifications`. Sign-out already reaches the cancel branch via the auth subscription; confirm with the existing `cancelAllCalendarNotifications` call site.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test && npm run typecheck && (cd android && ./gradlew :app:compileDebugKotlin)`
Expected: PASS / BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
git add android src
git commit -m "feat(calendar): refresh reminders every 6 hours in the background"
```

---

### Task 9: Docs

**Files:**
- Modify: `docs/parity/05-calendar.md:249,258`
- Modify: `docs/parity/08-settings-push-i18n-ui.md:59,86`
- Modify: `docs/device-sync.md` ("Triggers" section)
- Modify: `docs/plans/2026-10-16-calendar-reminders-adr.md` (Status line)

- [ ] **Step 1: Edit the docs**

- `05-calendar.md:249`: tick the box for the background refresh; `:258`: rewrite the stale text to say reminders are exact (`USE_EXACT_ALARM`) and refreshed by push and a 6-hourly job on Android; iOS foreground only.
- `08-settings-push-i18n-ui.md:59,86`: `calendarNotificationsEnabled` is read by the scheduler, the background task and `pushTypesFor`.
- `device-sync.md` "Triggers": calendar push types are subscribed for reminders as well; the push router starts `BulwarkCalendarReminders` when `calendarReminders` is set, independent of device sync.
- ADR: `Status: Accepted. Implemented.`

- [ ] **Step 2: Commit**

```bash
git add docs
git commit -m "docs: record the background calendar reminder refresh"
```

---

### Task 10: Full verification and device check

- [ ] **Step 1: CI gates**

```bash
npm run typecheck && npm test
npm run i18n:harvest && git status --short locales
```
Expected: pass; no new locale keys (no new strings were added). If `i18n:harvest` changed `locales/rn/en.json`, commit it.

- [ ] **Step 2: Device verification (Android 13+ device, `npm run android`)**

1. `adb shell dumpsys alarm | grep bulwarkmobile`: reminder alarms are `RTC_WAKEUP`, exact.
2. Event 10 min ahead with a 5-min reminder; `adb shell dumpsys deviceidle force-idle`; the notification posts on the minute.
3. Kill the app (`adb shell am force-stop com.anonymous.bulwarkmobile`). Create an event in the webmail 20 min ahead with a 10-min reminder. `adb logcat | grep -i bulwark` shows the job start; the notification arrives without opening the app. **This is also the answer to the open question: does expo-notifications work in the headless React context?** If scheduling fails there, log the error, and fall back to patching or to scheduling via the native module; stop and report before continuing.
4. `adb shell cmd jobscheduler run -f com.anonymous.bulwarkmobile 1112624193` (0x42554c41): a reschedule happens.
5. Switch the setting off: pending reminders gone, `adb shell dumpsys jobscheduler | grep -i bulwark` shows no periodic job, and a webmail change no longer starts the job (push types dropped after the resubscribe).
6. Calendar-only push: confirm no mail notification appears.

- [ ] **Step 3: Report**

State which device steps were run and their results. Do not claim device behavior verified for steps that weren't run.

---

## Self-Review

**Spec coverage:** Part A → Tasks 1-2. B1 → Tasks 3-4. B2 → Task 5. B3 push → Tasks 6-7; periodic → Tasks 7-8. B4 docs → Task 9. Tests listed in the plan → Tasks 3, 4, 5, 6, 8. On-device verification → Task 10. Out-of-scope items (iOS, other accounts, text) are untouched.

**Additions beyond the source docs:** deterministic notification identifiers (Task 3, Review Focus 1), guard against re-scheduling an identical periodic job on every launch (Task 7), `RECEIVE_BOOT_COMPLETED` fallback (Task 7), and a fixed one-off job id so push bursts coalesce.

**Known soft spots (resolved by reading code in the task, not guessed here):** the exact helper set `loadEventsInRange` drags along (Task 4 Step 1), where the active account id and calendar mapping live for headless reads (Task 5 Step 1), and the Kotlin `HeadlessJsTaskConfig` constructor arguments (Task 7 Step 3). Each has a concrete command to answer it.

**Type consistency:** `reconcileReminders(wanted, locale, { kinds, appAccountId })`, `cancelReminders(kinds?)`, `ensureChannel(locale, t)`, `loadEventsInRange(..., client?)`, `readRemindedOnDevice(registryId, primaryJmapAccountId)`, `DeviceSyncPushRouter.route` → `RouteResult`, and job ids are used with the same names in every task.
