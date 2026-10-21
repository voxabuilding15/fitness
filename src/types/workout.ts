import type { CautionArea } from './settings';

export type ExerciseId =
  | 'pushUp' | 'inclinePushUp' | 'diamondPushUp' | 'pikePushUp' | 'tricepDip'
  | 'dumbbellPress' | 'chestFly' | 'dumbbellRow' | 'reverseFly' | 'lateralRaise'
  | 'shoulderPress' | 'facePull' | 'bicepCurl' | 'hammerCurl' | 'tricepExtension'
  | 'plankShoulderTap' | 'squat' | 'lunge' | 'gluteBridge' | 'calfRaise'
  | 'sumoSquat' | 'stepUp' | 'wallSit' | 'deadlift' | 'plank' | 'crunch'
  | 'russianTwist' | 'legRaise' | 'bicycleCrunch' | 'mountainClimber' | 'deadBug'
  | 'sidePlank';

export interface Exercise {
  id: ExerciseId;
  sets: number;
  /** rep-based exercise */
  reps?: number;
  /** hold/timed exercise (seconds per set) */
  seconds?: number;
  restSec: number;
  areas: CautionArea[];
}

export type WorkoutId = 'upperBody' | 'lowerBody' | 'core';

export interface Workout {
  id: WorkoutId;
  exercises: Exercise[];
  estimatedCalories: number;
  estimatedMinutes: number;
}
