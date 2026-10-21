import { z } from 'zod';
import { id, int, localDate, num, text, timestamp } from './common';
import {
  activityLevelSchema, categorySchema, equipmentSchema, foodUnitSchema, goalSourceSchema, goalTypeSchema,
  habitKindSchema, mealTypeSchema, muscleSchema, sexSchema, trackingTypeSchema,
} from './enums';

const obj = z.strictObject; // unknown fields are rejected, so typos cannot slip through silently
const bad = (message: string) => ({ message });

export const profileInput = obj({
  displayName: text(1, 40),
  location: text(0, 60).optional(),
  sex: sexSchema.optional(),
  ageYears: int(10, 100).optional(),
  heightCm: num(100, 250).optional(),
  activityLevel: activityLevelSchema.optional(),
});

export const goalsInput = obj({
  goalType: goalTypeSchema,
  targetWeightKg: num(20, 500).optional(),
  kcalTarget: int(800, 6000).optional(),
  proteinG: num(0, 600).optional(),
  carbsG: num(0, 1500).optional(),
  fatG: num(0, 600).optional(),
  waterMlTarget: int(500, 8000),
  weeklyWorkoutTarget: int(0, 14),
  source: goalSourceSchema,
});

const exerciseFields = {
  name: text(1, 60),
  category: categorySchema,
  primaryMuscle: muscleSchema,
  secondaryMuscles: z.array(muscleSchema).max(5).default([]),
  equipment: equipmentSchema,
  trackingType: trackingTypeSchema,
  metValue: num(1, 25).optional(),
};
const secondaryRules = (v: { primaryMuscle?: string; secondaryMuscles?: string[] }) =>
  !v.secondaryMuscles || (new Set(v.secondaryMuscles).size === v.secondaryMuscles.length && !v.secondaryMuscles.includes(v.primaryMuscle ?? ''));
export const exerciseInput = obj(exerciseFields).refine(secondaryRules, { path: ['secondaryMuscles'], ...bad('validation.invalid') });
// No defaults here: a patch must only change what it names (a default would silently reset secondary muscles).
export const exercisePatch = obj({ ...exerciseFields, secondaryMuscles: z.array(muscleSchema).max(5), metValue: num(1, 25).nullable() }).partial().refine(
  (v) => !v.secondaryMuscles || new Set(v.secondaryMuscles).size === v.secondaryMuscles.length,
  { path: ['secondaryMuscles'], ...bad('validation.invalid') },
);

export const templateExerciseInput = obj({
  exerciseId: id,
  targetSets: int(1, 20),
  targetRepsMin: int(1, 1000).optional(),
  targetRepsMax: int(1, 1000).optional(),
  targetDurationSec: int(1, 7200).optional(),
  restSec: int(0, 900),
})
  .refine((v) => v.targetRepsMin === undefined || v.targetRepsMax === undefined || v.targetRepsMin <= v.targetRepsMax, { path: ['targetRepsMin'], ...bad('validation.outOfRange') })
  .refine((v) => v.targetRepsMin !== undefined || v.targetRepsMax !== undefined || v.targetDurationSec !== undefined, { path: ['targetRepsMin'], ...bad('validation.required') });

export const templateInput = obj({
  name: text(1, 60),
  notes: text(0, 500).optional(),
  exercises: z.array(templateExerciseInput).min(1).max(30),
});

export const sessionStartInput = obj({
  name: text(1, 60).optional(),
  templateId: id.optional(),
  exerciseIds: z.array(id).max(30).optional(),
});

export const setInput = obj({
  weightKg: num(0, 1000).optional(),
  reps: int(0, 1000).optional(),
  durationSec: int(0, 86_400).optional(),
  distanceM: num(0, 1_000_000).optional(),
  rpe: num(1, 10).optional(),
  isWarmup: z.boolean().default(false),
  isCompleted: z.boolean().default(false),
  completedAt: timestamp.optional(),
}).refine((v) => !v.isCompleted || v.reps !== undefined || v.durationSec !== undefined || v.distanceM !== undefined, { path: ['reps'], ...bad('validation.required') });

export const setPatch = obj({
  weightKg: num(0, 1000).nullable(),
  reps: int(0, 1000).nullable(),
  durationSec: int(0, 86_400).nullable(),
  distanceM: num(0, 1_000_000).nullable(),
  rpe: num(1, 10).nullable(),
  isWarmup: z.boolean(),
  isCompleted: z.boolean(),
  completedAt: timestamp.nullable(),
}).partial();

/** Corrections to a session's own fields after it has been completed. */
export const sessionPatch = obj({ name: text(1, 60), rpe: int(1, 10).nullable(), endedAt: timestamp }).partial();
export const completeSessionInput = obj({ rpe: int(1, 10).optional() });

export const foodInput = obj({
  name: text(1, 80),
  brand: text(0, 60).optional(),
  unit: foodUnitSchema,
  kcalPer100: num(0, 950),
  proteinPer100: num(0, 100),
  carbsPer100: num(0, 100),
  fatPer100: num(0, 100),
  fiberPer100: num(0, 100).optional(),
  defaultServing: num(0.1, 5000),
}).refine((v) => v.proteinPer100 + v.carbsPer100 + v.fatPer100 <= 100.0001, { path: ['proteinPer100'], ...bad('validation.outOfRange') });

export const mealInput = z.discriminatedUnion('kind', [
  obj({ kind: z.literal('food'), foodId: id, amount: num(0.1, 5000), mealType: mealTypeSchema, localDate: localDate.optional() }),
  obj({
    kind: z.literal('quick'), quickLabel: text(1, 80), kcal: num(0, 20_000),
    proteinG: num(0, 2000).default(0), carbsG: num(0, 3000).default(0), fatG: num(0, 2000).default(0),
    mealType: mealTypeSchema, localDate: localDate.optional(),
  }),
]);
export const mealPatch = obj({ amount: num(0.1, 5000), mealType: mealTypeSchema }).partial();

export const waterInput = obj({ amountMl: int(1, 5000), localDate: localDate.optional() });
export const weightInput = obj({ weightKg: num(20, 500), localDate: localDate.optional(), note: text(0, 200).optional() });

export const habitInput = obj({
  name: text(1, 60),
  kind: habitKindSchema,
  targetCount: int(1, 1000).optional(),
  scheduleDays: int(1, 127).default(127),
}).refine((v) => (v.kind === 'count') === (v.targetCount !== undefined), { path: ['targetCount'], ...bad('validation.required') });
export const habitLogInput = obj({ habitId: id, localDate, value: int(0, 100_000) });

export const dateRangeInput = obj({ from: localDate, to: localDate }).refine((v) => v.from <= v.to, { path: ['to'], ...bad('validation.invalidDate') });

export type ProfileInput = z.input<typeof profileInput>;
export type GoalsInput = z.input<typeof goalsInput>;
export type ExerciseInput = z.input<typeof exerciseInput>;
export type ExercisePatch = z.input<typeof exercisePatch>;
export type TemplateExerciseInput = z.input<typeof templateExerciseInput>;
export type TemplateInput = z.input<typeof templateInput>;
export type SessionStartInput = z.input<typeof sessionStartInput>;
export type SetInput = z.input<typeof setInput>;
export type SetPatch = z.input<typeof setPatch>;
export type SessionPatch = z.input<typeof sessionPatch>;
export type CompleteSessionInput = z.input<typeof completeSessionInput>;
export type FoodInput = z.input<typeof foodInput>;
export type MealInput = z.input<typeof mealInput>;
export type MealPatch = z.input<typeof mealPatch>;
export type WaterInput = z.input<typeof waterInput>;
export type WeightInput = z.input<typeof weightInput>;
export type HabitInput = z.input<typeof habitInput>;
export type HabitLogInput = z.input<typeof habitLogInput>;
export type DateRange = z.input<typeof dateRangeInput>;
