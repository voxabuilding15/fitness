# Architecture

This document separates **what exists today** from **where the app is going**. Nothing in the
"Intended" section is implemented yet unless a later phase says so.

---

## 1. Current architecture (as of Phase 0)

Expo SDK 57, React Native 0.86, TypeScript (strict), Expo Router. Everything is local; there is no
backend, account system or network API.

```
src/
  app/          Expo Router routes: (tabs)/{index,workouts,statistics,profile}, workout/[id], reminders
                (each route re-exports a screen)
  screens/      Home, Workouts, Statistics, Profile, WorkoutDetails, ReminderSettings
  components/   Shared UI (AppText, Screen, BottomNavigation, WorkoutCard, StatCard, charts, ...)
  context/      AppContext: profile + settings state, language/RTL, persistence calls
  hooks/        useFormat, useIsNarrow, useWorkoutSession
  services/     activityService (sample data), profileService, settingsService, workoutService,
                workoutSession (pure reducer), reminderService, soundService, storage (AsyncStorage)
  data/         workouts.ts  (3 hard-coded workouts, 32 exercises)
  i18n/, locales/   i18next; en.json and ar.json
  types/        activity, profile, settings, workout
  __tests__/    logic.test.ts (17 tests)
```

**Data layer (Phase 1, not yet used by any screen):** an offline SQLite foundation built but not wired into the UI.

```
src/domain/        Pure TypeScript. Result/AppError, Clock, dates, session lifecycle rules, Zod input schemas,
                   entity models and the repository interfaces (domain/repositories.ts).
src/db/            sqlDatabase.ts (SqlDriver interface) · database.ts (single connection, FIFO lock, transactions,
                   foreign-key assertion) · mapDbError.ts · migrations/ (001-006 + runner) · backup.ts / expoBackup.ts ·
                   repositories/ (9 implementations) · seedRunner.ts (mechanism only, no content) · legacyImport.ts
                   (implemented + tested, NOT executed) · initDatabase.ts · expoSqliteDriver.ts · appDatabase(.web).ts
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
  discarded sessions are frozen and never counted; completed sessions can be corrected but keep >= 1 completed set and
  consistent timestamps.
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

**Persistence the app uses today:** AsyncStorage with two JSON blobs (`fitness.profile.v1`, `fitness.settings.v1`).
No migrations, no history. Read failures silently fall back to defaults. These keys are untouched by Phase 1.

**RTL/LTR:** direction is applied with a `direction` style on the root view (not `I18nManager`);
directional icons are swapped by `Icon`, absolute end-offsets use `endInset`. Verified in the web
renderer only; not yet verified on a physical device.

**What is real vs sample today:**
- Real: language, profile, settings, reminders, workout-session timer logic.
- Sample / hard-coded (clearly labelled "Demo data" in the UI): Today's stats, all Statistics charts,
  heart-rate / calories / duration cards, per-workout calorie and minute figures, "Regularity".

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
