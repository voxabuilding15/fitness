# Fitness — health snapshot app

React Native (Expo SDK 58, TypeScript, Expo Router) app reproducing a three-screen fitness UI:
**Home**, **Statistics** and **Profile / settings**, plus Workouts, Workout details and Reminders.
English (LTR) and Arabic (RTL) are fully supported.

## Run

```bash
npm install
npx expo start            # then press a (Android), i (iOS simulator) or w (web), or scan with Expo Go
```

## Checks

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # expo lint
npm test            # jest (logic, locales, validation, persistence)
```

## Structure

```
src/app/          Expo Router routes ((tabs) = Home, Workouts, Statistics, Profile; workout/[id]; reminders)
src/screens/      Screen implementations
src/components/   AppHeader, BottomNavigation, StatCard, WorkoutCard, MetricSelector,
                  WeeklyActivityChart, HeartRateWave, SettingRow, ProfileSummaryCard, …
src/services/     activityService (demo data + provider seam), profileService, settingsService,
                  workoutSession (pure reducer), reminderService, soundService, storage
src/locales/      en.json, ar.json
src/types/        activity, profile, settings, workout
```

## Language & RTL

Profile → Preferences → Language switches English / العربية instantly. The choice is persisted
(AsyncStorage) and restored on launch. Direction is applied on the root view (`direction: rtl|ltr`),
so no app restart is needed; directional icons are mirrored and fonts switch Poppins ↔ Cairo.
Numbers stay in Latin digits in both languages.

## Data integrity

All activity values (steps, calories, heart rate, durations) are **bundled demo data** and are labelled
as such in the UI. Nothing is read from a sensor or health API. `ActivityProvider` in
`src/services/activityService.ts` is the seam for a future HealthKit / Health Connect source.
"Regularity" = share of the daily step goal (8,000) reached each day. Caution areas only flag exercises
and are not medical advice.

## Known limitations

- Scheduled reminders use `expo-notifications` on Android/iOS only (web saves the choice and says so).
- The workout artwork and avatar are vector/initial placeholders (no photos bundled).
- Native RTL behaviour (including horizontal scrolling of the stat-card row) was verified in the web
  renderer only; it has not been run on a device or simulator.
