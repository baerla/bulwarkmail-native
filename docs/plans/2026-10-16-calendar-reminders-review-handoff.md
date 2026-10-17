# Review handoff: reliable calendar reminder notifications

- **Branch:** `claude/calendar-reminder-notifications-31f774`, cut from `main` at c903c4a (8 commits ahead, `git log main..HEAD --oneline`)
- **Status:** implemented, **not merged, not verified on Android**. Waiting for review and device checks.
- **Read first:** [ADR](2026-10-16-calendar-reminders-adr.md) (why), [plan](2026-10-16-calendar-reminders-plan.md) (what), [implementation plan](2026-10-16-calendar-reminders-implementation.md) (ordered tasks, Global Constraints, Review Focus), [original handoff](2026-10-16-calendar-reminders-handoff.md) (code map). Repo rules: `CLAUDE.md`.

## Goal
An event at 16:00 with a "30 minutes before" alert posts its notification at 15:30, also when the event was created in the webmail and the app hasn't been opened since. Notification text is unchanged.

## What was built (by commit, oldest first)
1. `5d4d4e1` Manifest: `USE_EXACT_ALARM`, `SCHEDULE_EXACT_ALARM` (`maxSdkVersion=32`). expo-notifications already calls `setExactAndAllowWhileIdle` when `canScheduleExactAlarms()` and merges `RECEIVE_BOOT_COMPLETED`, so no patch (checked in `ExpoSchedulingDelegate.kt`).
2. `34bee76` `src/lib/calendar-reminder-reconcile.ts` (new, store-free): constants, `ensureChannel(locale, t)`, `scheduleOne` (deterministic identifier `bulwark-cal:<key>`), `reconcileReminders(wanted, locale, {kinds, appAccountId})`, `cancelReminders(kinds?)`. `calendar-notifications.ts` delegates to it.
3. `7dcb8bb` `src/lib/calendar-events-range.ts` (new): `loadEventsInRange(..., client?)` and `mapServerEventToStoreEvent` moved out of `calendar-store.ts` (re-exported there). `src/api/calendar.ts` helpers gained an optional trailing `client: JMAPClient = jmapClient`. `src/lib/calendar-reminder-owner.ts` (new): `readRemindedOnDevice(registryId, primaryJmapAccountId)`, the store-free twin of `remindedOnDevice`.
4. `21594ca` `src/lib/calendar-reminders-background.ts` (new): `refreshCalendarRemindersInBackground()`; registered in `index.ts` as headless task `BulwarkCalendarReminders` (lazy `require`). Purity test `calendar-reminders-background-purity.test.ts` walks its import graph.
5. `8fe28b1` `pushTypesFor` adds `CalendarEvent`/`Calendar` when the session has the calendars capability and `calendarNotificationsEnabled` is not false. `startCalendarNotificationSync` refreshes push subscriptions when the setting flips.
6. `93c7850` Kotlin and bridge: `PushRouting.Decision.calendarReminders`, `PushRouteResult` from `DeviceSyncPushRouter.route`, new `BulwarkCalendarReminderJobService.kt` (one-off job id `0x42554c40`, periodic 6 h persisted job id `0x42554c41`), `BulwarkFcmModule.scheduleCalendarReminderJob/cancelCalendarReminderJob`, calls from `BulwarkMessagingService` and `BulwarkUnifiedPushService`, manifest service entry, JS wrapper `src/lib/calendar-reminder-job.ts` (`setCalendarReminderJob`).
7. `30b5870` Docs: `docs/parity/05-calendar.md`, `docs/parity/08-settings-push-i18n-ui.md`, `docs/device-sync.md` ("Triggers"), ADR status.
8. `c725c19` Review fixes (below).

## Verification state
- **Ran and passed:** `npm run typecheck`, `npm test` (3366 passed, 18 skipped), `npm run i18n:harvest` (no new keys).
- **NOT run:** anything Kotlin. There is **no JDK** in this environment, so `PushRouting.kt`, `BulwarkCalendarReminderJobService.kt`, `BulwarkFcmModule.kt`, both messaging services, the manifest and the new `PushRoutingTest.kt` cases were never compiled and the Kotlin tests' RED was never watched. A first reviewer read them and found no compile errors; that is not a build.
- **NOT run:** device checks (Task 10 of the implementation plan): `dumpsys alarm` exact alarms, Doze (`deviceidle force-idle`), kill app + create event in webmail, `cmd jobscheduler run -f com.anonymous.bulwarkmobile 1112624193` (0x42554c41), setting off cancels reminders and the periodic job, calendar-only push posts no mail notification.
- **Open question for the device:** does expo-notifications schedule correctly inside the headless React context created by `HeadlessJs.withReadyReactContext`? If not, stop and report.

## First review (fresh opus reviewer) and what was done
Fixed in `c725c19`, each with a test seen failing first:
- **Critical:** the settings store persists flat (`JSON.stringify(snapshot)`), but the background task and `pushTypesFor` read `.state.calendarNotificationsEnabled`, so the setting was always "on" there. Fixed in `calendar-reminders-background.ts` and `push-notifications.ts`; test fixtures now write the flat shape.
- **Important:** overlapping refreshes (foreground, headless, several pushes) could undo each other for a moved event. `withReminderLock` in the reconcile module now serializes the background path and `rescheduleCalendarNotifications`.
- **Important:** the cold headless runtime never loaded the settings store, so the calendar time-zone override was ignored. The background task now calls `settings.hydrate()` first (as `widgets/build.ts` does).
- **Important:** the setting is global but only the active account's push subscription was refreshed on a flip. Now every id from `readPushAccountIds()`.
- **Accepted and documented in the ADR:** older relays without a `changed` map give the mail task and no reminder refresh (they rely on the 6-hourly job); every calendar-capable account now subscribes to the calendar types while the setting is on.

## Deferred minors (not fixed, decide whether they matter)
- M1 `DeviceSyncPushRouter.route` catch path returns `calendarReminders = false`; could use `PushRouting.decide(data, emptyMap()).calendarReminders`.
- M2 `scheduleNow` runs even when `isAppInForeground()`; the job is refused and burns expedited quota. Guard like the mail task.
- M3 `reconcileReminders` cancels before it schedules; a task timeout in between can leave reminders missing.
- M4 reminders pending from before the upgrade keep inexact alarms until they fire.
- M5 `RECEIVE_BOOT_COMPLETED` (needed by `setPersisted(true)`) is only merged from expo-notifications; declare it in the app manifest.
- M6 the periodic job keeps running when notification permission is revoked.
- M7 a signed-out background run cancels only `['event']`, leaving task reminders.
- M8 `PushRouteResult` was inserted between `DeviceSyncPushRouter`'s KDoc and the object, so the KDoc attaches to the wrong declaration.

## Rulings made during implementation (check them)
- Worked on a new branch in place, no worktree (`main` untouched).
- The plan's helper scripts (`task-start`, `task-done`, `sdd-workspace`) have CRLF line endings and fail with ``bash\r``; the ledger was kept by hand in git-ignored `.superpowers/sdd/2026-10-16-calendar-reminders-implementation/progress.md` (added to `.git/info/exclude`).
- `api/calendar.ts` helpers got an optional `client` instead of duplicating them; `loadEventsInRange` passes it only when given so existing store tests keep their call shapes.
- The headless path loads `settings-store` (via `lib/calendar-timezone`) and `locale-store` (via `push-background-task` → `push-notifications`); both were already loaded in headless runs. The purity test allow-lists exactly these two, ignoring type-only imports.
- `readRemindedOnDevice` re-implements the 3-line collection selection rule with `collectionDefaultOn` rather than importing from `device-sync-store`.
- Background reads the active account from the persisted `account-registry` JSON (`state.activeAccountId`), settings from `webmail:settings:v1`.
- Tasks 7 and 8 went into one commit; `Decision.calendarReminders` defaults to `false`.

## What the next reviewer should do
1. `git diff main...HEAD`; read the ADR and the implementation plan's Global Constraints and Review Focus.
2. Run `npm install` (if `node_modules` is missing), `npm run typecheck`, `npm test`.
3. **Compile and test the Kotlin** where a JDK/Android SDK exists: `cd android && ./gradlew :app:compileDebugKotlin :app:testDebugUnitTest`. Fix anything that fails; the new `PushRoutingTest` cases are `a calendar-only change asks for the reminder refresh…`, `mail and calendar together ask for both`, `mail and contact changes leave the reminders alone`.
4. Review with fresh eyes, especially: the headless purity rule (CLAUDE.md), the job service's behaviour when a running job is replaced by `schedule()` with the same id, `PushRouting.decide` vs `carriesNoMail` agreement, and the lock covering every code path that reconciles.
5. Decide on the deferred minors; M2 and M5 are one-liners.
6. Run the device checks listed above and report which ones were actually run.
7. Do not merge or push without the user's go-ahead. Commit messages: Conventional Commit, plain language, ending with the `Co-Authored-By` attribution line from the session.

## Constraints to keep
`android/` is hand-edited (no prebuild); never edit `ios/`; no new top-level imports in `index.ts` or headless paths that pull in stores, screens or Expo UI; background reconcile touches only `kind: 'event'` and only the active account; if the calendar or network can't be read, leave pending reminders alone; if Android's sync state can't be read, Bulwark reminds; `locales/<lang>/common.json` is vendored, don't edit.
