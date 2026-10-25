# Developing Checkmate

**Current version: 2.2.0** (Android versionCode 22). Last updated 25 October 2026.

Checkmate (formerly Tickwise) is a personal to-do app in the spirit of Todoist, with a calendar in the spirit of Google Calendar. It was created by **Tymon Ng**, built with Claude AI and proudly made in Australia. One web app is shipped three ways, and all three sync through the user's own Firebase project:

| Output | Platform | What it is |
| --- | --- | --- |
| `dist/Checkmate.html` | Any browser | The whole app in one offline HTML file |
| `dist/Checkmate.exe` | Windows 10/11 x64 | A Go program that shows the HTML in WebView2 |
| `dist/Checkmate.apk` | Android 7+ | A Java WebView wrapper with native reminders |

`README.md` is the short introduction and [`docs/GUIDE.md`](GUIDE.md) is the full user guide: install, sync setup, the Claude connector setup and every feature. This file is for whoever develops the app next.

---

## 1. Getting started

1. Clone the repository, set up the tools in section 6 and run `./build.sh` and the tests before changing anything.
2. **The Android release key is not in the repository.** Only the maintainer has it. Without it `build.sh` signs with a throwaway development key, which is fine for testing but can't update the published app (section 7).
3. Finished apps are published on the GitHub **Releases** page, never committed to the repository.

---

## 2. Folder map

```
checkmate/
  README.md            short introduction, downloads and screenshots
  docs/GUIDE.md        the full user guide (keep it in step with features)
  docs/DEVELOPING.md   this file
  docs/images/         screenshots used by the README
  build.sh             builds dist/Checkmate.html, .exe and .apk
  web/                 the app: Preact + Firebase, bundled by esbuild into ONE html file
    build.mjs          bundles; MOCK_FIREBASE=1 builds web/dist-test (fake Firestore, used by test/sync.cjs)
    src/               all the app code (see section 3)
  connector/           the Claude connector: a remote MCP server for Cloudflare Workers
    src/worker.js      routing, OAuth 2.1 (DCR + CIMD + PKCE), MCP JSON-RPC at /mcp, CONFIG markers
    src/tools.js       the 16 MCP tools (get-overview, find/add/update/complete/reopen/delete-tasks,
                       get-task, add-comments, find/add-projects, add-sections, find/add/update/delete-events)
    src/firebase.js    Firebase Auth + Firestore REST client (UserDb), with updateTime preconditions
    src/seal.js        AES-GCM token sealing with CONFIG.secret, PKCE, HMAC
    src/pages.js       the sign-in and consent pages (English and Chinese)
    shims/             stand-ins for the app's store, i18n, sound and UI when its code runs in the Worker
    build.mjs          bundles to connector/dist/checkmate-connector.js; the web build embeds it
                       as `virtual:checkmate-connector` so Settings → Claude can hand it out
  desktop/             the Windows host (Go 1.24, github.com/jchv/go-webview2)
    main.go            window, single instance, tray notifications, JS bindings
    server.go          serves the app on 127.0.0.1:47821 (falls back to 47822–47825). The port is fixed
                       so the WebView's localStorage keeps the same origin
    fetch.go           twFetch: reads Google Calendar/Docs/Sheets links for the app (allowlisted hosts)
    appicon_windows.go switches the icon on shortcuts and on the exe itself to match the style
    winres/winres.json exe resources: version info and icon groups #1–#7 (#1 is the file icon)
  android/
    src/app/tickwise/  AppActivity, Bridge (JS interface "TickwiseNative"), Reminders + ReminderReceiver
                       (AlarmManager), LauncherIcons (activity-alias per style), GoogleFetch, Strings
    stubs/             compile-only Android API stand-ins (javac against these, never packaged)
    apk/               the apktool project: AndroidManifest.xml, res/, apktool.yml (version lives here)
    signing/           where the release key goes on the maintainer's machine (git-ignored, see section 7)
  brand/               export-svgs.mjs + make_icons.py: per-style icons for Windows and Android
  test/                all tests + run-all.sh (see section 8)
  third_party/sys      golang.org/x/sys v0.33.0 (desktop/go.mod has a `replace` pointing here)
```

---

## 3. The web app (`web/src`)

**Stack.** Preact (hooks), plain CSS and the Firebase JS SDK. Everything is bundled into one HTML file, including the fonts (@fontsource), the per-style cursors and icons, and the connector code. Routing uses the hash (`#/today`, `#/inbox`, `#/upcoming`, `#/calendar`, `#/project/<id>`, `#/label/<id>`, `#/filter/<id>`, `#/search`, `#/completed`, `#/productivity`, `#/filters` for Filters & labels).

**Shell and UI**

| File | What it holds |
| --- | --- |
| `main.jsx` | Boot and host hooks. It also has a capture-phase scroll guard: only the app's own panes may scroll, so `.app`, html and body are reset if anything scrolls them |
| `app.jsx` | App shell, sidebar, routing, global keys, quick add (Q) and the Settings modal. It applies `data-theme` (light/dark) and `data-skin` on `<html>` |
| `ui.jsx` | Modal, Menu, Popover, Field, Switch, toast with Undo, `useStoreVersion()` and Escape/back layering |
| `bus.js` | `ui.*` actions that open UI from anywhere (`ui.openSettings('calendar:subscribe')`, `ui.openTask`) |
| `icons.jsx` | The stroke icon set and the per-style logo |
| `brand-icons.js` | The six app icons |
| `cursors.js` | Cursors for the game styles |

**Task pages and editing**

| File | What it holds |
| --- | --- |
| `views.jsx` | Today, Upcoming, Project (list and board), Label, Filter, Filters & labels, Search, Completed and Productivity |
| `tasks.jsx` | TaskRow, the list, and pointer-based drag and drop (mouse and touch) |
| `detail.jsx` | The task detail modal (subtasks, comments) |
| `editor.jsx` | TaskEditor (the quick add and inline add box) and the due/priority/label/project pickers |
| `parse.js` | The natural-language quick-add parser, English and Chinese: dates, times, repeats, p1–p4, #project, /section, @label. `parseQuickAdd`, `parseDateText`, `parseEventText` |
| `examples.js` | The task name hint. It has a dated example on 9 days of the year and picks a random one on any other day |
| `filters.js` | The filter query language, e.g. `(today \| overdue) & #Work & !@waiting` |

**Calendar**

| File | What it holds |
| --- | --- |
| `calendar.jsx` | Day, 3/4-day, week, month, year and schedule views, plus the mini month |
| `event-ui.jsx` | Event cards, quick create, the full editor, and "this / following / all" |
| `events.js` | The event model and occurrence expansion |
| `recur.js` | Repeats (RRULE) |
| `tz.js` | Time zones. Events store wall-clock time plus a zone |
| `ics.js` | .ics import and export |
| `calsync.js` | Subscribed calendars and holidays |
| `calnav.js` | Where the calendar is looking (date and view) |

**Reminders, birthdays and files (2.2.0)**

| File | What it holds |
| --- | --- |
| `reminders.js` | Task reminder maths and the synced defaults (item `reminder-defaults`) |
| `reminders-ui.jsx` | The task panel's Reminders popover and Settings → Reminders |
| `birthdays.js` | Birthday items, next dates, ages, lunar dates (a built-in table for 1900–2100), calendar occurrences and reminders |
| `birthdays-ui.jsx` | The Birthdays page, the add/edit dialog and the calendar card |
| `files.js` | Task files: IndexedDB on the device, upload/download in pieces through Firestore, queues and clean-up |
| `files-ui.jsx` | The Files section of the task panel and the preview |
| `changelog.js` | Settings → What’s new. **Add an entry for every release** |

`event-ui.jsx`'s `ReminderField` (with **Custom…**) is shared by events, tasks, birthdays and the defaults. A reminder is a number of minutes: before the time for timed items, or before the start of the day for date-only items (so -540 = on the day at 9:00, 900 = the day before at 9:00).

**Data, sync and integrations**

| File | What it holds |
| --- | --- |
| `store.js` | The local-first store (section 4) |
| `actions.js` | Task, project, section, label and filter operations |
| `seeds.js` | Welcome task text |
| `sync.js` | Firebase sync |
| `docsync.js` | Google Docs/Sheets → project sync |
| `claude.js` | The connector record, the connector code and the Check button |

**Settings**

`settings.jsx` holds `TABS`, which appear in this order:

| Tab | Holds |
| --- | --- |
| general | Language, start page, week start, time format, date order, sounds |
| theme | Style, app icon follows style, light/dark, theme colour |
| sidebar | Which pages show in the sidebar, and task counts |
| reminders | Default reminders for timed tasks, date-only tasks and birthdays |
| sync | Firebase setup and account |
| calendar | Calendar settings, subscriptions, holidays, .ics import |
| data | Backup and restore |
| docs | Docs & Sheets |
| claude | The Claude connector |
| keys | Shortcuts |
| whatsnew | Every version's changes, from `changelog.js` |
| about | Version and credits |
| donate | Donation details |

Each tab button has `data-tab=<key>`. `ui.openSettings('tab:focus')` deep-links into a tab. Panel code lives in these files:

- `settings-more.jsx`: Sidebar, What’s new, About and Donate. Donation details are in the `DONATION` constant.
- `cal-settings.jsx`, `docs-settings.jsx` and `claude-settings.jsx`: one tab each.
- `nav-items.jsx`: the sidebar's page list.
- `theme.js`: accent colours, with presets and custom colours adjusted for light and dark.
- `version.js`: `VERSION`, shown in About.

**Styles ("skins")**

Each style has its id, its own CSS, sounds, icon and cursor, and sometimes its own components:

| id | Name | Files |
| --- | --- | --- |
| tickwise | Checkmate (default) | `styles.css` |
| archive | NieR: Automata | `skin-archive.css` |
| riot | Persona 5 | `skin-riot.css`, `riot.jsx` (StyledTitle cut-out letters, wipe) |
| tide | Persona 3 Reload | `skin-tide.css`, `tide.jsx` (moon date, stat bars, shatter) |
| frontier | Red Dead Redemption 2 | `skin-frontier.css`, `frontier.jsx` (almanac, tally) |
| neon | Cyberpunk 2077 | `skin-neon.css`, `neon.jsx` (date readout) |

`cal.css` styles the calendar. `sound.js` synthesises every sound with WebAudio, with a set per style. **Every UI change has to look right in all six styles, in light and dark, and at phone width (390px).**

**Language.** `i18n.js` provides `tr('English text', {vars})` and `pick(en, zh)`. `zh-Hant.js` maps English strings to Traditional Chinese (Hong Kong flavour). **Every new user-facing string needs a zh-Hant entry.** `test/chinese.cjs` catches leftovers.

**Host bridge.** `native.js` provides `platform()` (`'web'` / `'windows'` / `'android'`) and wraps:

- On Android, `window.TickwiseNative`.
- On Windows, the bindings `twOpenExternal`, `twSetIcon(style, follow)`, `twNotify` and `twFetch`.

It also provides `canSwitchAppIcon()`, `hasNativeFetch()`, reminders and file saving.

---

## 4. Data model and sync

- **Items.**
  - Every record is an item `{id, type, updatedAt, …}`, stored in localStorage under `tickwise.db.v1`, with a dirty set in `tickwise.dirty.v1`.
  - Deleting keeps a tombstone (`deleted: true`).
  - Types are `task`, `project`, `section`, `label`, `filter`, `comment`, `event`, `calendar`, `docsource`, `connector`, `birthday` and `settings` (one item, id `reminder-defaults`: `{timed, dateOnly, birthday}` minute lists).
  - A task is `{title, desc, projectId ('inbox' by default), sectionId, parentId, priority 1–4 (4 = none), labels[], due {date, time, recur}, done, order, reminders (null = defaults, or a minute list), files [{id, name, size, type, addedAt}]}`.
  - A birthday is `{name, month, day, year (optional), lunar, me, note, reminders}`. Lunar birthdays keep the lunar month and day.
  - Seed items `inbox` and `cal-main` have `updatedAt: 1` and never upload.
- **Prefs.** These are device-local and never synced: `tickwise.prefs.v1`, read with `store.getPrefs()` and written with `store.setPrefs()`. They include the style, theme, accent, sidebar choices, sound, calendar view and the Firebase config.
- **Firestore.**
  - Documents live at `users/{uid}/items/{id}`. Each write adds `srv` = the server timestamp.
  - Task files live outside the items, so they aren't streamed to every device: `users/{uid}/files/{fileId}` `{name, size, type, parts, done}` and `users/{uid}/files/{fileId}/parts/{n}` `{i, data: Bytes}` (768 KB pieces, 8 per commit to stay under Firestore's 1 MiB document and 10 MiB request limits). Cloud Storage isn't used because it needs the paid Blaze plan. The bytes are also kept in IndexedDB (`checkmate-files`); queues are in localStorage (`tickwise.filequeue.v1`, `tickwise.filedelete.v1`). A file whose task is gone is cleaned up after 3 days (Undo can bring the task back).
  - Devices listen for `srv > lastServerTime`. The newest `updatedAt` wins.
  - The security rules are in the README (each user can only read and write their own items).
  - Setup codes carry the Firebase config between devices.
- **Claude connector.**
  - It is the item with id `claude` and type `connector`. Its fields are `secret`, `gen`, `tz`, `url` and `authAt`.
  - Disconnect changes `gen`, which invalidates every token.
  - The Worker uses Firestore REST as the user, so the rules apply. It runs the app's own `parse.js`, `recur.js`, `events.js` and `filters.js` through the shims.
  - It writes items exactly the way the app does, and keeps no data of its own.

---

## 5. Windows and Android specifics

**Windows**

- No installer, and not code-signed.
- Data is in `%LOCALAPPDATA%\Checkmate`. Data from the old Tickwise name is migrated.
- There is a single-instance mutex.
- **Icon switching:**
  - Shortcuts are retargeted through IShellLink with `IconLocation` set to `exe,-<group id>`.
  - The exe swaps itself on close: it writes a copy with UpdateResource, renames the running exe to `.old`, and moves the copy into place. `cleanupFileIcon()` removes `.old` on the next start.
  - `SHChangeNotify` refreshes Explorer.
  - `sameIcon` compares pictures, not group bytes.

**Android**

- Package `app.tickwise` (kept from the Tickwise days so updates install over the old app).
- minSdk 24, targetSdk 34.
- Six launcher `activity-alias` entries, one per style. They are switched in `onStop` by `LauncherIcons.applyPending`.
- Reminders use AlarmManager and survive reboots.
- `GoogleFetch` reads Google links for calendar subscriptions and Docs.

---

## 6. Building

**Needs**

- Node 18+ (22 used)
- Go 1.24
- JDK 17+
- Python 3 with Pillow and cairosvg

**Build tools.** Put these in `~/tools`, or point `TOOLS=` at their folder. The download links are at the top of `build.sh`.

| Tool | Version | Where it goes |
| --- | --- | --- |
| apktool | 2.12.1 | `$TOOLS/apktool/apktool.jar` |
| uber-apk-signer | 1.3.0 | `$TOOLS/signer/uber-apk-signer.jar` |
| dx (from dex2jar 2.1) | 27.0.3 | `$TOOLS/dex2jar/x/dex-tools-2.1/lib/dx-27.0.3.jar` |
| go-winres | v0.3.3 | `$TOOLS/go-winres`; build with `go install github.com/tc-hib/go-winres@v0.3.3` and copy the binary there |

**Go modules.** `desktop/go.mod` replaces `golang.org/x/sys` with `third_party/sys` (v0.33.0, included in the zip). `github.com/jchv/go-webview2` downloads through the Go module proxy.

**Commands**

```
cd checkmate
(cd web && npm install)
TOOLS=~/tools ./build.sh                      # → dist/Checkmate.html, .exe, .apk (dev-signed APK)
KEYSTORE=/path/to/tickwise-release.jks KS_PASS=… TOOLS=~/tools ./build.sh   # release-signed APK
(cd web && MOCK_FIREBASE=1 node build.mjs)    # → web/dist-test, needed by test/sync.cjs
(cd web && node build.mjs)                    # quick rebuild of just the HTML while working
```

**Version bump.** Do this on every release:

1. Update `web/src/version.js`.
2. Update `desktop/winres/winres.json`. The version appears 5 times; `sed -i 's/2\.2\.0/2.2.1/g'` covers them all.
3. In `android/apk/apktool.yml`, update `versionName` and add 1 to `versionCode`.
4. Add the release to `web/src/changelog.js` (English and Chinese).

---

## 7. Signing (important)

- **Keystore:** `tickwise-release.jks`, kept **outside the repository** by the maintainer (back it up; it can't be recreated). Put it in `android/signing/` (git-ignored) or anywhere else and set `KEYSTORE`.
- **Alias:** `tickwise` (`KS_ALIAS`).
- **Password:** never written in the repository. Pass it as `KS_PASS`.
- **Certificate SHA-256:** `599a499064521bfb5d98a4fe699c702fea57a0b02d17a762ac314b613b358037`. This is public on purpose: anyone can check that a downloaded APK really is Checkmate.

Without the key (or without `KS_PASS`), `build.sh` prints a warning and signs with a throwaway development key. That APK works for testing, but phones that have Checkmate will refuse to update to it, so never publish it. To check a build:

```
java -jar ~/tools/signer/uber-apk-signer.jar -y --apks dist/Checkmate.apk
```

The SHA256 it prints must match the value above.

---

## 8. Tests

Run everything with `OUT=/some/folder test/run-all.sh`. It prints PASS/FAIL for each test, and logs and screenshots go to `$OUT`. Each browser test takes a screenshot folder as `argv[2]`. Never let a test write PNGs into the project.

**What the tests cover**

| Area | Tests |
| --- | --- |
| Basics | `smoke`, `dnd`, `accent` |
| Each style | `archive`, `riot`, `tide`, `frontier`, `neon` |
| Sounds and icons | `sound`, `icons` (bridge calls for app icons) |
| Layout | `frame` (hover, handles, scroll guard; `FRAME_HTML` env picks the file) |
| Settings | `settings-more` (Theme, Sidebar, About, Donate, all styles, phone) |
| Task name hint | `examples` (dated, random, Chinese, phone ellipsis) |
| 2.2.0 features | `v22` (orange default, Persona 3 icon, time kept in names, reminders and custom times, birthdays and lunar dates, What’s new, Chinese, phone) |
| Task files | `files` (two devices through the fake Firestore: pieces, download on open, save, removal, the 100 MB limit) |
| Language | `chinese` |
| Docs & Sheets | `docs` (against fake Google responses) |
| Sync | `sync` (two devices, fake Firestore) |
| Calendar | `calendar`, `calendar-styles`, `recur.mjs` |
| Claude connector | `connector.cjs` (OAuth and every tool; also `RUNTIME=workerd` via wrangler), `connector-tz.mjs`, `claude.cjs` (app and connector together through one fake Firestore) |
| Windows host | `go test` in `desktop/` |

`tour.cjs` takes screenshots of every style and is not in the suite.

**External test dependencies.** These paths are hard-coded, so change them if needed:

- Playwright 1.56 at `/opt/node-tools/node_modules/playwright`, with Chromium.
- `@modelcontextprotocol/sdk` and `wrangler` at `/home/claude/tools/mcp/node_modules`.
- `SCRATCH` sets the connector tests' temp folder.

**Known noise**

- `chinese` always reports FAIL (exit code 2) because of two expected English leftovers: "Language, English" in General and the Firestore rules code in Sync. Anything else it lists is a real miss.
- `claude` can time out once when the whole suite runs under load. Rerun it alone.

---

## 9. How changes have been done (keep doing this)

1. Read the relevant code, make the change and add or extend a test.
2. Screenshot all six styles, light and dark, at desktop and phone width, and look at them.
3. Add zh-Hant strings, and update `README.md` if the feature is user-visible.
4. Bump the version and add a `changelog.js` entry.
5. Run `build.sh` and the MOCK build, then the whole suite.
6. Check the packages:
   - The APK's `assets/index.html` equals `dist/Checkmate.html`.
   - The exe contains the HTML.
   - The versions are correct.
   - The signing certificate matches.
7. Commit (`.gitignore` keeps `dist/`, build folders, generated icons and the key out), then tag the release: `git tag v2.2.1 && git push --tags`.
8. On GitHub, **Releases → Draft a new release**, pick the tag, paste the `changelog.js` entry as the notes, and attach `Checkmate.exe`, `Checkmate.apk` and `Checkmate.html` from `dist/`. GitHub adds the source zip by itself.

---

## 10. Lessons learned (don't re-break these)

- **Scrolling.**
  - `.app` uses `overflow: hidden; overflow: clip;`. With plain `hidden`, focus or script can scroll it, which once pushed the Persona 3 calendar toolbar off screen.
  - The scroll guard is in `main.jsx`.
  - Modal and Menu focus uses `focus({preventScroll: true})`.
- **Task row hover.**
  - The drag handle (`.grip`, left at `calc(var(--indent) - 44px)`) and the subtask arrow (`.twisty`) must not overlap.
  - The `.row-gutter` span keeps hover steady across the gap.
  - In Cyberpunk the hover bar is drawn on `::after`. A `clip-path` on the row hid the handle and caused a hover/sound flicker loop. The bar uses `--gutter-ink`.
- **Hover sound.** It is debounced (600ms) in `sound.js`.
- **CSS names.** Generic class names collide (for example `.dn` with the week view's `.week-day .dn`). Give panels specific names such as `.donate-panel` and `.about-panel`.
- **Quick add.** Q closes after adding (`keepOpen={false}`), while the inline "Add task" box stays open. Long hints are cut at a word with "…" by `fitHint` in `editor.jsx`, because the browser won't put an ellipsis on a focused input.
- **Connector.**
  - Workers modules may only export handlers. `export const` broke workerd.
  - `connector/build.mjs` patches `dates.js`'s `today()` line exactly. If that line changes, the build stops on purpose.
- **Connector address check.**
  - The field is `type="text"`, not `"url"`.
  - The check uses a `no-cors` probe to tell "not a connector" from "unreachable".
- **Prefs.** Prefs are device-local by design. Don't sync them.

---

## 11. Version history (recent)

| Version | Change |
| --- | --- |
| 2.1.0 | Claude connector (Settings → Claude, Cloudflare Worker, OAuth, 16 tools) |
| 2.1.1 | The subtask arrow no longer overlaps the drag handle; the arrow is visible on the Persona 3 white hover bar |
| 2.1.2 | Cyberpunk 2077: the drag handle is visible again, and hovering the arrow no longer repeats the page sound |
| 2.1.3 | The app icon follows the style in the EXE (shortcuts and exe) and the APK (launcher) |
| 2.1.4 | Calendar month → day: the Persona 3 toolbar no longer disappears, and Persona 5 can scroll back up |
| 2.1.5 | Settings: Sidebar (choose pages, task counts), About, Donate |
| 2.1.6 | Task name examples by date, otherwise random. English and Chinese, with an ellipsis on phones |
| 2.1.7 | New Settings → Theme tab (style, app icon switch, light/dark, theme colour) |
| 2.2.0 | Birthdays (optional lunar dates), task files up to 100 MB, reminder timing (per task, defaults, custom), the typed time stays in task names, Checkmate orange (#F46B25) default colour, Persona 3 icon fix, Settings → What’s new |

Earlier releases built the core: tasks, projects, filters, the calendar, sync, six styles, sounds, Traditional Chinese, Docs & Sheets, and the rename from Tickwise to Checkmate.
