import { z } from 'zod';

export const SEX = ['female', 'male'] as const;
export const ACTIVITY_LEVEL = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
export const GOAL_TYPE = ['lose_fat', 'maintain', 'build_muscle'] as const;
export const GOAL_SOURCE = ['calculated', 'manual'] as const;
export const EXERCISE_CATEGORY = ['strength', 'cardio', 'mobility'] as const;
export const MUSCLE = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'full_body', 'cardio'] as const;
export const EQUIPMENT = ['bodyweight', 'dumbbell', 'barbell', 'machine', 'cable', 'kettlebell', 'band', 'cardio_machine', 'other'] as const;
export const TRACKING_TYPE = ['weight_reps', 'reps_only', 'duration', 'distance_duration'] as const;
export const MEAL_TYPE = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export const FOOD_UNIT = ['g', 'ml'] as const;
export const HABIT_KIND = ['boolean', 'count'] as const;

export const sexSchema = z.enum(SEX);
export const activityLevelSchema = z.enum(ACTIVITY_LEVEL);
export const goalTypeSchema = z.enum(GOAL_TYPE);
export const goalSourceSchema = z.enum(GOAL_SOURCE);
export const categorySchema = z.enum(EXERCISE_CATEGORY);
export const muscleSchema = z.enum(MUSCLE);
export const equipmentSchema = z.enum(EQUIPMENT);
export const trackingTypeSchema = z.enum(TRACKING_TYPE);
export const mealTypeSchema = z.enum(MEAL_TYPE);
export const foodUnitSchema = z.enum(FOOD_UNIT);
export const habitKindSchema = z.enum(HABIT_KIND);

export type Sex = z.infer<typeof sexSchema>;
export type ActivityLevel = z.infer<typeof activityLevelSchema>;
export type GoalType = z.infer<typeof goalTypeSchema>;
export type GoalSource = z.infer<typeof goalSourceSchema>;
export type ExerciseCategory = z.infer<typeof categorySchema>;
export type Muscle = z.infer<typeof muscleSchema>;
export type Equipment = z.infer<typeof equipmentSchema>;
export type TrackingType = z.infer<typeof trackingTypeSchema>;
export type MealType = z.infer<typeof mealTypeSchema>;
export type FoodUnit = z.infer<typeof foodUnitSchema>;
export type HabitKind = z.infer<typeof habitKindSchema>;
