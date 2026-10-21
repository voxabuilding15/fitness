import type { CautionArea } from '../types/settings';
import type { Exercise, ExerciseId, Workout } from '../types/workout';

const ex = (
  id: ExerciseId,
  sets: number,
  amount: { reps?: number; seconds?: number },
  restSec: number,
  areas: CautionArea[] = [],
): Exercise => ({ id, sets, restSec, areas, ...amount });

export const WORKOUTS: Workout[] = [
  {
    id: 'upperBody',
    estimatedCalories: 350,
    estimatedMinutes: 45,
    exercises: [
      ex('pushUp', 3, { reps: 12 }, 45, ['wrists', 'shoulders']),
      ex('inclinePushUp', 3, { reps: 12 }, 45, ['wrists']),
      ex('diamondPushUp', 3, { reps: 8 }, 60, ['wrists', 'shoulders']),
      ex('pikePushUp', 3, { reps: 8 }, 60, ['shoulders', 'neck']),
      ex('tricepDip', 3, { reps: 10 }, 45, ['shoulders', 'wrists']),
      ex('dumbbellPress', 3, { reps: 10 }, 60, ['shoulders']),
      ex('chestFly', 3, { reps: 12 }, 45, ['shoulders']),
      ex('dumbbellRow', 3, { reps: 12 }, 45, ['lowerBack']),
      ex('reverseFly', 3, { reps: 12 }, 45, ['shoulders']),
      ex('lateralRaise', 3, { reps: 12 }, 30, ['shoulders']),
      ex('shoulderPress', 3, { reps: 10 }, 60, ['shoulders', 'neck']),
      ex('facePull', 3, { reps: 15 }, 30, ['shoulders']),
      ex('bicepCurl', 3, { reps: 12 }, 30, ['wrists']),
      ex('hammerCurl', 3, { reps: 12 }, 30, ['wrists']),
      ex('tricepExtension', 3, { reps: 12 }, 30, ['shoulders']),
      ex('plankShoulderTap', 3, { seconds: 30 }, 30, ['wrists', 'shoulders']),
    ],
  },
  {
    id: 'lowerBody',
    estimatedCalories: 320,
    estimatedMinutes: 40,
    exercises: [
      ex('squat', 4, { reps: 15 }, 60, ['knees']),
      ex('lunge', 3, { reps: 12 }, 45, ['knees']),
      ex('gluteBridge', 3, { reps: 15 }, 45, ['lowerBack']),
      ex('calfRaise', 3, { reps: 20 }, 30, ['ankles']),
      ex('sumoSquat', 3, { reps: 15 }, 45, ['knees']),
      ex('stepUp', 3, { reps: 12 }, 45, ['knees', 'ankles']),
      ex('wallSit', 3, { seconds: 40 }, 45, ['knees']),
      ex('deadlift', 3, { reps: 10 }, 60, ['lowerBack']),
    ],
  },
  {
    id: 'core',
    estimatedCalories: 220,
    estimatedMinutes: 25,
    exercises: [
      ex('plank', 3, { seconds: 40 }, 30, ['wrists', 'shoulders']),
      ex('crunch', 3, { reps: 20 }, 30, ['neck']),
      ex('russianTwist', 3, { reps: 20 }, 30, ['lowerBack']),
      ex('legRaise', 3, { reps: 12 }, 30, ['lowerBack']),
      ex('bicycleCrunch', 3, { reps: 20 }, 30, ['neck']),
      ex('mountainClimber', 3, { seconds: 30 }, 30, ['wrists']),
      ex('deadBug', 3, { reps: 12 }, 30),
      ex('sidePlank', 2, { seconds: 30 }, 30, ['shoulders', 'wrists']),
    ],
  },
];

export const TODAYS_WORKOUT_ID = 'upperBody' as const;

export const getWorkout = (id: string) => WORKOUTS.find((w) => w.id === id);
