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

**Persistence today:** AsyncStorage with two JSON blobs (`fitness.profile.v1`, `fitness.settings.v1`).
No migrations, no history. Read failures silently fall back to defaults.

**RTL/LTR:** direction is applied with a `direction` style on the root view (not `I18nManager`);
directional icons are swapped by `Icon`, absolute end-offsets use `endInset`. Verified in the web
renderer only; not yet verified on a physical device.

**What is real vs sample today:**
- Real: language, profile, settings, reminders, workout-session timer logic.
- Sample / hard-coded (clearly labelled "Demo data" in the UI): Today's stats, all Statistics charts,
  heart-rate / calories / duration cards, per-workout calorie and minute figures, "Regularity".

**Tests today:** 17 Jest tests of services and locales. Screens, components, hooks and context have
**no** automated tests (0% coverage). Coverage numbers are informational only.

---

## 2. Intended architecture (planned, NOT implemented)

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

- `npm run check` = typecheck + lint + tests. `npm run test:ci` adds coverage. `npm run export:ios`
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
