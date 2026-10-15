# Native UI and UX audit, 2026-10

Scope: every screen, sheet, dialog, banner and gesture of the Android app, on a phone and a tablet, in
portrait and landscape. Started from `e19885d` (0.1.75).

## Method

- Devices (emulators):
  - phone `Bulwark_Pixel7_API35`, 411x914 dp;
  - tablet `Pixel_Tablet_API_34`, 1280x800 dp.

  The tablet's natural orientation is landscape, so `user_rotation 1` is tablet portrait.
- Cells used below:

  | Cell | Device and orientation |
  |---|---|
  | PP | phone portrait |
  | PL | phone landscape |
  | TL | tablet landscape |
  | TP | tablet portrait |

  "all" means all four.
- Build: release APK from `C:\rn`, with the portrait lock removed for the audit only.
- Data: Stalwart 0.16 on VM 106, seeded with:
  - 520+ inbox mails, a 16-message thread, HTML-only newsletters, a wide table, all attachment types
    and an inline cid image;
  - RTL mail (Arabic, Hebrew), a read-receipt request, very long subjects and names;
  - nested folders;
  - recurring, all-day, multi-day, overlapping, declined and cancelled events, and tasks;
  - 65 contacts with and without photos, plus two groups;
  - files and folders, and an active vacation reply.

  The phone ran as `usera@`, the tablet as a separate `uxaudit@` account with the same seed.
- Every area was captured in all four cells in light English (tablet) and dark English (phone).
  Then a second pass ran with German and font scale 1.3, on PP and TL, with the tablet in dark.
- Four read-only code passes (mail list, thread and compose, calendar, contacts/files/settings/login)
  gave the `file:line` references. Device findings were checked against them.
- Screenshots are in the session scratchpad (`shots/q_<screen>.png`, a 4-cell strip: PP, PL, TL, TP;
  `shots/d_<screen>.png` for the German/1.3 pass). They are not committed.

## Inventory

### Navigation

- Root native stack (`App.tsx`):
  - MainTabs
  - EmailThread
  - EmailSource
  - Compose (modal)
  - ContactDetail
  - ContactForm (modal)
  - GroupDetail
  - Scheduled
  - UnifiedInbox
  - AddAccount (modal)
- Bottom tabs: Mail, Calendar, Contacts, Files, Settings. A tab the server lacks is dimmed and does
  nothing.
- Above the tabs:
  - UpdateBanner
  - OfflineCacheBanner
  - PushOnboardingPrompt (floating card)
  - AppIconBadge (no UI)
- On the focused stack screen: ToastHost and UndoSnackbar (none on Compose).
- Entry points:
  - deep links: `bulwarkmobile://`, webmail permalinks, `mailto:`, and sign-in links
    (`bulwarkmail://pair`, `connect`);
  - Android share intents into Compose;
  - notification taps (mail push, calendar reminders);
  - widgets (inbox, agenda), which deep-link.

### Login (`LoginScreen` + `screens/login/*`)

- Steps: choose → email → (discovery) confirm or server → confirm → OAuth hand-off in the browser, or
  password (+ TOTP when the server asks) → signing in.
- Side paths:
  - QR scan modal (camera permission, blocked → open settings);
  - paste-link modal;
  - external sign-in link confirm alert;
  - refused-link notice;
  - Add account mode with a close button.

### Mail

- **Mail list** (`EmailListScreen`):
  - Header: menu, folder title, import, logo.
  - Search row: select-all, search with recent searches and people suggestions, sort toggle,
    filter.
  - Filter chips.
  - Banners: empty folder, offline, failed outbox, unreachable accounts.
  - States: loading, error + retry, no mailboxes, empty / no results.
  - Gestures: pull to refresh, endless scroll, long-press to select, swipe actions (instant or
    reveal).
  - Selection header: star, read, tag, move, spam, archive, delete.
  - Compose FAB.
  - Sheets: filter modal (with date pickers), MoveSheet, TagSheet, attachment preview.
- **Sidebar drawer** (`SidebarDrawer`):
  - Account switcher and account menu: add, set default, sign out, sign out of all.
  - Unified Inbox, Scheduled.
  - Unified Mailbox section, folders tree with unread counts and long-press folder sheet, shared
    accounts, tags.
  - Nested ActionSheet and NamePrompt.
- **Unified inbox** (`UnifiedInboxScreen`): its own header, search, selection, swipe, account dots,
  pull to refresh, load more.
- **Scheduled** (`ScheduledScreen`): list, per-item actions (send now, reschedule, edit, cancel),
  reschedule presets, custom date-time picker.

### Thread view (`EmailThreadScreen` + `components/email/*`)

- Layout:
  - Horizontal pager over the list.
  - Toolbar: back, delete, archive (≥400 dp), unread (≥340 dp), star, more.
  - Subject with star.
  - Single message, or conversation cards (collapsed rows, expanded cards with Reply / Reply all /
    Forward pills).
- Message header: sender and recipients open the address sheet; "Show details".
- Attachments: preview, open, save and share; "Download all".
- Banners: blocked images, truncated body, read receipt, unsubscribe, calendar invitation (RSVP,
  add to calendar).
- Quick reply box.
- Bottom bar: Prev, three configurable actions, Next.
- More sheet: archive, read, move, tag, spam, view mode, sender, forward as attachment, source,
  export.
- Email source screen.

### Compose (`ComposeScreen`)

- Header: close, title + draft status, attach, schedule, send.
- Fields:
  - From (IdentitySheet, From options);
  - To / Cc / Bcc with chips, autocomplete and a chip menu;
  - Subject.
- Attachments: sheet with photos, camera, files; chips with progress.
- Body: rich editor WebView or plain text.
- Format bar: templates, read receipt, plain/rich, B/I/U/S, colours, H1/H2, lists, quote, table,
  alignment, link, image, clear, undo/redo.
- Modals: link, colour palette, table, schedule sheet, date-time pickers, template placeholders,
  TemplateSheet.
- Flows:
  - draft autosave;
  - close guard (cancel / discard / save draft);
  - empty-subject and forgotten-attachment checks;
  - undo send through UndoSnackbar;
  - scheduled-send confirmation.

### Calendar (`CalendarScreen` + `components/calendar/*`)

- Views: month (free scroll or paged), week (free scroll or paged), 3 days, day, schedule (agenda).
- Header: menu, month title with month dropdown, prev/next (paged only), today, tasks.
- FAB: event, or a menu with Event / Task.
- Sheets and dialogs:
  - EventDetailSheet: RSVP, edit, duplicate, .ics, link, delete.
  - EventModal (editor): RecurrenceEditor, ParticipantInput, pickers.
  - RecurrenceScopeDialog.
  - CalendarSidebarDrawer: views, refresh, calendars with a long-press panel, new calendar,
    subscriptions, import.
  - TasksSheet, ICalImportSheet, ICalSubscriptionSheet, CalendarEditSheet, CalendarShareSheet.
- Gestures:
  - tap a slot for a draft, then tap the draft to create;
  - long-press a slot to create;
  - tap a month cell to open the day;
  - free scroll with snapping.
- There is no drag-to-move or drag-to-resize, so there is nothing to break mid-drag.

### Contacts

- `ContactsScreen`:
  - Header: drawer, count, search, import, add (long-press: contact or group).
  - Address book / group chips.
  - Long-press to select.
  - Selection header: select all, export, move, tag, delete.
  - Pull to refresh.
- `ContactsSidebarDrawer`: books, shared books, groups, tags with rename.
- `ContactDetailScreen`:
  - hero and quick actions (email, call, SMS, share);
  - sections: email, phone, address, work, personal, online, keys, categories, related, members,
    notes, address book;
  - recent mail and events;
  - More sheet (duplicate, add to group, move, export, delete).
- `ContactFormScreen`: person, organisation or group, with many collapsible sections and a date
  picker.
- `GroupDetailScreen`: members, add or remove.
- Sheets: AddressBookPicker, TagAssign, ContactPicker, ContactImport.

### Files (`FilesScreen`)

- Header: back, search, new folder, upload, grid/list.
- Breadcrumb, sort chip, upload progress.
- List or 3-column grid; long-press to select (download zip, delete).
- Per-item ⋮ sheet: preview, open with, download, share, move, duplicate, rename, delete.
- Folder picker, sort sheet, prompt modal, share sheet, preview modal.

### Settings (`SettingsScreen` + `components/settings/*`)

- One screen that swaps between a searchable section list and a page.
- Pages:
  - account, language, notifications
  - appearance, layout
  - reading, composing, identities, vacation, filters (rule modal, sieve editor), templates,
    folders, tags, downloads
  - security, encryption (disabled), content & senders
  - calendar and contacts (with device sync), files, sidebar apps
  - about & data, themes, plugins, updates
- Sign out.

### Other

- PushOnboardingPrompt, OfflineBanner, OfflineCacheBanner, UpdateBanner.
- Toasts: swipe to dismiss, action button.
- UndoSnackbar: undo, send now.
- Android widgets (out of scope for fixes): inbox and agenda.

## Findings

Severity: **P1** broken or blocking, **P2** clearly wrong or clumsy, **P3** polish. Each finding
lists the cells where it occurs, the screenshot, the code location and the intended fix. A tick
carries the commit that fixed it.

### Cross-cutting

- [x] **U-001 · P1 · PL TL TP · The app is locked to portrait and has no large-screen layout.** *(fixed in bfa02f1)*
  - Where: `app.config.js:34`, `AndroidManifest.xml:28`.
  - Android 16 ignores the lock on screens 600 dp and wider, so tablets and foldables rotate anyway.
  - Fix: remove the lock in both places. Keep `configChanges` (and add `smallestScreenSize` for
    split-screen and foldables). Then do phase 2.
- [x] **U-002 · P2 · iPad, landscape · No RN `<Modal>` sets `supportedOrientations`.** *(fixed in bfa02f1)*
  - Where: 56 modals in 40 files.
  - iOS presents these portrait-only and forces a rotation.
  - Fix: pass all orientations everywhere.
- [ ] **U-003 · P2 · TL TP · Every screen is the phone layout stretched to 1280 dp.** *(partly fixed in 802474d, 64a62b6, 8ab82cd, 2470e99, 0087e4c; login still open)*
  - Affected: mail rows, thread body, compose, contacts, files, settings, login.
  - Screenshots: `q_mail_list`, `q_thread_receipt`, `q_contacts`, `q_settings`, `t_login_confirm`.
  - Fix: the adaptive layout plan below.
- [x] **U-004 · P2 · TL TP · Sheets and floating cards span the full width.** *(fixed in f4ff07d)*
  - Affected: bottom sheets, toasts, the undo bar and the push prompt.
  - Screenshots: `q_event_detail`, `q_mail_list` (push prompt).
  - Fix: on medium and expanded widths, cap them at about 560 dp and centre them.
- [ ] **U-005 · P2 · PL · Left and right safe-area insets are ignored.** *(partly fixed in bfa02f1 (compose), f4ff07d (sheets))*
  - Most screens use `SafeAreaView edges={['top']}` and position sheets `left: 0, right: 0`.
  - A side navigation bar or a camera cutout covers the content.
  - Fix: add the side edges to screen roots, and inset sheets and the FABs.
- [ ] **U-006 · P2 · all · The Files header pads a fixed 60 px instead of the status-bar inset.**
  - Where: `FilesScreen.tsx:1438`.
  - It is too tall in landscape and wrong on any other status bar height.
- [ ] **U-007 · P2 · all · Uppercase section labels get clipped on Android.**
  - Example: "WORK" shows as "WOR", "ADDRESS BOOK" as "ADDRESS" (contact detail, English).
  - Cause: `textTransform: 'uppercase'` with `letterSpacing` is measured before the transform.
    13 places.
  - Where: `ContactDetailScreen.tsx:976`.
  - Fix: upper-case the string with `toLocaleUpperCase` instead.
- [ ] **U-008 · P2 · all · After a cold start in German, the tab labels and the folder title stay
  English.** The search placeholder is German. Screenshot `t_layo`.
  - Fix: re-render the tab labels and the title when the locale store hydrates.
- [ ] **U-009 · P2 · TL TP (font 1.3) · Tab labels truncate with plenty of room.**
  - Example: "E-…", "Kalen…", "Einstellu…" in 256 dp-wide tabs (`q_de_mail`).
  - The label sits beside the icon with a fixed font size and no width.
  - Fix: let the label size itself; on wide screens use the side rail (phase 2).
- [ ] **U-010 · P2 · all (font 1.3) · The mail search field clips the top of its text.**
  - Where: fixed height in `EmailListScreen.tsx:1885-1912`.
  - Fix: use `minHeight` and vertical padding.
- [ ] **U-011 · P2 · dark · The dark palette doesn't match the webmail's standard theme.**
  - The app uses a blue primary and zinc greys. The webmail uses a white `#fafafa` primary with
    `#171717` text, a `#0a0a0a` ground, neutral greys, `#1c1c1c` popover and a `#262626` muted
    surface.
  - Where: `src/theme/tokens.ts` `DARK_COLORS`. APP.md lists this as open.
  - Fix: port the webmail dark tokens.
- [ ] **U-012 · P2 · light · The mail header logo is invisible on the light theme.**
  - It always loads `Bulwark Logo White.png` (`EmailListScreen.tsx:1105`). Screenshot `q_mail_list`
    TL.
  - Fix: pick the logo by the resolved theme.
- [ ] **U-013 · P2 · light · TagSheet reads the static dark palette.**
  - Where: `TagSheet.tsx:7,101,124`. Tag colours are wrong on light.
  - Fix: use `c.tags`.
- [ ] **U-014 · P2 · all · `Button` has no `accessibilityRole` and no disabled or busy state.**
  - Where: `Button.tsx:35`. This affects every dialog and prompt button.
- [ ] **U-015 · P2 · all · Many icon buttons are under 48 dp.**
  - Mail search clear 36, recent-search remove 28, filter chip remove 32, attachment chips about 22,
    drawer chevron 32.
  - Viewer: card pills about 36, collapse handle 18, quick-reply Send 28, subject star 34.
  - Compose: recipient chip X 28, Send 36, Cc/Bcc toggles 28.
  - Files: header 44, row ⋮ 26.
  - Settings: account icon buttons 28, toggle 24 tall.
  - Login: header 32, show-password 20.
  - Sheet close buttons are 28 everywhere.
  - Lists with `file:line` are in the code passes; the fix commits name the places.
  - Fix: a shared 48 dp target (box plus `hitSlop`), applied screen by screen.
- [ ] **U-016 · P3 · all · Sheet and dialog scrims are a literal `rgba(0,0,0,0.5)` in about 20
  files.** Fix: an `overlay` token.
- [ ] **U-017 · P3 · all · Some confirmations use the system alert, others the app's `Dialog`.**
  Examples: compose discard, event delete, folder empty. This is a style mismatch.
- [ ] **U-018 · P3 · all · Changing the system font size while the app is open recreates the activity
  and resets navigation to the mail list.** Text measured before the change can stay clipped until
  the next restart ("Layo" for "Layout").

### Mail list, drawer, unified inbox, scheduled

- [ ] **U-020 · P2 · all · Back with an active search exits the app instead of clearing the
  search.**
  - Repro: search "Offsite", press Enter, then Back.
  - Where: `EmailListScreen.tsx` has no back handler for search or selection.
  - Fix: `useBackWhileFocused` that clears the selection, then the search.
- [ ] **U-021 · P2 · PL · Phone landscape shows about 1.5 rows.**
  - The 56 dp header, the 56 dp search row and the 64 dp tab bar take most of the 411 dp.
  - The compose FAB covers the second row. Screenshot `q_mail_list` PL.
  - Fix: in compact height, merge the title and search into one row and drop the tab labels.
- [ ] **U-022 · P2 · PL (font 1.3) · Rows cut the sender to three letters and clip the time.**
  - Example: "Us…", "17:4" (`q_de_mail` PL).
  - Where: the row header in `EmailListScreen.tsx` around 158-250.
  - Fix: let the time keep its width (`flexShrink: 0`) and let the name shrink.
- [ ] **U-023 · P2 · PP · The undo bar sits on top of the compose FAB for 5 s after every archive or
  delete.**
  - Where: `UndoSnackbar.tsx:161`, `EmailListScreen.tsx:2262`.
  - Fix: lift the FAB while the bar shows.
- [ ] **U-024 · P2 · all · Swipe and bulk actions on the list fail silently.**
  - Archive, spam, read, star, move and delete are called as `void ...` with no catch, so a server
    rejection becomes an unhandled promise. The selection also stays.
  - Where: `EmailListScreen.tsx:604-651, 715-799`; `handleImport` `:492`.
  - Fix: report failures through `toast.error` as the viewer does.
- [ ] **U-025 · P2 · all · Sign out and "Sign out of all accounts" run with no confirmation.**
  - Where: drawer `SidebarDrawer.tsx:930,943`, settings `SettingsScreen.tsx:497`.
  - Fix: a destructive `Dialog`.
- [ ] **U-026 · P2 · all · The drawer's folder-settings icon only closes the drawer.**
  - Where: `SidebarDrawer.tsx:1048`, `navigate('MainTabs')`.
  - Fix: open Settings → Folders.
- [ ] **U-027 · P2 · all · The filter modal runs a query per keystroke and has no keyboard
  handling.**
  - Where: `EmailListScreen.tsx:1507-1550`.
  - Fix: debounce like the main search; add next/search return keys.
- [ ] **U-028 · P2 · PP PL · The unified inbox and Scheduled lists end under the gesture bar.**
  - Where: `UnifiedInboxScreen.tsx:384`, `ScheduledScreen.tsx:278` (top edge only, fixed padding).
- [ ] **U-029 · P2 · all · Unified inbox rows ignore the font-size, density and preview settings.**
  - Where: `UnifiedInboxScreen.tsx:576`.
  - Its load and open failures are silent (`:103-112`, `:179-206`).
- [ ] **U-030 · P3 · all · The menu button keeps a grey focus box after the drawer closes.**
  Screenshot `q_search_results`.
- [ ] **U-031 · P3 · PP · The selection header holds up to 7 buttons; its count has no
  `numberOfLines`.** Where: `EmailListScreen.tsx:982-1066`.
- [ ] **U-032 · P3 · all · Folders under a hidden empty parent show flattened at the top level.**
  - Example: "Q4 contracts" without Clients / ACME / 2026 (`q_drawer` PP).
  - This happens with "hide empty folders" on. To check before changing anything.

- [x] **U-033 · P2 · TL TP · With the tabs in the side rail, the compose FAB and list ends sit under
  the tablet taskbar.** *(fixed in b9e6ba4)* Found after the mail split view landed (802474d): a bottom tab bar used to
  keep the screens clear of the bottom inset, a side rail doesn't.
  - Fix: pad the tab area by the bottom inset when the rail is shown.
### Thread view

- [x] **U-040 · P1 · PL TL TP · After a rotation the pager is misaligned.** *(fixed in bfa02f1)*
  - Half of the neighbouring page shows and the open message is cut off at the right edge.
  - It happens when rotating on the thread, and when rotating on Compose opened from it
    (`q_thread_long` PL, `q_compose_close` TL).
  - Where: `EmailThreadScreen.tsx:265-280`; the pager keeps its old pixel offset.
  - Fix: re-scroll to the active index after a width change, without animation.
- [ ] **U-041 · P2 · all · A long thread opens at the oldest message.**
  - The newest (opened) message is expanded but off screen on a phone (`q_thread_long` PP).
  - Fix: scroll the opened message into view once the cards are laid out.
- [ ] **U-042 · P1 · all · Quick reply "More options" throws away the typed text.**
  - Where: `EmailThreadScreen.tsx:1185`.
  - Fix: pass the text as `prefillBody` to the reply composer.
- [ ] **U-043 · P2 · PL · Phone landscape leaves almost no room for the body.**
  - Toolbar with labels, subject, sender block, attachments, banner and the labelled bottom bar
    fill the 411 dp (`q_thread_receipt` PL).
  - Fix: icon-only toolbar and bottom bar in compact height.
- [ ] **U-044 · P2 · PP (German, 1.3) · The toolbar overflows and pushes More off screen.**
  - "Stern hinzufügen" is long (`d_de_thread`).
  - Fix: drop the toolbar labels when they don't fit; keep the a11y labels.
- [ ] **U-045 · P3 · German · Prev/Next read "Zurück"/"Weiter".**
  - "Zurück" reads as Back. "Allen antworten" wraps in the bottom bar.
  - Fix: "Vorherige"/"Nächste" (locale), and a single line with shrinking text.
- [ ] **U-046 · P2 · all · The tag sheet doesn't scroll.**
  - With many tags, or in landscape, rows can't be reached.
  - Where: `EmailThreadScreen.tsx:1472-1486`.
- [ ] **U-047 · P2 · TL TP · Plain-text and fluid HTML bodies run 150+ characters per line.**
  - Fix: a readable max width for the body on wide panes.
- [ ] **U-048 · P3 · all · The toolbar star always says "Star", even when the message is starred.**
  - Where: `EmailThreadScreen.tsx:746`.
- [x] **U-049 · P3 · PL TL · Attachment image preview is sized from the window width, so it is
  taller than the screen in landscape.** *(fixed in 2470e99)* Where: `AttachmentPreviewModal.tsx:112`.

### Compose

- [x] **U-060 · P1 · PL · With the keyboard open in landscape, the whole compose body is blank.** *(fixed in bfa02f1)*
  - Only the header stays, so you can't see what you type (`tri.png`).
  - Where: the keyboard padding is computed from `Dimensions.get('screen').height`
    (`ComposeScreen.tsx:400-425`), which doesn't follow the rotation.
  - Fix: compute the overlap from the window, against the keyboard frame.
- [ ] **U-061 · P2 · all · An untouched reply autosaves a draft and asks "Save or discard?" on
  close.**
  - The signature insertion counts as an edit (`d_de_compose`). Opening and closing a reply should
    leave nothing behind.
  - Where: `ComposeScreen.tsx:1116-1184`, `:1331-1444`.
- [ ] **U-062 · P2 · all · Recipient and subject fields have no return-key flow.**
  - Fix: To/Cc/Bcc use `next`; an empty submit moves on; Subject `next` focuses the body.
  - Where: `ComposeScreen.tsx:2228-2395`.
- [ ] **U-063 · P2 · all (German, 1.3) · Field labels wrap.** "Betreff" shows as "Betref/f": the
  label column is a fixed width.
- [ ] **U-064 · P3 · PP · The subject field shows the end of a long subject.**
  - Example: "…ning 2027: venue…". The cursor was put at the end on mount.
- [ ] **U-065 · P2 · all · Format-bar buttons have no accessibility labels.**
  - Where: `ComposeScreen.tsx:2441-2513`; the toolbar button also has no role or state.
- [x] **U-066 · P2 · PL · Text inputs use Android's full-screen landscape keyboard.** *(fixed in bfa02f1)*
  - The autocomplete and the composer are hidden behind it.
  - Fix: `disableFullscreenUI` on recipients, subject, plain body and quick reply.
- [x] **U-067 · P2 · TL TP · Compose fills the tablet screen.** *(fixed in 0087e4c)* Fix: a centred panel (phase 2).

- [ ] **U-068 · P2 · all · The signature shows two "--" lines.** The seeded text signature starts
  with the usual "-- " delimiter and the composer adds its own separator above it (screenshot
  `t_compose_panel`).
  - Fix: don't add a separator to a signature that already starts with one.
- [ ] **U-069 · P2 · PL · Recipient suggestions can't show in phone landscape.** With the keyboard
  up, about 50 dp are left under the To field, so the suggestion list is hidden behind the
  keyboard. Typing a full address still works.
### Calendar

- [x] **U-080 · P1 · PL · Month view shows two week rows and cuts off the rest.** *(fixed in bfa02f1)*
  - Rows keep a 72 dp minimum and the list is sized to six of them (`q_calendar_default` PL).
  - Where: `MonthScrollView.tsx:127-128,250`, `MonthView.tsx:427-438`.
  - Fix: size the list to the real height and let rows shrink.
- [x] **U-081 · P1 · TL TP · Rotating on month or week jumps back a month, and week view goes
  blank.** *(fixed in bfa02f1)*
  - After a rotation, month view showed September instead of October. Week view showed no day
    headers and no events until Today was tapped (`q_calendar_default` TP, `q_cal_week` TL).
  - Where: `MonthScrollView` samples the visible month at a fixed 40% of a stale height;
    `TimeGridScrollView` keeps the old `scrollX` after its list remounts.
  - Fix: keep the focused date across the remount and reset the header offset.
- [x] **U-082 · P1 · PL · The event sheet's action row (Edit, Duplicate, .ics, Delete) is below the
  screen.** *(fixed in bfa02f1)*
  - Screenshot `p_event_land`.
  - Where: `EventDetailSheet.tsx:609,643` (body `maxHeight: 400`, no `flexShrink`).
- [ ] **U-083 · P1 · all · Saving an event fails silently.**
  - `handleSave` has `try/finally` without catch: the spinner stops, the editor stays, nothing is
    said.
  - Where: `EventModal.tsx:301-368`.
- [ ] **U-084 · P2 · all · Several deletes have no confirmation or undo.**
  - Deleting a single event (`CalendarScreen.tsx:632`, `EventModal.tsx:371`).
  - Deleting a task (`TasksSheet.tsx:427`).
  - Unsubscribing from a feed, which also deletes its calendar (`ICalSubscriptionSheet.tsx:278`).
- [ ] **U-085 · P2 · all · Cancelling the recurrence-scope dialog after editing a recurring event
  throws the edits away.** Where: `CalendarScreen.tsx:786-790`.
- [x] **U-086 · P2 · TL TP · Wide screens get wider columns, not more days.** *(fixed in 2288d28)* 3 days stays 3 and
  day stays 1. Fix: phase 2.
- [x] **U-087 · P2 · PL · The month dropdown is a fixed 346 dp tall and sized from the window.** *(fixed in bfa02f1)*
  - It overflows in landscape and lands on a half page after rotation.
  - Where: `MonthDropdown.tsx:23,52,72`.
- [ ] **U-088 · P3 · all · Times and dates use English formats in other languages.**
  - Hour labels hard-code AM/PM (`TimeGridScrollView.tsx:437,640`, `WeekView.tsx:234,318`).
  - Dates use US-order patterns (`EventDetailSheet.tsx:96-108`, `EventModal.tsx:525,545`,
    `TasksSheet.tsx:212`).
- [ ] **U-089 · P3 · all · ICalSubscriptionSheet and RecurrenceEditor are English only.** From
  `docs/parity/05-calendar.md`.
- [ ] **U-090 · P3 · PP (font 1.3) · Month chips show only the start time, no title.**
- [ ] **U-091 · P3 · all · An event that starts above the visible hours shows as an untitled
  block.**

### Contacts

- [x] **U-100 · P1 · all · Deleting a contact or group crashes the detail screen.** *(fixed in 295e292)*
  - Hooks run after an early return: `ContactDetailScreen.tsx:149` before `:216`, and
    `GroupDetailScreen.tsx:58` before `:130`.
  - The delete empties the store, the screen re-renders with fewer hooks, and React throws. A
    contact removed by a sync does the same.
- [ ] **U-101 · P2 · PL · The address-book chip row is clipped at the bottom.** Screenshot
  `q_contacts` PL.
- [ ] **U-102 · P2 · all · Back doesn't leave selection or search; it leaves the tab.**
  - Where: `ContactsScreen.tsx`. Files and Settings already handle this.
- [ ] **U-103 · P2 · all · The contact form's discard check only covers the on-screen back.**
  - Hardware back drops edits silently.
  - Where: `ContactFormScreen.tsx:764`. Fix: `usePreventRemove`.
- [ ] **U-104 · P2 · all · Contact form fields have no next or submit chaining.** Where:
  `ContactFormScreen.tsx:1197-1283`.
- [x] **U-105 · P2 · TL TP · List and detail are separate full-screen pages.** *(fixed in 64a62b6)* Fix: phase 2.

### Files

- [x] **U-110 · P2 · all · The grid has a fixed 3 columns.** *(fixed in 2470e99)*
  - The last row stretches its cells, so the columns don't line up. Tablet cells are huge
    (`q_files_grid`).
  - Where: `FilesScreen.tsx:989,1606`.
- [ ] **U-111 · P2 · all · Dates and times ignore the app's language and the 12/24 h setting.**
  - Example: "10:47 PM" next to 24 h times everywhere else.
  - Where: `FilesScreen.tsx:127-132`.
- [ ] **U-112 · P2 · all · Removing someone's share access has no confirmation.** Where:
  `ShareSheet.tsx:213`.
- [x] **U-113 · P2 · TL TP · There is no side-by-side preview.** *(fixed in 2470e99)* Fix: phase 2.

### Settings

- [ ] **U-120 · P2 · all · Deleting a tag has no confirmation, while the reset next to it does.**
  Where: `KeywordSettings.tsx:48,122`.
- [ ] **U-121 · P2 · PP · The vacation subject input is a fixed 240 dp.**
  - It squeezes its label into five lines.
  - Where: `VacationSettings.tsx:434`; the same pattern in `AccountSecuritySettings.tsx:234`.
- [ ] **U-122 · P2 · light · The amber banner in filters and the sieve editor is unreadable on
  light.**
  - Light yellow text on a faint brown fill.
  - Where: `FilterSettings.tsx:515-519`, `SieveEditorSheet.tsx:208-212`.
- [x] **U-123 · P2 · TL TP · The section list and the page replace each other.** *(fixed in 8ab82cd)* Fix: phase 2.
- [ ] **U-124 · P3 · all · The language list is in neither name nor code order.** Example: Česky,
  Slovenčina, Dansk.

### Login

- [ ] **U-130 · P2 · TL TP · Login steps stretch to the full width.**
  - Fields and buttons are 1248 dp wide (`t_login_confirm`).
  - Fix: a centred column of about 480 dp.
- [ ] **U-131 · P2 · all · Small targets: show-password 20 dp, header back 32 dp, email suggestion
  chips about 26 dp.**
- [ ] **U-132 · P2 · all · The password step's return keys don't move on.**
  - Username has no `next`. With TOTP on, the password field shows Next and does nothing.
  - Where: `PasswordStep.tsx:56,78`.
- [ ] **U-133 · P2 · all · There is no way out while "Signing in" hangs.** Hardware back is
  swallowed. Where: `SigningInStep.tsx`, `LoginScreen.tsx:165`.

## Adaptive layout plan

**Breakpoints** come from the window width (`useWindowDimensions`), not the device type, so
split-screen, freeform windows and foldables work too:

| Class | Width | Typical |
|---|---|---|
| compact | < 600 dp | phones in portrait, narrow split-screen |
| medium | 600–839 dp | tablet portrait, unfolded foldables |
| expanded | ≥ 840 dp | tablet landscape |

A second flag, `shortHeight` (window height < 480 dp), covers phone landscape (914x411 dp). By
width alone that would be "expanded", but two panes and a rail in 411 dp of height are worse than
one pane. So a short window keeps the compact layouts and only compresses chrome: icon-only bars,
a merged header row, no tab labels.

A small hook, `src/lib/use-layout.ts`, returns `{ widthClass, shortHeight, isSplit }` and a pure
`layoutFor(width, height)` that can be tested.

**Navigation.** The phone stack stays as it is. A split view is a layout inside a tab, not a second
navigator:

- Medium and expanded put the tab bar on the left as a rail (`tabBarPosition: 'left'`, material
  variant), like the webmail's navigation rail.
- Stack routes still exist and are still used on compact widths. On medium and expanded, the list
  screens render the detail in a right-hand pane instead of pushing, and the detail screens' bodies
  are shared components that take props instead of route params.
- If the window narrows while a pane shows something, the pane's selection is pushed as the normal
  stack route, so nothing is lost.

**Per area:**

| Area | compact | medium | expanded |
|---|---|---|---|
| Mail | list → push thread | list (360 dp) + thread pane | persistent folder sidebar (280 dp) + list + thread |
| Calendar | as today | wider grid, 3-day shows 5 days | week shows 7 wide columns, 3-day shows 7, day shows 2 |
| Contacts | list → push detail | list + detail pane | list + detail pane |
| Files | list / grid | grid columns from width (about 140 dp each) | grid columns from width + preview pane when a file is selected |
| Settings | list ↔ page | section list (320 dp) + page | section list + page |
| Compose | full screen | centred panel, max 720 dp, dimmed backdrop | same |
| Sheets, dialogs, toasts | full width at the bottom | max 560 dp, centred | max 560 dp, centred |
| Login | as today | centred column, max 480 dp | same |

The thread, contact detail and settings pages cap their reading width (about 760 dp for the
mail body, 640 dp for forms) inside wide panes.

**State across rotation.** The activity keeps its state through `configChanges` (orientation,
screen size, smallest screen size, layout). Panes keep their selection in component state or the
store. Lists that depend on width remount with their focused index or date carried over.
