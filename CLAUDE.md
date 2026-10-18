# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Bulwark Mobile: a React Native (Expo SDK 58, React Native 0.88, React 19) client for [Bulwark Webmail](https://github.com/bulwarkmail/webmail). It talks JMAP directly to the user's mail server (Stalwart is the reference server) for mail, calendar, contacts, files, Sieve filters and vacation. Beta; Android is the primary platform (sideloaded APK); iOS ships via TestFlight and lacks push, client certificates and device sync.

The webmail is the reference implementation. Many comments cite webmail issue numbers (`#702`) and "native #NN" for this repo's tracker. `PARITY_CHECKLIST.md` and `docs/parity/` track feature/bugfix parity against it, and `docs/audit-*.md` / `docs/ux-audit-*.md` hold audit findings. Tick their boxes when you fix a listed item.

## Commands

```bash
npm install            # also applies patches/ via patch-package (postinstall)
npm run android        # expo run:android: build + install the debug app, start Metro
npm run ios            # expo run:ios (macOS + Xcode; prebuilds the gitignored ios/)
npx expo start         # Metro only, for an already installed debug build
npm run typecheck      # tsc --noEmit  (CI runs this)
npm test               # vitest run    (CI runs this)
npx vitest run src/lib/__tests__/mailto.test.ts   # single file
npx vitest run -t "name of test"                  # by test name
npm run i18n:harvest   # add new t('key', 'Fallback') keys to locales/rn/en.json
npm run widgets:sync   # regenerate Android widget providers from src/widgets/catalog.json
npm run bump           # release: bump VERSION, commit, tag, push, create GitHub release (needs gh auth, clean tree)
```

The app cannot run in Expo Go: it uses custom native modules (`NativeModules.BulwarkFcm`, `BulwarkWidgets`, `BulwarkDeviceSync`, …) and has no `expo-dev-client`. Opening it via `npx expo start` → `a` tries Expo Go and fails (e.g. `TypeError: fetch failed`); use `npm run android`.

Tests only match `src/**/__tests__/**/*.test.ts` and run in a `node` environment. There are no component-render tests. `src/test-setup.ts` globally mocks `react-native`, AsyncStorage (in memory), SecureStore, netinfo and the Expo native modules so stores and libs load under Node. A test that needs real behaviour from one of them re-mocks it locally. Keep logic you want tested in `src/lib`, `src/api`, `src/stores` or `src/device-sync`, out of components.

## Architecture

- **Entry (`index.ts`)** registers several headless JS tasks before the UI: `BulwarkPushTask` (FCM/UnifiedPush data message), `BulwarkNotificationAction`, `BulwarkDeviceSync`, `BulwarkWidgetRefresh` and the widget task handler. A headless run evaluates this file too, so `App` and other heavy modules are `require()`d lazily. Never add top-level imports here or in headless code paths (`src/lib/push-background-task.ts`, `src/widgets/*`, `src/device-sync/*`) that pull in screens, stores or Expo UI modules.
- **`App.tsx`** holds the root native-stack and bottom-tab navigators and most of the app-wide wiring: session restore, live updates (`src/api/push-stream.ts`, the JMAP EventSource), push token listeners, network/offline transitions, notification taps and deep links (`src/navigation/linking.ts`, plus `pending-*.ts` handoff modules).
- **`src/api/`**: the JMAP layer. `jmap-client.ts` exports the `JMAPClient` class and the `jmapClient` singleton for the active account. It handles password and OAuth auth (refresh, credentials in SecureStore per account), mTLS via `secureFetch`, timeouts, 429 and `maxConcurrentRequests` retries. Per-domain modules (`email.ts`, `calendar.ts`, `contacts.ts`, `sieve.ts`, …) build method calls on top. Background code (device sync, widgets, push) creates detached `JMAPClient` instances per registry account, not the singleton. `own-writes.ts` records the app's own writes so state changes it caused are not treated as remote changes.
- **`src/stores/`**: Zustand stores, many with `persist` over AsyncStorage (`persist-storage.ts`). `auth-store` coordinates sign-in/out and multi-account switching across the other stores. `account-store` is the persisted account registry. Stores wait for hydration with a bound timeout (`HYDRATION_TIMEOUT_MS`). The mail, contacts and calendar stores subscribe to JMAP StateChange in `App.tsx`. Screens without a store listen via `src/lib/state-change-bus.ts`.
- **`src/lib/`**: almost all pure logic (mail HTML/quoting, recurrence, recipients, Sieve in `lib/sieve/`, OAuth, push, offline sync, layout hooks). It is the main target for unit tests.
- **`src/screens/` and `src/components/`**: UI grouped by area. `src/lib/use-layout.ts` and `src/navigation/pane.tsx` implement the tablet/landscape split view: a stack screen can render inside a detail pane, where `goBack` closes the pane.
- **`src/device-sync/`** (Android only): a two-way sync engine between JMAP address books/calendars and Android's Contacts/Calendar providers. Kotlin (`android/.../sync/`) is a thin SyncAdapter shell that starts the `BulwarkDeviceSync` headless task. The TypeScript engine reaches the providers through `NativeModules.BulwarkDeviceSync`. It must stay free of Expo imports. `docs/device-sync.md` is the full design doc (mapping tables, merge rules, failure matrix); read it before changing this area.
- **`src/widgets/`** (Android home-screen widgets via `react-native-android-widget`, patched in `patches/`): `catalog.json` is the source of truth. Run `npm run widgets:sync` after changing it. Snapshot data is fetched headlessly (`sync.ts`, `jmap.ts`) and rendered by `render.tsx` and `layouts/`. `docs/widgets-verification.md` covers device checks.
- **`src/theme/`**: color tokens and built-in themes, drawn to match the webmail (Tabler icons in `components/icons`).

## Native projects

- **`android/` is committed and maintained by hand. There is no `expo prebuild`.** Config plugins do not run for it, so manifest entries, schemes, permissions and native modules (`android/app/src/main/java/com/anonymous/bulwarkmobile/`: FCM, UnifiedPush, client certs, widgets, device sync) are edited directly. Changing `app.config.js` alone has no effect on Android.
- **`ios/` is gitignored and regenerated by `expo prebuild` in CI.** Never edit or commit it. iOS native changes go in `app.config.js` or a config plugin.
- `VERSION` is the single version source. `app.config.js` reads it, and `android/app/build.gradle` derives `versionCode` from it. Bump only via `npm run bump`. Release signing and CI release flows: `docs/android-release.md` and `docs/ios-release.md`.

## i18n

`src/i18n/index.ts` exposes `t(key, fallback, params)` with an ICU subset (arguments and plurals). `locales/<lang>/common.json` is **vendored verbatim from the webmail. Do not edit it.** (`npm run sync-locales` re-copies it when the webmail repo is checked out at `../../locales`.) Keys only the native app needs go in `locales/rn/<lang>.json`, merged on top at runtime. Always pass an English fallback to `t()`, reuse an existing webmail key when one fits, then run `npm run i18n:harvest`. `src/i18n/__tests__/keys.test.ts` fails if a literal key used in `src/` or `App.tsx` is missing from the merged English catalog.

## Conventions

- Commit messages are Conventional-Commit style in plain user-facing language, often ending with the issue number: `fix: keep the edits when the recurring event question is cancelled`, `feat(calendar): …`, `docs: …`, `chore: update version number to X`.
- Comments explain *why*: the server or platform behaviour, or the webmail issue being mirrored. Keep that density when touching code.
- The license is AGPL-3.0-only, with an app-store distribution permission.
