# Upgrade plan: Expo SDK 54 → 58 and React Native 0.81 → 0.88

Written 2026-10-18. Current state: Expo 54.0.37, React Native 0.81.5, React 19.1.0, TypeScript 5.9, Node 20 in CI, Gradle 8.14.3, hand-maintained `android/`, generated `ios/`.

Version facts below come from the Expo changelog posts and the React Native blog. Re-check them against the linked pages before starting. Verify with `npm view expo dist-tags` that SDK 58 and its React Native pin are stable. The SDK 58 post describes RN 0.88 as including "the 0.88 release candidate", and the RN blog lists 0.88 as 19 Oct 2026.

## Target

Expo SDK 58 (released 15 Oct 2026), which pins React Native 0.88. The React version is not stated in the SDK 58 post. RN 0.88 is reported to move to React 19.3.0, so let `expo install --fix` choose it.

SDK 58 is built for the iOS 27 SDK. Expo Go supports only the latest SDK, but the app uses development builds and sideloaded APKs, so that does not matter.

## Version map

| Expo SDK | Date | React Native | Notes |
|---|---|---|---|
| 54 (now) | | 0.81 | |
| 55 | early 2026 | 0.83 | Legacy architecture gone, `expo-av` removed |
| 56 | 21 May 2026 | 0.85 | Hermes V1 default, TS 6.0, `expo/fetch` as global fetch |
| 57 | 30 Jun 2026 | 0.86 | Mostly a minor-style bump |
| 58 | 15 Oct 2026 | 0.88 | Strict TS API default, R8 default, scene lifecycle |

Sources:
- https://expo.dev/changelog/sdk-55
- https://expo.dev/changelog/sdk-56
- https://expo.dev/changelog/sdk-57
- https://expo.dev/changelog/sdk-58
- https://reactnative.dev/blog
- https://reactnative.dev/docs/upgrading
- https://react-native-community.github.io/upgrade-helper/ (diffs for the hand-maintained `android/`)

## Changelog digest

### React Native

| Version | Changes |
|---|---|
| 0.82 | First release that is New Architecture only. |
| 0.83 | No user-facing breaking changes. |
| 0.84 | Legacy-architecture code removed on iOS and Android. Node 22 minimum. Hermes V1 default. |
| 0.85 | Jest preset moved to its own package (we have no Jest). Node versions before 20.19.4 dropped. `StyleSheet.absoluteFillObject` removed. |
| 0.86 | No breaking changes. Android 15+ edge-to-edge support. |
| 0.87 | Strict TypeScript API becomes the default. Toolchain requires Node 22, Android Gradle Plugin 9 and Kotlin 2.0+. |
| 0.88 | Web-based event dispatch by default. Metro 0.87. React 19.3. |

SDK 58 post adds these RN removals: `InteractionManager`, the `Touchable` root export, the `NativeMethods` types, the `Modal` `animated` prop, and the `StatusBar` props `backgroundColor`, `translucent` and `networkActivityIndicatorVisible`. Deep imports from `react-native/Libraries/*` become type errors. `ImageBackground` is deprecated.

### Expo SDK

**55**
- Removed: `expo-av`, the `newArchEnabled` app.json option, the `edgeToEdgeEnabled` and `notification` fields in app.json, `expo-clipboard` listener `content`.
- Deprecated: `removeSubscription` helpers (use `subscription.remove()`), the `expo-status-bar` colour props and `androidStatusBar` config (now no-ops).
- Node `^20.19.4 || ^22.13 || ^24.3 || ^25`, Xcode 26.
- Package versions now share the SDK major (`^55.0.0`).

**56**
- Hermes V1 default.
- TypeScript bumped to 6.0.3.
- `expo/fetch` installed as `globalThis.fetch`. Opt out with `EXPO_PUBLIC_USE_RN_FETCH=1`.
- `expo-file-system`: `copy()` and `move()` are async (`copySync()`, `moveSync()` for the old behaviour).
- `expo` no longer depends on `@expo/vector-icons`.
- iOS minimum 16.4, Xcode 26.4. Custom podspecs need deployment target 16.4.
- Known Hermes V1 memory regression, fixed in 57.

**57**
- `expo prebuild` clears and regenerates native folders by default.
- iOS 27 SDK needs the UIKit scene lifecycle. It is opt-in in 57 through `ios.enableSceneSupport`.
- Use `expo@57.0.17` or later (startup regression fixed).

**58**
- Node `^22.13 || ^24.3 || >=26`.
- Xcode 27 for Device Hub and App Intents.
- iOS scene lifecycle on by default, with a generated `SceneDelegate.swift`.
- Android R8 enabled by default in release builds. Libraries that use reflection may need keep rules.
- `expo-file-system`: `File.write()` is async (`writeSync()` for the old behaviour). `File.md5` deprecated for `File.digest()`.
- `expo-notifications`: foreground notifications show by default unless `setNotificationHandler` says otherwise.
- `expo-localization`: iOS no longer force-enables RTL from the device locale.
- `NODE_ENV` is set by the Expo CLI and overrides other values.
- Expo Router and `@expo/ui` changes do not apply to us.

## What this repo is affected by

Grep results from `src/`, `App.tsx` and `index.ts` on this branch:

| Item | Finding | Action |
|---|---|---|
| `StyleSheet.absoluteFillObject` | 22 files | Replace with `StyleSheet.absoluteFill` (spread) before RN 0.85 |
| `expo-file-system` | 8 files on the new API, 7 on `/legacy` | Check that `/legacy` still exists in SDK 58. Migrate off it if it was removed. Audit every `copy`, `move`, `write` call for the async change |
| `SafeAreaView` from `react-native` | 29 files | Deprecated since 0.81. Move to `react-native-safe-area-context` |
| `setNotificationHandler` | 3 files | Confirm the handler still decides foreground display under the new default |
| `StatusBar` | 1 file, no `backgroundColor`/`translucent` props found | Verify |
| `.remove()` subscriptions | 16 files | Fine (that is the target API). Grep for `removeSubscription` |
| `InteractionManager`, `Touchable`, `NativeMethods`, `ImageBackground`, `react-native/Libraries` | none | None |
| `Modal animated` prop | `Modal` used in 3+ files | Check for `animated=` |
| `newArchEnabled: true` in `app.config.js`, `edgeToEdgeEnabled` in app.config and `gradle.properties` | present | Remove the options SDK 55 removed (iOS config only, since `android/` is hand-maintained) |
| `expo.edgeToEdgeEnabled=true` in `gradle.properties` (marked deprecated) | present | Remove |
| TypeScript 5.9 | | `expo/tsconfig.base` will move to TS 6. Expect new strict errors. Strict RN API will break any deep type imports |
| CI Node 20 | `ci.yml`, `release-*.yml` | Raise to 22.13+ (SDK 58 and RN 0.87 need it) |
| iOS release job | `macos-latest` | Needs Xcode 27 on the runner for SDK 58, or pin to SDK 57 until the runner has it |

## Risky areas

1. **Hand-maintained `android/`.** No `prebuild` runs, so every template change has to be applied by hand. Diff against the upgrade helper for 0.81 → 0.88 and the Expo native project upgrade helper for 54 → 58. Expect changes to `build.gradle`, `gradle.properties`, `settings.gradle`, the Gradle wrapper (AGP 9 needs a newer Gradle than 8.14.3), `MainApplication.kt`, `MainActivity.kt` and `proguard-rules.pro`.
2. **R8 default in release builds.** Our custom Kotlin modules (FCM, UnifiedPush, client certificates, widgets, device sync) and `react-native-android-widget` use reflection and JS-facing annotations. Add keep rules and test a release APK end to end: push, widgets, device sync, mTLS.
3. **Patches.** `patches/react-native-android-widget+0.22.1.patch` and `patches/postal-mime+3.0.0.patch`. Check that widget library versions that support RN 0.88 exist, then rebase the patch. `postal-mime` is already pinned because 3.0.1 broke its patch.
4. **Headless JS tasks** in `index.ts`. Lazy `require()` of `App` must still work with Hermes V1 and the new event dispatch path.
5. **Hermes V1.** Check `src/test-setup.ts` mocks are unaffected (tests run in Node, not Hermes). Test memory and startup on a device.
6. **Third-party native libraries** have to support the New Architecture on RN 0.88: `@react-native-async-storage/async-storage` (2.2.0, latest 3.x), `@react-native-community/netinfo` (11 → 12), `@react-native-community/datetimepicker` (8 → 9), `react-native-webview` (13 → 14), `react-native-screens`, `react-native-svg`, `react-native-safe-area-context`, `react-native-sse`. Let `npx expo install --fix` pick Expo-blessed versions. For the ones it does not manage (async-storage 3, `react-native-android-widget`, `react-native-sse`) read each changelog.
7. **iOS.** Scene lifecycle migration and the iOS 27 SDK only matter for CI builds (`ios/` is generated). Check that the TestFlight workflow works with SDK 58's prebuild, which now cleans by default.
8. **TypeScript.** SDK 56 bumps TS to 6. If that blocks the upgrade, add `typescript` to `expo.install.exclude` temporarily.

## Steps

Upgrade in stages so a regression can be bisected to one SDK. Each stage ends with `npm run typecheck`, `npm test`, a debug build on a device, and a commit. Do the work on a branch.

### Stage 0: Prepare (on SDK 54)
1. Move CI to Node 22.13+. Confirm the build is green.
2. Replace `absoluteFillObject` with `absoluteFill`. Swap `SafeAreaView` for the `react-native-safe-area-context` one. Remove `newArchEnabled`, `edgeToEdgeEnabled` and `expo.edgeToEdgeEnabled` from `app.config.js` and `gradle.properties` where SDK 55 removes them. Make notification and subscription code SDK 55 safe.
3. Run `npx expo-doctor` and fix what it reports.
4. Read the `docs/device-sync.md` failure matrix and `docs/widgets-verification.md` so the post-upgrade checks cover them.

### Stage 1: SDK 55 (RN 0.83)
1. `npx expo install expo@^55.0.0 --fix`, then `npx expo-doctor`.
2. Check that no code imports `expo-av` (grep says none) and that `expo-file-system` and `expo-clipboard` usage compiles.
3. Apply the Android native diffs for 0.81 → 0.83 and the Expo 54 → 55 template changes by hand.
4. Re-check both patches (`patch-package` must apply cleanly) and regenerate `src/lib/licences.json` with `node scripts/generate-licences.mjs`.
5. Fix the `copy`/`move` assumptions in the file code, even though they land in 56.

### Stage 2: SDK 56 (RN 0.85)
1. `npx expo install expo@^56.0.0 --fix`. Opt out of TS 6 only if needed.
2. Test `expo/fetch` as global `fetch` against the JMAP client: timeouts, abort, `secureFetch` (mTLS), 429 retry, `react-native-sse`. If it misbehaves, set `EXPO_PUBLIC_USE_RN_FETCH=1`.
3. Hermes V1: run a release build and check memory and startup.
4. Update the `File.copy`/`move` callers to await or use the sync variants.
5. Apply Android native diffs for 0.84 and 0.85. Update custom podspecs if we have any (we do not).

### Stage 3: SDK 57 (RN 0.86)
1. `npx expo install expo@^57.0.0 --fix` and install at least `expo@57.0.17`.
2. Apply the 0.86 native diff.
3. Optionally enable `ios.enableSceneSupport` early.

### Stage 4: SDK 58 (RN 0.88)
1. `npx expo install expo@^58.0.0 --fix`, then `npx expo-doctor`.
2. Apply the 0.87 and 0.88 native diffs, including AGP 9, a newer Gradle wrapper and Kotlin 2.x.
3. Strict TypeScript API: fix type errors, including ref types.
4. `File.write()` is now async: await it or use `writeSync()`. Replace `File.md5` with `File.digest()`.
5. Audit `setNotificationHandler` and the foreground path so the new default does not show duplicate notifications.
6. Add R8 keep rules. Optionally opt out through `expo-build-properties` while debugging, then re-enable.
7. Raise the iOS release job to a runner with Xcode 27, or hold iOS back.

### Stage 5: Finish
1. Update `CLAUDE.md` (Expo SDK number, Node version) and `docs/android-release.md` / `docs/ios-release.md`.
2. Regenerate `src/lib/licences.json`.
3. Run the Android device matrix below on a release APK.
4. Do not bump `VERSION` by hand. Use `npm run bump` when releasing.

## Verification checklist (release APK, arm64)

- Sign in with password, OAuth and an mTLS client certificate. Switch accounts.
- Mail list, thread, compose, attachments (including PDF preview), offline outbox.
- Push via FCM and UnifiedPush, notification actions, taps and deep links (`mailto:`, `bulwarkmail:`).
- EventSource live updates and background resume.
- Calendar, contacts, files, Sieve and vacation screens.
- Device sync (contacts and calendar) as in `docs/device-sync.md`.
- Home-screen widgets as in `docs/widgets-verification.md`.
- Tablet and landscape split view, edge-to-edge insets, predictive back disabled.
- Startup time and memory against the 0.81 baseline.
- iOS TestFlight build installs and launches on iOS 26 and 27.

## Rollback

Each stage is its own commit on the upgrade branch. If a stage fails, stay on the last good SDK. SDK 57 is the safest place to stop, since 58 adds R8, scene lifecycle and strict types on top.
