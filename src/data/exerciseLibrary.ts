import type { SeedPack } from '../db/seedRunner';
import type { Equipment, ExerciseCategory, Muscle, TrackingType } from '../domain/schemas/enums';

/**
 * The built-in exercise library: original content (names are written for this app in English and Arabic in
 * `locales/*.json` under `exercises.<id>`; no images, no copied descriptions, no MET values).
 * `id` is the translation key; the stored slug is its snake_case form (see domain/exerciseLibrary.ts).
 * Only structural facts live here: category, muscles, equipment and how the exercise is logged.
 */
export interface LibraryEntry {
  id: string;
  category: ExerciseCategory;
  primaryMuscle: Muscle;
  secondaryMuscles: Muscle[];
  equipment: Equipment;
  trackingType: TrackingType;
}

const s = (id: string, primaryMuscle: Muscle, secondaryMuscles: Muscle[], equipment: Equipment, trackingType: TrackingType): LibraryEntry =>
  ({ id, category: 'strength', primaryMuscle, secondaryMuscles, equipment, trackingType });
const c = (id: string, primaryMuscle: Muscle, secondaryMuscles: Muscle[], equipment: Equipment, trackingType: TrackingType): LibraryEntry =>
  ({ id, category: 'cardio', primaryMuscle, secondaryMuscles, equipment, trackingType });
const m = (id: string, primaryMuscle: Muscle, secondaryMuscles: Muscle[]): LibraryEntry =>
  ({ id, category: 'mobility', primaryMuscle, secondaryMuscles, equipment: 'bodyweight', trackingType: 'duration' });

export const EXERCISE_LIBRARY: readonly LibraryEntry[] = [
  // chest
  s('pushUp', 'chest', ['triceps', 'shoulders'], 'bodyweight', 'reps_only'),
  s('inclinePushUp', 'chest', ['triceps', 'shoulders'], 'bodyweight', 'reps_only'),
  s('benchPress', 'chest', ['triceps', 'shoulders'], 'barbell', 'weight_reps'),
  s('dumbbellPress', 'chest', ['triceps', 'shoulders'], 'dumbbell', 'weight_reps'),
  s('inclineDumbbellPress', 'chest', ['shoulders', 'triceps'], 'dumbbell', 'weight_reps'),
  s('chestFly', 'chest', ['shoulders'], 'dumbbell', 'weight_reps'),
  s('cableCrossover', 'chest', ['shoulders'], 'cable', 'weight_reps'),
  // back
  s('pullUp', 'back', ['biceps', 'forearms'], 'bodyweight', 'reps_only'),
  s('latPulldown', 'back', ['biceps'], 'cable', 'weight_reps'),
  s('seatedCableRow', 'back', ['biceps'], 'cable', 'weight_reps'),
  s('dumbbellRow', 'back', ['biceps', 'forearms'], 'dumbbell', 'weight_reps'),
  s('barbellRow', 'back', ['biceps', 'forearms'], 'barbell', 'weight_reps'),
  // shoulders
  s('shoulderPress', 'shoulders', ['triceps'], 'dumbbell', 'weight_reps'),
  s('overheadPress', 'shoulders', ['triceps'], 'barbell', 'weight_reps'),
  s('lateralRaise', 'shoulders', [], 'dumbbell', 'weight_reps'),
  s('frontRaise', 'shoulders', [], 'dumbbell', 'weight_reps'),
  s('reverseFly', 'shoulders', ['back'], 'dumbbell', 'weight_reps'),
  s('facePull', 'shoulders', ['back'], 'band', 'reps_only'),
  s('pikePushUp', 'shoulders', ['triceps'], 'bodyweight', 'reps_only'),
  // arms
  s('bicepCurl', 'biceps', ['forearms'], 'dumbbell', 'weight_reps'),
  s('hammerCurl', 'biceps', ['forearms'], 'dumbbell', 'weight_reps'),
  s('barbellCurl', 'biceps', ['forearms'], 'barbell', 'weight_reps'),
  s('tricepExtension', 'triceps', [], 'dumbbell', 'weight_reps'),
  s('tricepPushdown', 'triceps', [], 'cable', 'weight_reps'),
  s('skullCrusher', 'triceps', [], 'barbell', 'weight_reps'),
  s('diamondPushUp', 'triceps', ['chest', 'shoulders'], 'bodyweight', 'reps_only'),
  s('tricepDip', 'triceps', ['chest', 'shoulders'], 'bodyweight', 'reps_only'),
  s('wristCurl', 'forearms', [], 'dumbbell', 'weight_reps'),
  // legs
  s('squat', 'quads', ['glutes', 'hamstrings', 'core'], 'bodyweight', 'reps_only'),
  s('sumoSquat', 'quads', ['glutes', 'hamstrings'], 'bodyweight', 'reps_only'),
  s('backSquat', 'quads', ['glutes', 'hamstrings', 'core'], 'barbell', 'weight_reps'),
  s('gobletSquat', 'quads', ['glutes', 'core'], 'kettlebell', 'weight_reps'),
  s('legPress', 'quads', ['glutes', 'hamstrings'], 'machine', 'weight_reps'),
  s('legExtension', 'quads', [], 'machine', 'weight_reps'),
  s('lunge', 'quads', ['glutes', 'hamstrings'], 'bodyweight', 'reps_only'),
  s('stepUp', 'quads', ['glutes', 'calves'], 'bodyweight', 'reps_only'),
  s('wallSit', 'quads', ['glutes', 'calves'], 'bodyweight', 'duration'),
  s('deadlift', 'hamstrings', ['glutes', 'back', 'forearms'], 'barbell', 'weight_reps'),
  s('romanianDeadlift', 'hamstrings', ['glutes', 'back'], 'barbell', 'weight_reps'),
  s('legCurl', 'hamstrings', [], 'machine', 'weight_reps'),
  s('gluteBridge', 'glutes', ['hamstrings', 'core'], 'bodyweight', 'reps_only'),
  s('hipThrust', 'glutes', ['hamstrings'], 'barbell', 'weight_reps'),
  s('kettlebellSwing', 'glutes', ['hamstrings', 'back'], 'kettlebell', 'weight_reps'),
  s('calfRaise', 'calves', [], 'bodyweight', 'reps_only'),
  // core
  s('plank', 'core', ['shoulders'], 'bodyweight', 'duration'),
  s('sidePlank', 'core', ['shoulders'], 'bodyweight', 'duration'),
  s('plankShoulderTap', 'core', ['shoulders'], 'bodyweight', 'duration'),
  s('crunch', 'core', [], 'bodyweight', 'reps_only'),
  s('bicycleCrunch', 'core', [], 'bodyweight', 'reps_only'),
  s('russianTwist', 'core', [], 'bodyweight', 'reps_only'),
  s('legRaise', 'core', ['quads'], 'bodyweight', 'reps_only'),
  s('hangingLegRaise', 'core', ['forearms'], 'bodyweight', 'reps_only'),
  s('deadBug', 'core', [], 'bodyweight', 'reps_only'),
  // cardio
  c('walking', 'cardio', ['quads', 'glutes'], 'bodyweight', 'distance_duration'),
  c('running', 'cardio', ['quads', 'hamstrings', 'calves'], 'bodyweight', 'distance_duration'),
  c('treadmillRun', 'cardio', ['quads', 'hamstrings', 'calves'], 'cardio_machine', 'distance_duration'),
  c('cycling', 'cardio', ['quads', 'glutes'], 'other', 'distance_duration'),
  c('rowingMachine', 'cardio', ['back', 'quads'], 'cardio_machine', 'distance_duration'),
  c('swimming', 'cardio', ['shoulders', 'back'], 'other', 'distance_duration'),
  c('jumpRope', 'cardio', ['calves'], 'other', 'duration'),
  c('jumpingJacks', 'cardio', ['calves', 'shoulders'], 'bodyweight', 'duration'),
  c('burpee', 'full_body', ['chest', 'quads'], 'bodyweight', 'reps_only'),
  c('mountainClimber', 'core', ['shoulders', 'quads'], 'bodyweight', 'duration'),
  // mobility
  m('catCow', 'back', ['core']),
  m('childsPose', 'back', ['glutes']),
  m('hamstringStretch', 'hamstrings', []),
  m('hipFlexorStretch', 'quads', ['glutes']),
  m('chestStretch', 'chest', ['shoulders']),
];

/** Version of the built-in exercise content. Raise it whenever the list or an entry's facts change (see seedRunner). */
export const EXERCISE_LIBRARY_VERSION = 1;

const snake = (id: string) => id.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);

/** The seed-pack form of the library (names are never stored; see `exerciseNameKey` in domain/exerciseLibrary.ts). */
export const SEED_PACK: SeedPack = {
  version: EXERCISE_LIBRARY_VERSION,
  exercises: EXERCISE_LIBRARY.map((e) => ({
    slug: snake(e.id), category: e.category, primaryMuscle: e.primaryMuscle, secondaryMuscles: [...e.secondaryMuscles],
    equipment: e.equipment, trackingType: e.trackingType,
  })),
};
