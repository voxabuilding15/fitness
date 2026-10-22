# Architecture

This document separates **what exists today** from **where the app is going**. Nothing in the
"Intended" section is implemented yet unless a later phase says so.

---

## 1. Current architecture (as of Phase 0)

Expo SDK 57, React Native 0.86, TypeScript (strict), Expo Router. Everything is local; there is no
backend, account system or network API.

```
src/
  app/          Expo Router routes: (tabs)/{index,workouts,statistics,profile}, templates/*, exercises/*, session/[id], history, reminders
                (each route re-exports a screen)
  screens/      Home, Workouts, Statistics, Profile, Template*, Exercise*, Session, History, ReminderSettings
  components/   Shared UI (AppText, Screen, BottomNavigation, StatCard, FormControls, charts, ...)
  context/      AppContext: profile + settings state, language/RTL, persistence calls
  hooks/        useFormat, useIsNarrow, useTemplates, useHome, useStatistics, useWorkoutHistory, ...
  services/     profileService, settingsService, reminderService, soundService, storage (AsyncStorage)
  data/         exerciseLibrary.ts  (the 68 built-in exercises, seeded into SQLite)
  i18n/, locales/   i18next; en.json and ar.json
  types/        activity, profile, settings, workout
  __tests__/    logic.test.ts (17 tests)
```

**Data layer (Phase 1; the Goals screen and the Profile tab use it since Phase 2):** an offline SQLite foundation.

```
src/domain/        Pure TypeScript. Result/AppError, Clock, dates, session lifecycle rules, Zod input schemas,
                   entity models and the repository interfaces (domain/repositories.ts).
src/db/            sqlDatabase.ts (SqlDriver interface) · database.ts (single connection, FIFO lock, transactions,
                   foreign-key assertion) · mapDbError.ts · migrations/ (001-009 + runner) · backup.ts / expoBackup.ts ·
                   repositories/ (9 implementations) · seedRunner.ts (applies a versioned pack; the 68-exercise pack lives in src/data/exerciseLibrary.ts) · seedStartup.ts · legacyImport.ts
                   (one-time import of the old AsyncStorage profile, run by legacyStartup.ts when the database is ready) · initDatabase.ts · expoSqliteDriver.ts · appDatabase(.web).ts
src/db/testing/    TEST-ONLY: node:sqlite driver, file backup strategy, test helpers. Never imported by app code.
src/context/DatabaseContext.tsx   Starts the database in the background; never blocks or breaks the app.
```

Key design points (each is covered by a test):
- **One connection, one operation at a time.** `Database` serializes everything through a FIFO lock (with a timeout that
  fails as `busy` instead of hanging) and runs transactions as `BEGIN IMMEDIATE ... COMMIT/ROLLBACK` on that connection.
  expo-sqlite's `withTransactionAsync` can interleave with other queries, and `withExclusiveTransactionAsync` opens a
  second connection **with foreign keys off** (and issues `BEGIN` before user code, so the pragma cannot be set), so neither is used.
- **Foreign keys are enabled and read back** on open and re-checked at the start of every transaction; initialization
  fails (database unavailable) if they are not enforced. expo-sqlite never enables them by itself.
- **Schema:** STRICT tables, explicit `NOT NULL` (a bare `CHECK` lets NULL through), real-calendar-date checks
  (`date(x) IS x`), triggers for the session lifecycle: `in_progress -> completed | discarded`, both terminal;
  discarded sessions are frozen and never counted; from migration 009 the exercises and sets of a COMPLETED session are
  immutable too (see section 5h). Only a completed session's own name, rpe and end time can still be corrected, and the end
  time keeps consistent with its sets.
- **Migrations:** `PRAGMA user_version`; all pending migrations in one transaction (all or nothing). A database that
  already holds data is backed up and the backup **validated** first; if that fails nothing is changed and the database
  is reported unavailable. A **row-loss guard** compares per-table row counts before and after the migration and rolls
  it back if any table ends up with fewer rows (this catches `ON DELETE CASCADE` row deletions during a table rebuild,
  but NOT `ON DELETE SET NULL` or value changes; see section 6). A migration that intends to drop data must declare
  `allowRowLoss`, which disables the check for every table in that upgrade.
- **Backups (hardened; the earlier wording was too strong).**
  - Names must match a strict pattern (`fitness-premigrate-v<from>-to-v<to>-<timestamp>[-n].db`). The migration
    runner and BOTH backup implementations refuse any other name, so corrupted bookkeeping cannot make pruning target
    the live database (`fitness.db`, or its `-wal`/`-shm` files) or any file whose name does not match the pattern;
    refused names are reported as warnings and never touched. The check is on the NAME ONLY: it does not establish who
    created a file or that it is a genuine backup, so a file in the backup directory whose name matches the pattern
    (for example one copied there by hand) and that is listed in the stored backup list CAN still be deleted.
  - Backups are never overwritten (fresh destination verified). The new backup is validated before anything is pruned;
    a valid recovery backup is never deleted before its replacement is validated.
  - Retention is bounded (default 3, clamped to 2..10) and applied right after the new backup is validated, so repeated
    failed migrations cannot accumulate backups without limit. A prune failure is only a warning; failed removals stay tracked.
  - **Residual limits:** (1) a database at `user_version` 0 that already contains foreign tables but no `app_meta` has
    no backup list, so its backups are not tracked or trimmed; (2) the backup list lives in the same database it protects;
    (3) the real expo-sqlite backup/delete calls are not exercised by any automated test (see section 4).
- **Native module loading.** `expo-sqlite` is loaded lazily (`expoSqliteModule.ts`), inside the initializer's guard. If
  the native module is missing from the binary (for example an older development build) the result is a typed
  `unavailable` / `native_module_missing`, not a crash at import; the rest of the app keeps running. ESLint restricts
  `expo-sqlite` to three files and forbids `require('expo-sqlite')` elsewhere.
- **Connection close.** `Database.close()` waits for the lock (so it never closes during an active transaction), a
  failed driver close marks the database unusable (retryable), and a failed rollback leaves the connection marked broken
  instead of leaking a half-open driver.
- **Development diagnostics.** In `__DEV__` only, a failed initialization logs `[db] initialization failed` with the error
  kind and a few structural fields (reason code, schema versions). Messages, SQL, paths and stored values are never logged.
- **Session insertion invariants.** A session can only be INSERTED `in_progress` (trigger `sessions_insert_in_progress`);
  completed/discarded sessions are reached only through the lifecycle transitions, which enforce "needs a completed set".
  Migration 003 was edited in place because Phase 1 is unreleased; no shipped database has an older version 3.
- **User-supplied times** (set `completedAt`, corrected `endedAt`) may not be more than 5 minutes ahead of the clock.
  **Meal snapshots** that would exceed the per-entry limits (20,000 kcal, 2,000 g protein/fat, 3,000 g carbs) are a
  validation error (`amount: outOfRange`), not a raw CHECK failure.
- **Initialization** is a single shared in-flight promise; failures are not cached, never reject, and never delete data.

**Persistence the app uses today:** the **profile and goals live in SQLite** (since Phase 2). AsyncStorage still holds the
**settings** blob (`fitness.settings.v1`: language, sound, reminders, experience, caution areas) and the OLD profile blob
(`fitness.profile.v1`). The old profile key is only ever **read**, once, by the legacy import (see section 5d); it is never
written, changed or deleted, so it stays as a safety copy. The app no longer writes it.

**RTL/LTR:** direction is applied with a `direction` style on the root view (not `I18nManager`);
directional icons are swapped by `Icon`, absolute end-offsets use `endInset`. Verified in the web
renderer only; not yet verified on a physical device.

**What is real vs sample today:**
- Real: language, profile, goals, settings, reminders, the exercise library, saved workouts, workout sessions and history, the Statistics screen and the Home screen's weekly totals, workout card and search (sections 5e-5k).
- Sample data: none is left in the app screens.

**Tests today:** Jest. Services, locales and the whole data layer are tested; screens, components, hooks and the React
contexts have **no** automated tests (0% coverage). Coverage numbers are informational only.

---

## 2. Intended architecture (planned; `domain/` and `db/` below now exist, features/ and ui/ do not)

Offline-first core: exercise library, custom workouts, session tracking, history, nutrition, water,
weight, habits, and statistics computed from saved data.

```
src/
  domain/       Pure TypeScript: types, validation, calculators (BMR/TDEE, macros, 1RM, volume, ...),
                units, dates. No React / React Native / Expo imports (enforced by ESLint).
  db/           expo-sqlite: connection, ordered migrations, repositories (implement domain interfaces).
  features/     One folder per area (workouts, session, nutrition, water, weight, habits, stats,
                profile, settings): screens, components, hooks and services for that area.
  ui/           Shared design-system components (what src/components is today).
  i18n/, locales/
```

Dependency direction: `app` -> `features` -> (`domain`, `db` via interfaces) ; `domain` depends on
nothing. UI code never imports `src/db` directly (enforced by ESLint).

### Conventions to adopt in Phase 1+
- **Units:** store metric only (kg, cm, ml, kcal). kg/lb and cm/in are display settings.
- **Dates:** store a UTC timestamp plus a `local_date` (`YYYY-MM-DD`) for day grouping.
- **Errors:** repositories return a `Result` type; the UI shows a visible error instead of failing silently.
- **Validation:** all user input validated at the boundary before it reaches the database.
- **Honest data:** nothing is shown as a measurement unless it came from user input or a real source.
  Calculated values (BMR, TDEE, calories burned, 1RM, ...) are labelled as estimates.
- **No automatic steps / heart rate** without a platform integration and user permission.
- **i18n:** every user-visible string in both `en.json` and `ar.json`; key parity is tested.

### Migration approach
Existing files are moved only when a phase touches them (no big-bang refactor), so the app keeps
working at every step. Existing AsyncStorage profile/settings are migrated, not discarded.

---

## 3. Tooling and CI

- `npm run check` = typecheck + lint + tests (Node `^22.13` / `^24.3`: the data-layer tests use the built-in `node:sqlite`). `npm run test:ci` adds coverage. `npm run export:ios`
  validates that an iOS Hermes bundle builds.
- `.github/workflows/ci.yml` runs `npm ci`, typecheck, lint, tests (with coverage artifact) and the iOS export
  on pushes to `feature/**` / `test/**` and on pull requests.
- Coverage is **informational**: all of `src/` is included in the report so untested files show as 0%;
  no threshold is enforced yet.

### CI limitations
- `expo-doctor` is **non-blocking** (`continue-on-error`) only because it queries Expo and React Native
  Directory servers. In the restricted development sandbox those hosts are unreachable and two of its
  21 checks fail for network reasons only (19/21 pass). On GitHub-hosted runners it should have network
  access; its result is still visible in the run, it just does not block merges. Revisit once confirmed.
- The workflow has not been executed on GitHub yet (nothing has been pushed). It was validated locally
  for syntax and its commands were run locally.
- No physical-device testing is part of CI.

---

## 4. What is tested where (important limits)

| Behaviour | Node SQLite (Jest, CI) | Real Expo SQLite on a device |
|---|---|---|
| Schema, constraints, triggers, FK actions, `foreign_key_check` | Tested (SQLite 3.50 in Node) | **Not tested.** Device bundles SQLite 3.49.1; no features newer than 3.38 are used, but this is unverified there |
| `Database` class (lock, timeout, transactions, rollback, FK assertion), migrations, repositories, validation, `legacyImport`, seed runner, initializer | Tested (same code runs in production; only the driver differs) | Not tested |
| Backup logic: strict name allowlist, fresh destination, no overwrite, validate-before-prune, bounded retention, prune failures | Tested with a Node file strategy **and** against a *fake* expo-sqlite API | **Not tested**: the real `backupDatabaseAsync` / `openDatabaseAsync` / `deleteDatabaseAsync` calls |
| `ExpoSqliteDriver` (`runAsync`/`getAllAsync`/`execAsync`), `appDatabase.ts`, lazy loader | Loader failure path tested with a mocked-throwing module; the working path only against a **fake** expo-sqlite API backed by Node SQLite (wiring, not native behaviour); otherwise type-checked and bundled | **Not tested** |
| Foreign keys actually ON through expo-sqlite | Simulated: the Node driver starts with FKs OFF like expo does and must pass the same enable-and-verify path | **Not tested**; at runtime the verify step makes the database unavailable if it fails |
| `DatabaseProvider` (React glue) | Not tested (no React test library in the project) | Not tested |

**No physical-device (or simulator) test of the Expo SQLite driver has been performed.** Phase 1 ships no screen that
displays database status, so there is currently nothing observable to check on a phone; a device smoke test (open, migrate,
insert/read, foreign-key rejection) needs either a diagnostic or the first database-backed screen, and is deliberately left to a later phase.

---

## 5. Limitations of the web build
`src/db/appDatabase.web.ts` reports the database as `unavailable` (`web_unsupported`): expo-sqlite on web needs
WebAssembly assets and cross-origin isolation, and the product targets iOS/Android. Everything that does not need the
database (all current screens) works on web as before.

---

## 5b. Phase 2 (Profile & Goals) - milestone 1: pure calculators and units

Plan source: the approved phase plan ("Phase 2 - Profile & Goals: `domain/calculators.ts` (BMR/TDEE/macros/water/MET/1RM),
goals screen, kg/lb units; tests with known values; acceptance: goals change with the profile and everything is labelled
an estimate"). Milestone 1 adds only pure code, no screen, no database access and no change to existing behaviour:
- `src/domain/units.ts`: kg/lb and cm/ft-in conversions (exact definitions; storage stays metric, only display rounds).
- `src/domain/calculators.ts`: `estimateBmr`, `estimateGoals`, `estimateActivityKcal`, `estimateOneRepMax`. Every result
  is typed `Estimate<T>` (`isEstimate: true`) so a UI cannot present one without knowing it is an estimate. Missing or
  out-of-range inputs return `validation` issues by field; nothing is defaulted or guessed.
- Formula choices to confirm (named constants, one place each): Mifflin-St Jeor BMR; activity factors 1.2 / 1.375 / 1.55 /
  1.725 / 1.9; calories -20 % / 0 / +10 % of TDEE and never below the estimated BMR; protein 2.0 / 1.6 / 1.8 g per kg; fat 25 %
  of calories; carbohydrate the remainder; water 35 ml per kg (rounded to 50 ml); MET x kg x hours; Epley 1RM for 1-12 reps only.
- Not part of this milestone: the goals screen, saving goals, `legacyImport`, the profile screen switching to the database,
  weekly workout target. These need the decisions listed in the milestone report.

## 5c. Phase 2 - milestone 2: Goals screen

Route `/goals` (`src/app/goals.tsx` -> `src/screens/GoalsScreen.tsx`), opened from a new "Goals" row in Profile. Form logic is
pure and tested in `src/domain/goalsDraft.ts`; the screen only renders it and calls the existing repositories through
`useDatabase()` (`goals.get/save`, plus read-only `profile.get` and `weight.latest` to prefill). No new persistence layer.
- Approved decisions applied: balanced nutrition (`maintain`) preselected and customizable; kg/cm only; the weekly workout
  target is chosen by the user (no default, saving is blocked until it is chosen); calorie change starts at a 20 % deficit
  (fat loss) or 10 % surplus (muscle gain) and is editable (0-40 % / 0-25 %); water is a "Preliminary estimate" with a
  not-medical-advice note.
- Honest labelling (per field, in `fieldBadges`): a calculated value shows "Estimate"; once the user changes it, "Edited" (it
  never looks like a fresh calculation); if the inputs changed since the calculation, "Outdated estimate". **Water is always
  labelled "Preliminary estimate"** (whoever typed the number, also after reopening saved goals) and the not-medical-advice note
  stays. The database stores one `source` per goals row, so per-field provenance is not persisted: reopened goals show only the
  water label, and values the user did not edit are treated as their own goals.
- Saving: an untouched, up-to-date calculation is saved as `calculated`. If the inputs changed after the calculation, saving
  stores the numbers as `manual` (never `calculated`) and the screen says so before and after. Recalculate to get `calculated` again.
- Loading and retries: if the stored goals/profile/weight cannot be read, Save is disabled and cannot write (the form shows why and
  offers "Reload saved goals"), so an empty fallback form can never replace stored goals. When the database becomes ready after the
  user already typed (retry after "unavailable", or a reload), database values only fill fields the user has not touched
  (`mergePrefill`); the inputs an estimate was calculated from are protected as well.
- Limits are reported, not hidden (`GoalEstimate.limits`, `bmrFloorApplied`): the BMR note appears only when the target really
  was set to the BMR; the 800/6000 kcal limits, the 600 g protein/fat caps, a 0 g carbohydrate result (protein + fat already exceed
  the calories) and the 500/8000 ml water limits each get their own note. If the estimated BMR is above 6000 kcal (the largest
  target the goal schema stores) there is no honest answer inside the range, so `estimateGoals` returns a validation error
  (`goals.calorieConflict`) instead of a target below the BMR. Enum inputs are checked with own-property lookups, so
  prototype keys such as `constructor` or `__proto__` are rejected, and a non-finite number can never be returned as a success.
- Keyboard: `Screen` takes `avoidKeyboard`. iOS uses the ScrollView's `automaticallyAdjustKeyboardInsets`; Android wraps the
  scroll view in a `KeyboardAvoidingView` (`padding`) because SDK 57 apps are edge-to-edge and the window may not resize. Tests check
  which mechanism is requested; they cannot show that the keyboard really stops covering a field. That needs a device or simulator.
- Nothing is invented: sex, age, height, weight and activity level start empty unless the database already has them;
  missing or invalid fields are named in the messages and nothing is calculated.
- **Typed numbers are never guessed** (`src/domain/numberText.ts`). One "." or "," is a decimal mark (`80,5`, `0,500`, `1,2345`);
  repeated, correctly spaced marks are grouping (`1,500,000`, `1,500.5`, `1.500,5`); Latin, Arabic-Indic and Persian digits are
  accepted. A single mark followed by exactly three digits after one to three digits (`1,500`, `2.500`) could be 1.5 or 1500 and is
  rejected with its own message (`validation.ambiguousNumber`) instead of being turned into either.
- **Stored age and weight must be fresh** to prefill (`freshness` in `goalsDraft.ts`). The profile keeps `ageSetOn`, the local
  date the age was entered (the database requires it whenever an age exists); weight entries carry `localDate`. An age older than
  365 days, or any value dated in the future or with an unreadable date, is NOT filled in: the screen shows a note with the stored
  value and date and asks for the current one. A weight older than 30 days is treated the same way. The age is not recomputed
  because the birthday is unknown. Height and sex are not date-limited.
- **Weekly target range:** the screen offers every value the goals schema stores (0-14), so a stored value is always selectable;
  a test ties the choices to the schema. Saved values are preserved.
- **Accessibility:** radio options are at least 44 x 44 points; card titles are headings; a field's error text is also its
  accessibility hint. Loading, "loaded", calculation results, fields that need attention (in on-screen order), save results and
  errors, load failure and "estimate is outdated" are announced through `AccessibilityInfo.announceForAccessibility`
  (`src/services/accessibility.ts`) - one mechanism for iOS and Android, no `accessibilityLiveRegion` (Android only; would double
  the speech). Tests check what is announced and when; they cannot show how VoiceOver / TalkBack actually speak or order it.
- The estimate inputs (sex, age, height, weight, activity) are NOT saved by this screen. The database `profile` table needs a
  display name and moves to the database in milestone 3, so this screen does not write it; the current Profile tab still keeps
  age/height/weight in AsyncStorage. Until milestone 3 the person types those values here again. The calorie adjustment
  percentage is not stored either; only the resulting numbers are.
- `legacyImport` is not run by this screen; since milestone 3 the app runs it once at startup (section 5d). The Goals screen
  never touches AsyncStorage.
- Tested with real repositories on Node SQLite (`GoalsScreen.test.tsx` renders the screen with react-test-renderer, which comes
  with jest-expo). That is NOT a test of the Expo SQLite native driver and not a visual/layout test; the screen has not been
  run on a device or simulator.

## 5d. Phase 2 - milestone 3: the Profile tab on SQLite, and the legacy import

- **Single source of truth.** The Profile tab reads and saves through `ProfileContext` -> `repos.profile` / `repos.weight`.
  The Home greeting uses the same stored name (`useProfileName`); with no stored profile, while loading, or when the database is
  unavailable it greets without a name. **The built-in demonstration profile (the one `AppContext` holds for someone who never
  saved a profile) is never shown as the person's own.** If the database is unavailable (for example on web, or when the native
  module is missing) the Profile tab shows only an unavailable message with a retry button - no profile values at all - and offers
  no editing; the old AsyncStorage blob stays untouched and is simply not displayed. Nothing is written to AsyncStorage any more.
- **The legacy import** (`importLegacyProfile`, started by `legacyStartup.ts` inside `appDatabase.ts`; the database is reported
  ready only after it finished) is a one-way, idempotent COPY:
  - **Dates are never invented.** The old profile never recorded when age or weight were typed, so they are imported with NO
    date: migration **007** lets `profile.age_set_on` be NULL while an age exists ("entered at an unknown time"), and adds
    `profile.undated_weight_kg` for a weight of unknown date. The weight is NOT written to `weight_entries` (its rows always
    have a real day), so it never shows up in history. Screens treat a NULL date as "possibly out of date" and ask for a current value.
  - **No display name is made up.** Without a valid name no profile row can exist, so nothing is imported (error
    `legacy_data_invalid`, no marker, the old blob untouched, retried next launch).
  - **Partial data** is imported field by field; invalid fields are skipped and reported.
  - **Newer data always wins.** An existing database profile keeps its name and every value it has; only EMPTY fields are filled,
    and a legacy weight is ignored once any dated weight entry exists.
  - **Atomic and idempotent.** The writes and the "already imported" marker (re-checked inside the transaction) are one
    transaction: an interrupted import leaves nothing behind and simply runs again; overlapping runs import once; a finished run
    is remembered for the session, a database error is retried on the next call.
  - **AsyncStorage is only read** (the importer is typed read-only; tests assert no write or delete call happens).
- **Migration policy.** Migrations 001-006 were pushed in Phase 1, so the date rule was NOT changed by editing them: 007 is a new
  migration. It rebuilds `profile` (SQLite cannot alter a CHECK); nothing references that table, so no foreign key can cascade,
  and the row-count guard passes. The older caveats about rebuild migrations (section 6) still apply to any other table.
- **What the Profile tab writes.** Only what changed: an unchanged age keeps its stored date (possibly unknown), so editing the
  name never makes an old age look current; a typed age is dated today; an unchanged weight is not logged again, a changed one
  becomes a manual weight entry for today; an empty age / height / weight field means "leave as it is". Profile and weight are
  two writes: if the weight fails after the profile saved, the screen says exactly that.
- **Sex and activity level.** They are stored in the nullable `profile.sex` / `profile.activity_level` columns and can only be
  written through `profileRepository.save`. **No screen sets them today**: the Profile tab does not edit them (it passes any
  stored value through unchanged, so a value written by other code would never be erased), and the Goals screen only READS them
  to prefill its form and does not save what is typed there. In the app as it stands they therefore stay empty, and the Goals
  screen asks for them each time. Letting the person save them is future work, not part of this milestone.
- **Editing availability.** The "Personal Information" row and the header edit button exist only while the stored profile was
  read successfully (never while loading, unavailable, or after a failed read), so no action is offered that does nothing.
- **Screen-reader announcements** (`AccessibilityInfo.announceForAccessibility`, once per change, no live regions): loading and
  "loaded", a failed read, the database being unavailable, and an unreadable legacy profile. Opening the tab after the profile
  has already loaded says nothing. How VoiceOver / TalkBack actually speak these needs a device.
- **Failed reads never lead to overwrites.** If the stored profile cannot be read, editing is switched off and a reload is offered.
- **Not verified:** all of this is tested on Node SQLite and with a fake expo-sqlite API. The real Expo SQLite driver, the import
  against real AsyncStorage data on a device, and the screens on a device or simulator have not been run.

---

## 5e. Phase 3 - milestone 3.1: the exercise library

**What it is.** A searchable, bilingual library of 68 original built-in exercises plus the person's own, reachable from the Workouts tab (`/exercises`, `/exercises/[id]`, `/exercises/form`). No migration: it uses the `exercises` table of migration 002 and the existing seed runner.

**Seeding.** `src/data/exerciseLibrary.ts` is the single list (ids such as `benchPress`, slugs `bench_press`). `createAppDatabase` now runs `legacy.run` then `seed.run` (`db/seedStartup.ts`: single-flight, remembers its result, retries after a transient failure). A seed failure never makes the database unavailable; the library just shows what is there. Built-in rows hold no name: the displayed name is the translation `exercises.<camelCase slug>` in `en.json` / `ar.json` (the 32 demo-workout exercises share these keys). Built-in rows are immutable (delete is blocked by a trigger) but can be hidden (`is_archived`); a later pack version updates by slug and never removes content, un-hides anything or touches custom exercises. No MET values, instructions or images are shipped on purpose (nothing unverified or copied).

**Search and duplicates** run on the displayed name in memory (`domain/exerciseLibrary.ts`): case, Arabic diacritics/tatweel, alef/yaa/taa-marbuta variants and punctuation are normalised. SQL `LIKE` cannot be used because built-in names are not in the database.

**Custom exercises.** Create, edit, hide, delete (blocked with a clear message while a template or session uses it) and "Duplicate as my own" for built-ins. Nothing is preselected in the form; the main muscle cannot also be a secondary one (max 5). Final validation is the shared `exerciseInput` schema.

**Tested:** domain logic, library data integrity (translations in both languages, demo workouts' ids all present), seed startup, and the three screens against Node SQLite. **Not verified on a device:** native SQLite seeding, screen-reader output, RTL layout, keyboard behaviour. The Arabic exercise names and UI strings were written for this milestone and need review by a native speaker.

## 5f. Phase 3 - milestone 3.2: the workout builder (templates)

**What it is.** "My workouts" on the Workouts tab (`/templates`, `/templates/[id]`, `/templates/form`): build a named workout from library exercises, with sets, a rep range (or seconds for timed exercises) and rest per exercise; reorder, remove, save, reopen, edit, duplicate and delete. No migration: it uses `workout_templates` / `template_exercises` (migration 002) and the existing `TemplateRepository`, whose create/update/duplicate are single transactions (an update rewrites the rows and rolls back whole on failure).

**Layering.** `domain/templateBuilder.ts` is pure: a draft keeps every number as typed text; operations add/move/remove/update rows; `planTemplateSave` validates (name required and at most 60 characters, no other workout with the same name after normalisation, at least one and at most 30 exercises, whole numbers within the schema ranges, max reps not below min) and then runs the shared `templateInput` schema. `hooks/useTemplates.ts` reads templates and exercises together on focus and reports any failed read as `failed`, never as an empty list; the builder shows no form and no Save button unless that read succeeded, so a failed read can never be followed by a write over unread data. Hidden exercises stay in templates that use them (they can't be deleted while used) and are left out of the picker.

**Decisions.** Workout names must be unique (checked in the app; the table has no UNIQUE constraint and none was added). "Duplicate" picks a free name from a fresh read ("X (copy)", "X (copy 2)"). The same exercise may appear twice in a workout. The seconds field is used for timed exercises, reps for the others. Starting targets (3 sets, 8-12 reps or 30 s, 60 s rest) are ordinary defaults the person edits. Deleting a workout keeps completed sessions (their `template_id` becomes NULL) and all exercises. The demo workouts on the Workouts tab are still static; starting a session from a template is a later milestone.

**Tested:** domain logic, repository behaviour including close/reopen of a real database file (five-exercise workout keeps order and targets), and the three screens against Node SQLite in English and Arabic. **Not verified on a device:** native SQLite, screen-reader output, RTL layout, keyboard behaviour with many rows, touch reordering. Arabic strings need review by a native speaker; the Arabic term for a workout ("حصة") is my choice.

## 5g. Phase 4 - milestone 4.1: starting a workout session

**What it is.** A "Start workout" button on the saved-workout detail screen creates a real session and opens `/session/[id]`. No migration and no new repository method: it calls the existing `sessions.start({ templateId })`, which in one transaction reads the template's name and its exercises in `position` order, inserts an `in_progress` `workout_sessions` row (`template_id` set) and one `session_exercises` row per exercise. The session starts with no sets. The template is only read.

**Guards.** One in-progress session is allowed by a unique index, so a second start is a `conflict` and its rows roll back. The detail screen also reads `getActive()` on focus and shows "Resume" instead of "Start" when a workout is running; the workout list shows a banner. A synchronous lock (cleared when the screen loses focus) keeps two taps in one frame from reaching the database twice. A failed start is reported as not started and nothing navigates; if the session was saved but navigation throws, the screen says the session exists and offers Resume. A workout with no exercises, or one deleted after the screen loaded, cannot be started.

**Plan snapshot (migration 008).** A session keeps the targets it started with. Migration 008 is additive (`ALTER TABLE session_exercises ADD COLUMN`, no table rebuild, no rows copied or dropped): nullable `plan_sets`, `plan_reps_min`, `plan_reps_max`, `plan_duration_sec`, `plan_rest_sec` (same ranges as a template row), `exercise_name` (a custom exercise's name; built-in exercises keep none because they are named by translation) and `plan_captured` (NOT NULL, default 0). A CHECK on `plan_captured` makes a recorded plan complete (sets, rest, and reps or a duration; min <= max) and an unrecorded row entirely NULL, so a partial snapshot cannot be stored. A trigger (`FITNESS_SESSION_PLAN_IMMUTABLE`, mapped to `immutable/session_plan`) makes plan and name write-once. `sessions.start({ templateId })` reads the template rows (joined to their exercises) and inserts each session row with its plan in the same transaction as the session, so a failure on any row rolls back the whole start.

**Sessions from before the snapshot.** Existing rows keep NULLs and `plan_captured = 0`: nothing is back-filled, because the template may have been edited or deleted and the original targets cannot be reconstructed. They read back with `plan: null` and the session screen says no planned targets were recorded; it never substitutes the template's current values. The same applies to a session started without a template and to an exercise added by hand (`addExercise`). For old sessions a custom exercise's name is its current name (it was never recorded). Built-in exercises are named from the current language's translation.

**What the session screen shows.** The persisted session read back from the database (name, status, local start date, exercises in order, recorded targets). The screen no longer reads the template, so renaming, editing or deleting it cannot change what an old session shows.

**Not in 4.1:** logging sets, a rest timer, finishing or discarding (added in 4.2, section 5h).

**Tested:** repository behaviour (order, association, conflict rollback, concurrent starts, template deleted or edited later), the pure helpers, and the screens against Node SQLite in English and Arabic. **Not verified on a device:** native SQLite, navigation animation and back-stack behaviour, screen-reader output, RTL layout.

## 5h. Phase 4 - milestone 4.2: running a workout (log sets, rest timer, finish, discard)

**No migration.** Everything uses existing repository methods: `addSet`, `deleteSet`, `complete`, `discard`, `get`, `getActive`. The session screen (`/session/[id]`) is now the execution screen.

**Logging.** Each exercise card has the inputs its `tracking_type` needs (`domain/setEntry.ts`): weight (kg) and reps; reps; seconds; or distance (km) and minutes (stored as metres and seconds). All required fields must be typed: nothing is guessed, a weight of 0 must be typed, reps are 1-1000, text is read by `parseNumber` (rejects NaN, Infinity, exponents, ambiguous separators, negatives). Pressing "Log set" calls `addSet` with `isCompleted: true`; the session is then read back, so the list always shows saved rows. The next set's inputs start from the last saved set of that exercise but are never logged unless the person presses the button. Typed-but-unsaved values are local state and are lost on leaving the screen; saved sets are not. A set can be removed after an inline confirmation (`deleteSet` renumbers).

**One write at a time.** A synchronous lock in the screen ignores a second write while one is running (rapid taps), and the buttons are disabled meanwhile. If a write succeeds but the read-back fails, the screen keeps what it shows and says the change was saved but could not be refreshed. If a write is refused because the workout ended elsewhere (`invalid_transition` / `immutable`), the screen says so and reloads.

**Rest timer.** `domain/restTimer.ts` stores when rest ends, not a counter, so a late tick or a spell in the background does not make it drift; `hooks/useRestTimer.ts` re-renders about four times a second while running. The duration is the rest recorded in the session's plan snapshot (no button when no plan was recorded or the rest is 0). Start, Skip (ends a running timer) and Stop (also dismisses the "rest is over" state) are explicit; the end is announced once. The timer is NOT persisted and never writes anything: leaving the screen drops it, and completed data comes only from saved sets.

**Finish.** Needs at least one completed set (the database enforces it too). After a confirmation, `complete` sets `status = completed` and `ended_at` (not before the start or the last set). The screen then shows a summary computed by `summarizeSession` from the saved sets: sets, exercises with sets, total reps, weight x reps volume, and elapsed minutes. It is read-only afterwards.

**Completed workouts are immutable (migration 009).** Once a session is `completed`, the database rejects every INSERT, UPDATE and DELETE of its `session_exercises` and `session_sets` rows (`FITNESS_SESSION_COMPLETED`, mapped to `immutable / completed_session`). Both the old and the new parent are checked on UPDATE, so a row cannot be moved into or out of a completed session, and re-keying is refused. This is enforced for every caller, not only this screen, so a stale screen, a repeated tap or a concurrent write cannot change a finished workout; before 009 such writes were accepted and stamped with a made-up time clamped to the end. Discarded sessions keep their own protection (`discarded_session`); in-progress sessions are unaffected. Still allowed on a completed session: its own `name`, `rpe` and `ended_at` via `updateDetails` (the end can't precede a set or the start). Deleting a whole session (explicit history removal, which cascades; SQLite's foreign-key cascade does not fire child triggers) is unchanged and has no UI path. Migration 009 drops the three "keep >= 1 completed set when a completed session is corrected" triggers from 003, which it makes unreachable; the `complete` transition still needs a completed set. When the screen's write is rejected as `immutable` or `invalid_transition` it says the workout has already ended and reloads from the database, so it never shows a change the database refused.

**Discard (decision).** Discard keeps history: `discard` sets `status = discarded` and `discarded_at`; sets and exercises stay stored, frozen by triggers, and are never counted as a workout (`countCompleted` and statistics only use `completed`). It frees the single in-progress slot, so a stale or abandoned session can never block starting another workout. The confirmation says how many logged sets are kept. A discarded session opens read-only with a note. Nothing is deleted, so no history can be lost by this choice.

**Tested (Node, mocks):** the pure helpers, the triggers (insert/update/delete/move on completed, discarded and in-progress sessions, and a v8 -> v9 upgrade of a database holding completed history), and the screen against Node SQLite in English and Arabic: set entry and persistence, resume, invalid values, timed and distance exercises, duplicate taps, write/read failures, set removal, rest timer (with a controlled clock), finish with confirmation and summary, discard with confirmation and a following new start, writes from a stale screen after the workout ended elsewhere, and a session without a recorded plan. **Not verified on a device:** native SQLite, keyboard behaviour with several inputs, real timing of the timer when the app is backgrounded, screen-reader output, RTL layout.

## 5i. Phase 4 - milestone 4.3: workout history

**What it is.** "Workout history" on the Workouts tab (`/history`) lists the person's real finished workouts, newest first, 20 per page with "Show more". No migration and no new repository method: `hooks/useWorkoutHistory.ts` calls `sessions.list({ status: 'completed', limit, offset })` and never an unfiltered list, so discarded and in-progress sessions cannot appear (the unfiltered `list()` returns every status; see `SessionListFilter`). The first page is re-read each time the screen is focused; later pages are appended without repeating a row, and a failed "show more" keeps the rows already shown.

**Details.** A row shows the workout's name, local date (`YYYY-MM-DD`) and length (`ended_at - started_at`, in minutes). Opening a row goes to the existing `/session/[id]` screen, which already renders a completed session read-only: its saved sets per exercise under the targets recorded at the start, and the summary counted from the saved sets. Its header now shows the workout's name for finished sessions instead of "Workout in progress". Empty, loading, unavailable and read-failed states are separate; a failed read is never shown as an empty history.

**Not included:** statistics, charts, personal records, filtering or searching the history, deleting a workout. **Tested (Node, mocks):** the history screen against Node SQLite (empty, ordering, exclusion of discarded and running sessions, pagination, failed pages, failures, Arabic). **Not verified on a device:** native SQLite, screen-reader output, RTL layout.

## 5j. Phase 4 - milestone 4.4: statistics from saved workouts

**What it is.** The Statistics tab no longer shows sample steps / heart-rate data. It shows three metrics computed from the person's saved, finished workouts: workouts finished, weight lifted (kg) and training time (minutes), per day for this or last week and per part of the month for this month. A "latest workout" card shows the most recent finished workout (sets, weight lifted, time) and opens it; "See all" opens the history. Empty periods show zeros with a note, and a failed read is a failure state, never a screen of zeros.

**Data.** One new read-only repository method, `sessions.dailyActivity(range)`: two small aggregates over `status = 'completed'` sessions (sessions per local day, then sets per local day), merged by day so a day's workouts are never multiplied by their sets. Working sets only: completed and not warm-up. Volume is the sum of `weight_kg x reps` over sets that have both; timed and reps-only sets add sets and reps but no volume. Minutes are `ended_at - started_at`. Discarded and in-progress sessions can't contribute (also tested at the screen level). No migration. `domain/statistics.ts` is pure: weeks start on Saturday (the chart's day labels), a month is split into days 1-7, 8-14, 15-21 and 22-end; `hooks/useStatistics.ts` re-reads on focus and when the period changes.

**Not included / still demo.** Steps, heart rate, calories and "regularity" are gone from this screen because the app has no real source for them. The Home screen's "Today" tiles still use the bundled sample provider in `services/activityService.ts` (labelled demo). No personal records, trends over longer periods, nutrition or body-weight charts. **Tested (Node, mocks):** the period/bucket logic, the aggregate query (completed only, warm-ups excluded, several workouts per day, range, validation, agreement with `countCompleted`) and the screen. **Not verified on a device:** native SQLite, chart rendering, screen-reader output, RTL layout.

## 5k. Phase 4 - milestone 4.5: Home from saved data

**What it is.** Home no longer shows sample steps / calories / distance tiles or the bundled "today's workout". `hooks/useHome.ts` reads, when the screen is focused: `sessions.dailyActivity` for this week so far, the saved goals, the workout in progress, the saved workouts and the exercise library. Three tiles show real numbers: workouts finished this week (with "of N" and a status badge only when a weekly workout goal is saved; no goal means no target and no badge), time trained today, and weight lifted today. The "Your workout" card offers Resume for a workout in progress, otherwise the newest saved workout (opens its detail, where Start lives), otherwise an invitation to create one. Search looks through saved workout names and library exercises (hidden ones excluded, by displayed name, Arabic-aware) and opens `/templates/[id]` or `/exercises/[id]`. No migration and no new repository method (it reuses `dailyActivity` from 5j).

**Honesty rules.** Only completed sessions count; an empty week shows zeros; if any read fails the block shows a failure with a retry (the greeting is independent and unaffected); with the database unavailable (for example on web) it says so. The bundled sample provider (`services/activityService.ts`) and its tests were removed; `types/activity.ts` keeps only `ChartPoint`. The device notice now says Home shows only workouts saved on this device.

**Still demo.** The Workouts tab's demo cards and the demo workout player. **Tested (Node, mocks):** the pure summary, and Home against Node SQLite (empty, totals and goal progress, unfinished and discarded workouts excluded, week boundary, newest workout, resume, search, failure states, Arabic). **Not verified on a device:** native SQLite, layout, screen-reader output, RTL.

## 5l. Phase 4 - milestone 4.6: the Workouts tab runs on saved workouts

**What changed.** The Workouts tab now lists the person's saved workouts (`useTemplates`, newest edit first), a banner to resume a workout in progress, "Create a workout", and links to the exercise library and the history. A workout opens on its detail screen, where the existing flow applies: Start (one session at a time) -> `/session/[id]` (log sets, rest timer, finish or discard) -> history and statistics. The built-in sample workouts and the sample workout player are gone: `data/workouts.ts`, `types/workout.ts`, `WorkoutDetailsScreen` and its route `/workout/[id]`, `WorkoutCard`, `WorkoutArt`, `HeartRateWave`, `services/workoutSession.ts` (the timer reducer), `services/workoutService.ts` and `hooks/useWorkoutSession.ts`. The old `/templates` list route was folded into the Workouts tab; `/templates/[id]` and `/templates/form` remain. Unused strings (the sample workouts' titles, the player's `session.*` block, the Home card chips) were removed from both languages.

**Preserved.** No database or repository change, so history, completed-session immutability (migration 009) and resuming an active session are untouched (their tests still pass). Resuming works from the Workouts tab banner, the Home card and the workout detail screen.

**Behaviour that no longer exists.** The sample player scaled reps by the profile's experience level and flagged exercises that overlap the profile's caution areas. The real flow has no such adjustment: the "experience level" and "caution areas" settings on the Profile screen are still stored but do not affect workouts. Whether to wire them to the exercise library (muscles to caution areas) is a product decision.

**Tested (Node, mocks):** the Workouts tab (no sample content, ordering, deletion, resume banner, links, failure states, Arabic) and, unchanged, the detail, builder, session, history and statistics screens. **Not verified on a device:** native SQLite, tab layout, screen-reader output, RTL.

## 5m. Phase 4 - milestone 4.7: Profile settings as exercise hints

**What it is.** The Profile's "caution areas" and "experience level" now produce small hints on real exercises: in the exercise library (rows and detail), the workout builder (picker and rows), a saved workout's detail and the running session. Nothing is hidden, blocked or removed; the settings are unchanged and stay editable. No migration, no repository change. `domain/recommendations.ts` (pure) and `hooks/useRecommendations.ts` (translated lines) hold the logic.

**What the data supports (and no more).** The library records the MUSCLES an exercise works and its equipment, not which joints it loads. So a caution area is checked only through a muscle that stands in for it: `shoulders` -> the shoulders muscle (covered); `wrists` -> forearms (only partly covered: supporting body weight and impact are not recorded); `knees`, `ankles`, `lower back` and `neck` have no reliable counterpart (calf-muscle data in particular says too little about how the ankle joint is loaded), so NO exercise is ever flagged for them and the person is told so. An exercise is flagged when the mapped muscle is its main or a supporting muscle ("Caution area: Shoulders"). Where an area is chosen but not fully checkable, the library, builder and workout screens show a short "About these hints" card (not checked / only partly checked, plus a disclaimer that this is general, not medical advice and no guarantee of safety); the Profile caution panel lists, before anything is chosen, which areas are checked, partly checked or not checked. The app does not diagnose injuries or claim an exercise is safe.

**Experience level.** Only beginners get hints, and only from equipment, the one thing the library records that relates to technique: bodyweight, machine, band and cardio machine are marked "Easy to start with"; barbell and kettlebell "More technique needed: start light"; dumbbell, cable and "other" get no mark. Intermediate and advanced get none. Starting targets are not changed by level (nothing in the data defends specific numbers), unlike the old sample player.

**Ordering.** Only the workout builder's picker is reordered: exercises touching a caution area go after the others, and for a beginner easy-to-start ones come first; with no relevant setting the order is unchanged. Every exercise stays reachable (the picker now lists up to 100).

**Tested (Node, mocks):** the mapping and its edge cases (including that the unmapped areas flag nothing across the whole library, and a mutation check), the picker order, each screen's hints and limits in English and Arabic, and the Profile coverage text. **Not verified on a device:** layout, screen-reader output, RTL. The Arabic wording is mine and needs a native speaker's review.

## 5n. Phase 4 - milestone 4.8: workout creation and editing UX

**What changed (no data, schema or repository change).** In the workout builder (`TemplateFormScreen`):
- **Choosing exercises.** The picker can be narrowed by muscle and equipment as well as by name (the same `LibraryFilter` the library uses; "Clear filters" also clears the search text), shows how many exercises match, and marks an exercise already in the workout ("Already added: N" - it can still be added again). It lists up to 100 matches.
- **Ordering.** Besides up/down, a workout with more than four exercises gets "Move to top" and "Move to bottom" per row (`moveItemTo`); every move is announced with the new position.
- **Validation.** Nothing is shown on a fresh form. After the first Save attempt the problems are recomputed from the current draft on every change, so each disappears the moment it is fixed (no stale errors). A "Fix these before saving" card lists every problem by name ("Workout name", "Exercises", "Pull-up, Sets") with the reason; fields keep their inline messages and the first failure is still announced.
- **Unsaved changes.** Cancel leaves immediately when nothing changed, or when a change was undone (`isDirty` compares name, notes and the rows' exercises and numbers, ignoring internal row keys); with real unsaved changes it asks "Discard your changes?" (discard / keep editing). A successful save never asks. The header's back button is not intercepted.

Saved workouts, the session flow, history and immutability are untouched; the save path (`planTemplateSave` -> `templates.create/update`) is unchanged.

**Tested (Node, mocks):** the new pure helpers, and the builder: live error clearing (name, exercises, a row's number, duplicate name), cancel behaviour (clean, reverted, dirty, edit mode, after save), picker filters and counts, the already-added mark, move to top/bottom and Arabic. **Not verified on a device:** layout, keyboard behaviour, screen-reader output, RTL.

## 5o. Phase 4 - milestone 4.9: workout overview before starting

**What it is.** A saved workout's detail screen (`/templates/[id]`) is now the overview shown before a session: an "Overview" block (exercises, sets in total, the equipment needed in order of first use, the main muscles most-used first, and the muscles that are only supporting ones), each exercise row with its targets and its main muscle and equipment, and the existing actions: Start (primary; "Resume" instead while a workout is in progress), Edit (back to the builder), Duplicate and Delete. `domain/workoutOverview.ts` computes the block from the template and its exercises; it estimates nothing (no duration, no calories). A row whose exercise cannot be found is counted but adds no equipment or muscles.

**Reuse.** No new route, repository method or migration. Start is the same `sessions.start({ templateId })` flow from 4.1 (one-write lock, conflict handling, plan snapshot), so completed sessions remain immutable (migration 009) and an active session is still resumable. The overview and the Profile hints share the screen: caution and level notes appear under the exercises they apply to.

**Tested (Node, mocks):** the pure overview (ordering, duplicate exercises, unknown rows, empty) and the screen: counts, equipment and muscle lists, per-row details and accessibility label, Start and Edit (with hints; neither changes the saved workout), one real session created with the overview's exercises and sets, a hidden exercise still shown, and Arabic. **Not verified on a device:** layout, screen-reader output, RTL.

## 5p. Phase 4 - milestone 4.10: the active workout session experience

**What changed (no data, schema or repository change; `addSet`, `deleteSet`, `complete`, `discard` and the one-write lock are as before).** While a workout is in progress the session screen now has:
- **Progress.** A card with "Sets: done of planned" and "Exercises done: x of n", and a bar. The planned total exists only when EVERY exercise has a recorded plan; otherwise it says "Sets logged: n" with no total or bar (`domain/sessionProgress.ts`). An exercise counts as done when its logged sets reach its plan; without a plan nothing is ever "done".
- **Navigation.** One numbered chip per exercise (finished ones marked), Previous / Next buttons, and the other exercises as one-line rows with their progress; only the current exercise is shown in full. Moving between exercises never touches logged sets (they are in the database) or the numbers typed but not yet logged (kept per exercise in the screen). The first exercise shown, and after a resume, is the first unfinished one; after logging a set the screen stays on that exercise even when its plan is complete ("All planned sets are logged. Add more sets or move on."). A finished or discarded workout still shows every exercise in full with no navigation.
- **Rest timer.** The panel says whom the rest is for ("Resting: ..."), shows the time and a progress bar, and offers "+15 s" (`extendRest`: only a running timer, never beyond 15 minutes left), Skip rest and Stop timer; an ended rest says so and can be dismissed but not extended. It keeps running while another exercise is shown, is stopped by finish or discard, is never saved, and never writes anything.
- **Leaving.** Logged sets are saved the moment they are logged, so leaving never loses them and the workout stays in progress. What leaving CAN lose is numbers typed but not logged: if there are any (compared with what the form would show anyway), the screen's back button and the Android hardware back button ask "Leave this workout?" first (Stay / Leave). Not intercepted: the iOS swipe-back gesture and system-level exits, a rest timer running when you leave (it is only a guide), and an unsaved form on other screens.

Finish and discard (with confirmations), resume from the Home / Workouts / detail screens and the immutability of completed sessions (migration 009) are unchanged.

**Tested (Node, mocks):** the pure progress and timer helpers, and the screen: progress against the plan and without one, only the current exercise in full, switching keeps logged and typed values, Previous / Next limits, resume on the first unfinished exercise, the finished view, timer labels / extension / persistence across exercises / stop on finish, and leaving (header back and Android back, Stay / Leave, nothing to lose after clearing or logging). **Not verified on a device:** layout, the real Android hardware back button, iOS swipe-back, keyboard behaviour, timing while the app is in the background, screen-reader output, RTL.

## 6. Open product decisions and future work (documented, not changed)

- **E6 warm-up-only workouts.** A completed session needs one completed set, and a completed warm-up counts. So a
  workout of only warm-up sets can be completed and counted as a workout in `countCompleted`/`completedDates`.
  *Recommendation:* require one completed non-warm-up set. Not implemented, because it changes workout statistics.
- **E8 listing discarded sessions.** `sessions.list()` currently includes discarded sessions (they are kept as history);
  statistics already exclude them. *Recommendation:* default `list()` to completed + in progress, with an explicit
  `includeDiscarded` option. Not implemented: it changes what a future history screen shows.
- **E9/E10** are implemented (see above) because they only reject values the schema already treats as invalid.
- **F6 future rebuild migrations (runner support is future work).** The migration runner executes all pending
  migrations inside one transaction with foreign keys ENABLED, and `Database.transaction` re-checks that they are on.
  `PRAGMA foreign_keys=OFF` inside that transaction has no effect (SQLite ignores it there; verified: the setting still
  reads back `1`). The standard 12-step table-rebuild procedure needs foreign keys off OUTSIDE a transaction, so it
  cannot be executed as written under the current runner, and this document does not present it as usable.
  Consequences for a migration that rebuilds a table that other tables reference (create new, copy, drop old, rename):
  - `ON DELETE CASCADE` children are deleted when the old parent is dropped. The row-loss guard detects this (row counts
    drop) and rolls the upgrade back.
  - `ON DELETE SET NULL` children keep their rows but their foreign-key column becomes NULL. The guard does NOT detect
    this (row counts are unchanged) and neither does `foreign_key_check`. Verified with a probe: the upgrade succeeded
    and `workout_sessions.template_id` changed from `1` to `NULL`.
  - Value-changing statements (`UPDATE`) with unchanged row counts are also not detected, and a table rename of a
    populated table is reported as row loss.
  Future work before any such migration ships: runner support for rebuild migrations (for example disabling foreign keys
  outside the transaction and running `foreign_key_check` afterwards), a per-table `allowRowLoss`, a check of non-NULL
  counts on foreign-key columns, and a data-preserving test for that migration. Until then, avoid rebuilding a
  referenced table.
- **E15** A transaction callback that never settles holds the lock until the queue timeout reports `busy`; the
  transaction itself is not cancelled. Cross-process concurrent access (app extensions) is not handled.
- **Zod bundle size (spike, nothing changed).** Two different kinds of measurement exist and must not be mixed:
  - *Isolated esbuild measurements* (minified, ESM, outside the app): a representative schema bundles to about 454 KB
    (93 KB gzip) with classic `zod` and about 22 KB (7 KB gzip) with `zod/mini`; the real `src/domain/schemas` bundled
    with esbuild and classic `zod` is about 460 KB. These are estimates of the library's cost, not of the app bundle.
  - *Metro app-export measurement* (`expo export -p ios --no-bytecode -s external`, unminified): attributing the
    source map's source files by package gives about 826 KB of `zod` SOURCE out of about 3.0 MB of JavaScript. That
    figure is unminified source size attributed through a source map; it is NOT a minified or compiled bundle-size
    figure and is not comparable with the esbuild numbers. The iOS Hermes bytecode bundle of the final tree is about
    4.3 MB (`expo export`, default settings); no Phase 0 baseline was measured.
  - *Not established:* the real in-app size reduction from `zod/mini` has not been measured, and compatibility has not
    been established. `zod/mini` is a functional API (`z.string().check(z.minLength(1))`, `z.safeParse(schema, v)`), so
    every schema, `.refine`, `.partial`, `.default` and the `parseInput` helper would change. Recommended only as a
    separate, reviewed change that measures the app export before and after and runs the full test suite; not done here.

## 5q. Phase 4 - milestone 4.11: resilient active sessions

What survives an app restart, and what does not, is decided by where the state lives.

**Persisted (SQLite, written the moment it happens, each write in one transaction):** the session and its status, the plan snapshot, every logged set with its `completed_at`, set numbering. After the app is closed or killed `sessions.getActive()` returns the same workout and the Home / Workouts banners resume it. Progress ("Sets: x of y"), the exercise strip and the exercise shown in full are all *derived* from the saved sets (`firstOpenIndex`), so the place in the workout comes back without storing anything extra. A write that fails or is interrupted rolls back; a half-written set never appears. Completed sessions stay immutable and discarded ones stay frozen after any number of restarts. Covered by `__tests__/db/sessionRecovery.test.ts` (a real SQLite file closed and reopened).

**Not persisted, on purpose:**
- *The rest timer.* It is in-memory and starts from a button press. The database has no record that a rest was started, stopped, skipped or extended, so a rest end time cannot be reconstructed truthfully (the last set's `completed_at` plus the planned rest would be a guess: the rest may have been skipped or extended). Nothing is invented. Instead the reopened screen says so.
- *Typed-but-not-logged numbers.* They are local drafts. The form is prefilled from the last saved set again.

**Reopen note (`domain/sessionRecovery.ts`):** an in-progress session with logged sets shows a "Welcome back" note on opening, with "Last set logged: N min ago" taken from the newest saved `completed_at`, and the sentence that the rest timer does not carry over. If the device clock reads earlier than the saved time (a clock change) the duration line is left out rather than guessed. The note is read once per opening, so it does not turn into "just now" after a new set; it goes away on "Got it", on logging a set, or when a rest timer is running. The note also appears when the person leaves this screen and comes back in the same run, which is accurate: the timer is held by the screen.

**Device-only, not verified here:** a real process kill on iOS/Android, background / foreground timing, the Expo SQLite native driver's durability under a kill, screen-reader output, layout and RTL. Arabic wording needs a native review.

## 5r. Phase 4 - milestone 4.12: "last time" while logging

Audit of the active session: set entry started from your own last set within the workout, but the FIRST set of every exercise started empty, so the person had to remember (or look up in history) what they lifted last time.

`sessions.lastPerformance(exerciseIds)` returns, per exercise, the completed sets from the most recent COMPLETED workout that logged any of that exercise (in-progress and discarded workouts never count; a newer workout that included the exercise but logged nothing for it is skipped; exercises never done are absent). It reads existing tables only - no migration, no stored copy, nothing seeded.

The card shows "Last time (date): 85 kg x 5 . 85 kg x 4" (at most five sets, the rest counted) while the workout is in progress. "Use last values" fills the entry fields from last time's last working set (a warm-up only when there was nothing else). It never logs: the numbers are ordinary typed-but-unlogged input, so the leave-guard protects them and the person still taps Log set. The button appears only while nothing is logged for that exercise in this workout and nothing is typed, so it cannot overwrite anything. The reference is an aid: if it cannot be read, the screen works without it. Finished workouts do not show it.

Not done on purpose: no automatic prefill (a silent prefill could be logged unchecked), no progression suggestions or personal-record claims (that would need a defined, tested rule).

## 5s. Phase 4 - milestone 4.13: post-workout summary and completion flow

Audit: finishing already ended the workout in place and showed totals (sets, exercises, reps, volume, time) from the saved sets, with the full exercise cards below. Missing: how the workout compared with its own plan, what was skipped, a quick per-exercise read, any way to record how hard it was (the model has `rpe` and `updateDetails` already allows it on completed workouts), and a clear way onward.

`WorkoutSummary` (shown for completed workouts only, so also when one is opened from history) adds, all from saved data:
- planned sets done ("Sets: 2 of 6") - only when EVERY exercise has a plan snapshot, as for the progress bar;
- "Not done: ..." naming exercises with no logged set (a partly done workout; a workout with no sets cannot be completed at all);
- Highlights: per exercise its best set OF THIS WORKOUT (`domain/workoutResults.ts`: heaviest for weight x reps, most reps, longest, farthest; the earliest set wins an exact tie; warm-ups and unfinished sets never count) and its sets count;
- an optional effort rating 1-10 (tap the same number again to clear), saved with `sessions.updateDetails`; a failure is said out loud and nothing changes;
- "Back to Home" (`router.replace('/')`) and "Workout history".

Deliberately not there: personal records or any comparison with history (the data model has no defined rule for them), calories (`est_kcal` has no estimator yet, so it stays null and is not shown), muscle-group splits. Sets stay immutable after completion; only the workout's own effort rating changes.
