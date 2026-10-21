import type {
  ActivityLevel, Equipment, ExerciseCategory, FoodUnit, GoalSource, GoalType, HabitKind, MealType, Muscle, Sex, TrackingType,
} from '../schemas/enums';
import type { SessionStatus } from '../sessionLifecycle';

/** Entities as the app sees them (camelCase, booleans as booleans). `null` means "not provided". */
export interface Profile {
  displayName: string;
  location: string | null;
  sex: Sex | null;
  ageYears: number | null;
  /** The local date on which `ageYears` was entered (so the age can be refreshed later, never invented). */
  ageSetOn: string | null;
  heightCm: number | null;
  activityLevel: ActivityLevel | null;
  updatedAt: number;
}

export interface Goals {
  goalType: GoalType;
  targetWeightKg: number | null;
  kcalTarget: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  waterMlTarget: number;
  weeklyWorkoutTarget: number;
  source: GoalSource;
  updatedAt: number;
}

export interface Exercise {
  id: number;
  /** Set for built-in exercises (their display name comes from translations). */
  slug: string | null;
  source: 'seed' | 'user';
  /** Set for user-created exercises. */
  customName: string | null;
  category: ExerciseCategory;
  primaryMuscle: Muscle;
  secondaryMuscles: Muscle[];
  equipment: Equipment;
  trackingType: TrackingType;
  metValue: number | null;
  isArchived: boolean;
  createdAt: number;
}

export interface TemplateExercise {
  id: number;
  exerciseId: number;
  position: number;
  targetSets: number;
  targetRepsMin: number | null;
  targetRepsMax: number | null;
  targetDurationSec: number | null;
  restSec: number;
}
export interface WorkoutTemplate {
  id: number;
  name: string;
  notes: string | null;
  createdAt: number;
  updatedAt: number;
  exercises: TemplateExercise[];
}

export interface SessionSet {
  id: number;
  sessionExerciseId: number;
  setNumber: number;
  weightKg: number | null;
  reps: number | null;
  durationSec: number | null;
  distanceM: number | null;
  rpe: number | null;
  isWarmup: boolean;
  isCompleted: boolean;
  completedAt: number | null;
}
export interface SessionExercise {
  id: number;
  exerciseId: number;
  position: number;
  sets: SessionSet[];
}
export interface WorkoutSession {
  id: number;
  templateId: number | null;
  name: string;
  status: SessionStatus;
  startedAt: number;
  endedAt: number | null;
  discardedAt: number | null;
  localDate: string;
  rpe: number | null;
  /** An estimate, never a measurement. */
  estKcal: number | null;
  estMethod: 'met' | null;
}
export interface WorkoutSessionDetail extends WorkoutSession {
  exercises: SessionExercise[];
}

export interface Food {
  id: number;
  slug: string | null;
  source: 'seed' | 'user';
  customName: string | null;
  brand: string | null;
  unit: FoodUnit;
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  fiberPer100: number | null;
  defaultServing: number;
  isFavorite: boolean;
  isArchived: boolean;
  /** 'approximate' = generic reference value, 'user_entered' = typed in by the user. */
  dataLabel: 'approximate' | 'user_entered';
  createdAt: number;
}
export interface MealEntry {
  id: number;
  localDate: string;
  mealType: MealType;
  foodId: number | null;
  quickLabel: string | null;
  amount: number;
  /** Snapshot taken when logged; later edits to the food never rewrite history. */
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  loggedAt: number;
}
/** Totals for one day, or `null` when nothing was logged (never zeros that look like data). */
export interface DailyTotals {
  entryCount: number;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface WaterEntry {
  id: number;
  localDate: string;
  amountMl: number;
  loggedAt: number;
}
export interface WaterDay {
  entryCount: number;
  totalMl: number;
}
export interface WeightEntry {
  id: number;
  localDate: string;
  weightKg: number;
  note: string | null;
  source: 'manual' | 'legacy_profile';
  loggedAt: number;
}

export interface Habit {
  id: number;
  slug: string | null;
  source: 'seed' | 'user';
  customName: string | null;
  kind: HabitKind;
  targetCount: number | null;
  scheduleDays: number;
  isArchived: boolean;
  createdAt: number;
}
export interface HabitLog {
  id: number;
  habitId: number;
  localDate: string;
  value: number;
}
