# Reliable calendar reminder notifications

## Context
Event reminders already exist as local notifications: commit 8e1d03c and its follow-ups added `src/lib/calendar-notifications.ts`, which schedules expo-notifications `DATE` triggers for the next 7 days. The user reports that reminders **don't fire or fire late**. There are two causes:

1. **Timing.** The manifest has no exact-alarm permission. On Android 12+ expo-notifications then falls back to an inexact alarm, which Doze may defer by many minutes. A 15:30 reminder can arrive at 15:40 or later.
2. **Stale schedule.** Reminders are only rescheduled while the app runs: at launch, on foreground, and on SSE StateChange. An event created or changed elsewhere (webmail, another device) gets no reminder until the app is opened. After 7 days without opening the app, nothing at all is scheduled. `docs/parity/05-calendar.md:249` records this as deferred.

Goal: the example "event at 16:00, reminder 30 min before" posts its notification at 15:30, even when the event was created in the webmail and the app hasn't been opened since. The notification shows the title and "Starts in 30 minutes"; that text is unchanged.

## Part A: exact timing (small, ships on its own)
- `android/app/src/main/AndroidManifest.xml` (hand-maintained, no prebuild):
  - Add `<uses-permission android:name="android.permission.USE_EXACT_ALARM"/>`. It is granted automatically on Android 13+ and is meant for calendar and alarm apps.
  - Add `<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32"/>` for Android 12.
- Verify after `npm install`:
  - Read `node_modules/expo-notifications/android/.../ExpoSchedulingDelegate*` and confirm a `DATE` trigger uses `setExactAndAllowWhileIdle` once `canScheduleExactAlarms()` is true.
  - Confirm the library's merged manifest brings `RECEIVE_BOOT_COMPLETED` and its boot receiver, so alarms survive a reboot.
  - If either is missing, patch it via `patches/`.
- Nothing changes on iOS. `UNCalendarNotificationTrigger` is already exact.

## Part B: background refresh (Android)
Reschedule event reminders headlessly when calendar data changes on the server, and periodically so the 7-day horizon keeps moving.

### B1. Make the reminder logic usable without stores
- New `src/lib/calendar-reminder-reconcile.ts`, store-free. Move these here out of `calendar-notifications.ts`:
  - `CHANNEL_ID`, `DATA_TAG`, `alertKeyOf`, `isStaleLanguage`, `ensureChannel(locale, t)` and `scheduleOne`. `scheduleOne` takes `appAccountId` as a parameter instead of reading the auth store.
  - A new `reconcileReminders(wanted, locale, { kinds })`. `kinds` limits which pending reminders it may cancel. The background path passes `['event']`, so it never cancels task reminders it didn't load.
  - `calendar-notifications.ts` then keeps only the store and trigger wiring and calls this module.
- Move `loadEventsInRange` from `src/stores/calendar-store.ts:317` into a store-free module, `src/lib/calendar-events-range.ts`, with the client as a parameter. Defaults to `jmapClient`. The store re-exports or calls it. Its helpers (`expandRecurringEvents`, `mapServerEventToStoreEvent`, recurrence-instances) must come along or already be store-free. The store's `t` import is one to watch.
- Device-reminder owner filter: add a store-free variant of `remindedOnDevice` (`src/device-sync/app/reminders.ts`). It reads the persisted device-sync JSON, the same way `pushTypesFor` uses `persistedAccounts(...)` in `src/lib/push-notifications.ts`. If Android's sync state can't be read, Bulwark reminds; a double reminder is better than a missed one. This matches the existing rule.

### B2. Headless entry
New `src/lib/calendar-reminders-background.ts` exporting `refreshCalendarRemindersInBackground()`. It must not import any store or screen, per the CLAUDE.md headless rule:
- Read the persisted settings, and bail out unless `calendarNotificationsEnabled`. Read the active app account from the persisted auth/account registry; this keeps the foreground behaviour of active account only. Read the language with `notificationLocale()` (`push-background-task.ts:78`) and get `t` from `getDictionary`.
- Check notification permission with `getPermissionsAsync`, without prompting.
- Open a detached client with `openClient` (`src/widgets/jmap.ts:25`). Fetch `Calendar/get`, then the event window with the same LOOKBEHIND/HORIZON/LOOKAHEAD constants, which move to the reconcile module.
- Build the wanted reminders with `getUpcomingAlerts` (`calendar-alert-scheduler.ts:143`) from events only, then call `reconcileReminders(..., { kinds: ['event'] })`. Always resolve and catch everything.
- Register it in `index.ts` as headless task `BulwarkCalendarReminders`, with the module `require()`d lazily like `BulwarkDeviceSync`.

### B3. Triggers
- **Push.** In `pushTypesFor` (`src/lib/push-notifications.ts`), add `CalendarEvent` and `Calendar` when the session has the calendars capability and `calendarNotificationsEnabled` is on.
  - Re-register the push subscription when that setting flips. Follow how device-sync toggles trigger the resync.
  - `PushRouting.decide` (`android/.../sync/PushRouting.kt`) gets a `calendarReminders` flag, set whenever a calendar type is present.
  - `BulwarkMessagingService.kt` and `BulwarkUnifiedPushService.kt` then start the `BulwarkCalendarReminders` task. Do this through a small JobService (debounced by a fixed job id, network required), modelled on `BulwarkPushJobService.kt`, so it runs from the background.
  - `carriesNoMail` already keeps calendar-only pushes from notifying about mail.
- **Periodic.** The same JobService also schedules a persisted periodic job every 6 h with network required, so the horizon moves forward without app opens. Two new methods on `BulwarkFcmModule` (or a small new module) schedule and cancel it:
  - Schedule from `startCalendarNotificationSync` when the setting is on and the user is signed in.
  - Cancel when the setting goes off and on sign-out.
- Register the service in the manifest with `BIND_JOB_SERVICE`, `exported=false`.

### B4. Docs
- `docs/parity/05-calendar.md`:
  - Tick :249 for the background refresh.
  - Fix :258, which still describes the state before the fix.
- `docs/parity/08-settings-push-i18n-ui.md:59,86`: `calendarNotificationsEnabled` is read now.
- `docs/device-sync.md` "Triggers": note the calendar push types are added for reminders too.

## Tests (vitest, `src/lib/__tests__/`)
- `calendar-reminder-reconcile.test.ts`:
  - Cancels stale and unwanted reminders and adds missing ones.
  - `kinds: ['event']` leaves task reminders alone.
  - A language change rewords the reminders.
- `calendar-reminders-background.test.ts`, with expo-notifications, AsyncStorage and the detached client mocked:
  - Setting off: the event reminders are cancelled.
  - Offline or fetch failure: the schedule is left untouched.
  - Device-owned calendars are skipped.
- Extend the `pushTypesFor` tests: calendar types appear only with the capability and the setting on.
- Keep `calendar-notifications.test.ts` green after the extraction.
- `npm run typecheck`, `npm test`, `npm run i18n:harvest` if any key was added.

## Verification on device (Android)
1. Build with `npm run android`. Check `adb shell dumpsys alarm | grep bulwarkmobile` and confirm the reminder alarms are `RTC_WAKEUP` with an exact window.
2. Exact timing: create an event 10 min ahead with a 5-min reminder. Run `adb shell dumpsys deviceidle force-idle` and confirm the notification still posts on the minute.
3. Background refresh:
   - Kill the app. Create an event in the webmail 20 min ahead with a 10-min reminder.
   - Confirm the push starts the job (`adb logcat | grep -i bulwark`) and the notification arrives without opening the app.
4. Periodic job: `adb shell cmd jobscheduler run -f com.anonymous.bulwarkmobile <jobId>` and confirm a reschedule happens.
5. Turn the setting off: confirm the pending reminders are cancelled and the periodic job is gone (`dumpsys jobscheduler`).

## Out of scope
- iOS background refresh. iOS has no push in this app; the existing foreground resync stays.
- Reminders for non-active accounts.
- Changing the notification text.
