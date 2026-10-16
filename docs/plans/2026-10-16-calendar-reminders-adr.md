# ADR: Exact, background-refreshed local notifications for calendar reminders

- **Status:** Accepted. Not yet implemented; see the [handoff](2026-10-16-calendar-reminders-handoff.md).
- **Date:** 2026-10-16
- **Plan:** [2026-10-16-calendar-reminders-plan.md](2026-10-16-calendar-reminders-plan.md)

## Context

Calendar event reminders are already shown as local notifications.
- Commit 8e1d03c added this, and later commits refined it.
- `src/lib/calendar-notifications.ts` schedules expo-notifications `DATE` triggers for the alerts of the next 7 days, with at most 48 pending.
- The trigger maths come from the webmail: `src/lib/calendar-alert-scheduler.ts`.

Users report that reminders **don't fire, or fire late**. An example: an event starts at 16:00 and has a reminder 30 minutes before. The notification should post at 15:30. We found two causes.

1. **Inexact alarms.** The hand-maintained `android/app/src/main/AndroidManifest.xml` declares neither `SCHEDULE_EXACT_ALARM` nor `USE_EXACT_ALARM`. On Android 12 and later, an app without exact-alarm access gets inexact, allow-while-idle alarms. Doze batches these into maintenance windows, which can be many minutes late.
2. **Stale schedule.** Reminders are only rescheduled while the JS app runs:
   - at launch and on return to the foreground,
   - on JMAP StateChange over the in-app EventSource,
   - on store and settings changes.

   So an event created or moved in the webmail, or on another device, gets no reminder until the app is opened. After 7 days without opening the app, nothing is scheduled at all. The push subscription carries only `EmailDelivery`, unless device sync adds the calendar types. `docs/parity/05-calendar.md` lists this gap as deferred.

The constraints come from `CLAUDE.md` and the existing design:
- `android/` is edited by hand. Config plugins don't apply there.
- Headless code paths must not import stores, screens or Expo UI modules.
- Push is Android-only (FCM and UnifiedPush). iOS has no push in this app.
- The push relay is content-blind: it forwards only JMAP state, never event data.
- Device sync can already hand reminders to Android's calendar app (the "Reminder owner" choice, `docs/device-sync.md`). The Bulwark scheduler then skips those events.

## Decision

Keep expo-notifications local notifications as the delivery mechanism, and make them reliable on Android with two additions.

1. **Exact alarms.** Declare `USE_EXACT_ALARM` (Android 13+, granted at install) and `SCHEDULE_EXACT_ALARM` with `maxSdkVersion="32"` (Android 12). Confirm that the installed expo-notifications version uses `setExactAndAllowWhileIdle` once `canScheduleExactAlarms()` is true. If it does not, patch it via `patches/`.
2. **Headless background refresh.**
   - Add a store-free path, `refreshCalendarRemindersInBackground()`, run as headless task `BulwarkCalendarReminders`. It uses a detached `JMAPClient` and reconciles only *event* reminders against what the OS has pending.
   - A **JMAP push** of `CalendarEvent` or `Calendar` triggers it. These types are added to the push subscription whenever calendar notifications are on.
   - So does a **6-hourly periodic JobScheduler job**, which also needs no new dependency.
   - Both reach JS through a small JobService modelled on `BulwarkPushJobService`.

To support this, the scheduling and reconcile logic and `loadEventsInRange` move out of the store-coupled modules into store-free `src/lib` modules. The foreground sync keeps calling them.

## Options considered

### A. Leave as is: foreground-only scheduling with inexact alarms
Rejected. This is the behaviour users report as broken. It misses remote changes and fires late under Doze.

### B. Rely on Android's own calendar app through device sync
Device sync already writes Reminders rows, and the "Reminder owner: device" setting hands reminders to the system calendar app. That app's reminders are exact and refresh on sync.

Rejected as *the* fix. Keep it as an alternative users can pick. Reasons:
- It needs the user to opt in to device sync and to calendar permissions.
- It maps only start-relative alerts set before the start. End-relative, absolute and after-start alerts stay server-only.
- It doesn't cover tasks.
- The notification comes from another app, and a tap doesn't open the event in Bulwark.

### C. Send reminders from the server or relay
Examples: Stalwart sending alarm e-mails, or the relay pushing a "reminder due" message at fire time.

Rejected for these reasons:
- It needs changes outside this repo: the server, and the content-blind relay.
- It breaks the relay's privacy model, because the relay would have to know event times and titles.
- It wouldn't work offline. A local alarm fires without a network.

### D. Replace expo-notifications with Notifee or a native AlarmManager module
Rejected for these reasons:
- Notifee adds a large native dependency.
- A hand-written AlarmManager module duplicates scheduling, boot rescheduling and tap handling that expo-notifications already does. Calendar reminder taps, the foreground handler and the reconcile-by-key logic are all built on it.
- With the exact-alarm permission, expo-notifications schedules exact alarms, which fixes the timing.
- `patches/` remains the fallback if it falls short.

### E. Request only `SCHEDULE_EXACT_ALARM`
Rejected for these reasons:
- On Android 14+ this permission is denied by default for newly installed apps. The user would have to find a system settings screen and grant "Alarms & reminders" by hand. Most won't, so reminders would stay late.
- `USE_EXACT_ALARM` is granted automatically and is meant for exactly this case, calendar apps. Google Play restricts it to calendar and alarm apps, and this app qualifies. Distribution is a sideloaded APK in any case.
- We keep `SCHEDULE_EXACT_ALARM` capped at API 32, because `USE_EXACT_ALARM` only exists from API 33.

### F. Periodic background refresh only (expo-background-task / WorkManager)
Rejected as the only trigger, for these reasons:
- WorkManager's 15-minute floor, plus OEM throttling, means an event created in the webmail 20 minutes before a reminder may be picked up too late.
- `expo-background-task` would add a dependency.
- Android lets us use JobScheduler directly; `BulwarkPushJobService` already does.

We keep a periodic job, but only to move the 7-day horizon forward and catch missed pushes. Push is the primary trigger.

### G. Push-triggered refresh only
Rejected as the only trigger, for these reasons:
- Pushes can be dropped: FCM deprioritisation, a UnifiedPush distributor being killed, or no change for days.
- Without any change, the 7-day horizon would still expire.

Hence the hybrid of F and G.

### H. Reuse the existing stores in the headless task
That is, call `rescheduleCalendarNotifications()` from the headless task. Rejected for these reasons:
- It breaks the CLAUDE.md rule for headless code.
- It would hydrate every persisted store in a short-lived runtime, and it uses the singleton `jmapClient`, whose session belongs to the UI.

A store-free core shared by both paths keeps one implementation of the reconcile rules.

### I. Background refresh reconciles tasks too, or all accounts
Deferred. Two rules keep the background path safe:
- It touches only reminders of kind `event`. It never cancels task reminders it didn't load.
- Like the foreground, it serves the active account only.

Scheduling every signed-in account is a separate change, because the foreground reconcile would currently cancel the other accounts' reminders.

## Consequences

**Positive**
- Reminders fire on the minute on Android 12+, including under Doze.
- Events created elsewhere get reminders without opening the app, as long as push is set up. Otherwise they get them within about 6 hours.
- No new dependencies.
- Reminder logic becomes testable outside the stores.

**Negative / risks**
- When calendar notifications are on, more pushes wake the device: every calendar change, including the app's own writes. A fixed job id debounces them, and calendar-only pushes never post a mail notification (`carriesNoMail`, `PushRouting.decide`).
- expo-notifications must work in a headless React context. Verify this on a device.
- `USE_EXACT_ALARM` would need a policy declaration if the app ever ships on Google Play.
- iOS is unchanged. It still refreshes only in the foreground, because it has no push or background task in this app.
- Users who rely on Android's own calendar keep using the "Reminder owner: device" option from B, and Bulwark skips those events as before.
