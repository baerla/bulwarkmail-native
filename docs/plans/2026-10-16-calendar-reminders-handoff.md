# Handoff: reliable calendar reminder notifications

- **Date:** 2026-10-16
- **Branch:** `claude/calendar-reminder-notifications-31f774`, based on `main` at 4e63003
- **Plan:** [2026-10-16-calendar-reminders-plan.md](2026-10-16-calendar-reminders-plan.md)
- **Decision record:** [2026-10-16-calendar-reminders-adr.md](2026-10-16-calendar-reminders-adr.md)

## Goal
Make calendar reminders reliable. An event at 16:00 with a "30 minutes before" alert must post a notification at 15:30. This must work even when the event was created in the webmail and the app hasn't been opened since. The notification text stays the same: the event title and "Starts in 30 minutes".

## Status
**Planning done. Nothing is implemented yet.** Only these three documents were added. `npm install` was started but aborted, so `node_modules` is missing in this worktree. Run it first, then the tests, typecheck and the expo-notifications check below.

## What already exists (don't rebuild)
**Scheduler.** `src/lib/calendar-notifications.ts`:
- `rescheduleCalendarNotifications()` reconciles the wanted alerts with `getAllScheduledNotificationsAsync` by key. It uses the 7-day horizon, at most 48 reminders, the `calendar-reminders` channel and the `bulwark-calendar-alert` data tag.
- `startCalendarNotificationSync()` connects the triggers: stores, settings, auth, locale, the StateChange bus and AppState.

**Alert maths.** `src/lib/calendar-alert-scheduler.ts`:
- `computeFireTime` (:49) and `getEffectiveAlerts` (:92).
- `getUpcomingAlerts(events, tasks, calendars, window, t)` (:143), which is pure.

**Event loading.** `loadEventsInRange` in `src/stores/calendar-store.ts:317` doesn't touch store state, but it lives in the store module and uses the `jmapClient` singleton.

**Device reminder owner.** `remindedOnDevice` in `src/device-sync/app/reminders.ts:84` imports `useDeviceSyncStore`, so it isn't headless-safe.

**Setting.** `calendarNotificationsEnabled` in `src/stores/settings-store.ts:263` (default `true`). The toggle is in `src/components/settings/NotificationSettings.tsx:491`.

**Tap handling.** `startCalendarReminderTapHandling` → `openCalendarReminder` (`App.tsx:134`) → `useCalendarReminderOpen`.

**Headless patterns to copy:**
- `src/lib/push-background-task.ts`:
  - `notificationLocale()` (:78)
  - `openDetachedSession` (:310)
  - `carriesNoMail` (:401)
- `src/widgets/jmap.ts` `openClient(registryAccountId)` (:25) for a detached client.
- `src/lib/push-notifications.ts` `pushTypesFor` reads persisted device-sync JSON without the store.

**Native patterns:**
- `BulwarkPushJobService.kt`: a JobService that runs a headless task through `HeadlessJs.withReadyReactContext`.
- `sync/PushRouting.kt` `decide()` already recognises `CalendarEvent` and `Calendar`.
- `BulwarkMessagingService.kt:32` and `BulwarkUnifiedPushService.kt:37` call `DeviceSyncPushRouter.route`.

**Tests already present** in `src/lib/__tests__/`:
- `calendar-alert-scheduler.test.ts`
- `calendar-notifications.test.ts`
- `calendar-reminder-open.test.ts`
- `calendar-alerts*.test.ts`

## Next steps (in order)
1. Run `npm install`. Read `node_modules/expo-notifications/android/**/ExpoSchedulingDelegate*` (or the delegate that schedules `DATE` triggers) and check:
   - (a) Does it use `setExactAndAllowWhileIdle` when `canScheduleExactAlarms()` is true?
   - (b) Does its manifest bring `RECEIVE_BOOT_COMPLETED` and a boot receiver?

   If either is missing, plan a `patches/` change.
2. **Part A:** add `USE_EXACT_ALARM` and `SCHEDULE_EXACT_ALARM` (`maxSdkVersion="32"`) to `android/app/src/main/AndroidManifest.xml`. This can be committed on its own.
3. **Part B1:** extract a store-free `src/lib/calendar-reminder-reconcile.ts` with a `kinds` filter, and `src/lib/calendar-events-range.ts`, which takes the client as a parameter. Add a store-free reminder-owner reader. Keep `calendar-notifications.test.ts` green.
4. **Part B2:** add `src/lib/calendar-reminders-background.ts` and register `BulwarkCalendarReminders` in `index.ts`, required lazily.
5. **Part B3:**
   - Add the calendar types to `pushTypesFor` when the setting is on, and resubscribe when it flips.
   - Add a `calendarReminders` flag to `PushRouting.decide`.
   - Add a new JobService: a one-off job on push and a 6-hourly persisted periodic job. Register it in the manifest.
   - Add native methods to schedule and cancel the periodic job, called from the foreground sync and on sign-out.
6. Write the tests listed in the plan, then run `npm run typecheck`, `npm test`, and `npm run i18n:harvest` if any keys were added.
7. Update the docs:
   - `docs/parity/05-calendar.md`: :249 (tick it) and :258 (stale text).
   - `docs/parity/08-settings-push-i18n-ui.md`: :59 and :86 (the setting is read now).
   - `docs/device-sync.md`, section "Triggers".
8. Verify on an Android device with the steps in the plan's "Verification on device" section: `dumpsys alarm`, `deviceidle force-idle`, killing the app and creating the event in the webmail, `cmd jobscheduler run -f`.

## Watch out for
- `android/` is hand-maintained. Manifest and Kotlin changes go there directly, never into `app.config.js`. Never edit `ios/`.
- Headless modules must not import stores, screens or Expo UI. `calendar-store.ts` imports `t` from `locale-store` and also imports `requestDeviceSync`, so move only the pure parts.
- Background reconcile must only cancel `kind: 'event'` reminders. Task reminders come from the store, which the background path doesn't load.
- If the calendar or the network can't be read, leave the pending reminders alone. Don't cancel what you can't re-derive; the foreground code follows the same rule.
- `PushRouting.decide` and `carriesNoMail` must keep agreeing. A calendar-only push must never post a mail notification.
- Keep the reminder-owner rule: if Android's sync state can't be read, Bulwark reminds.
- Commits should be Conventional-Commit style in plain language, for example `fix(calendar): fire event reminders on time while the phone sleeps`.

## Open questions
- Does expo-notifications run in the headless React context that `HeadlessJs.withReadyReactContext` creates? Verify this on a device early.
- The 6-hour period is a guess. A shorter period costs battery, and a longer one delays events created elsewhere when push is missing.
