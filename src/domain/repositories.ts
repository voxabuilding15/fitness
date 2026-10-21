import type {
  DailyTotals, Exercise, Food, Goals, Habit, HabitLog, MealEntry, Profile, SessionExercise, SessionSet, WaterDay, WaterEntry,
  WeightEntry, WorkoutSession, WorkoutSessionDetail, WorkoutTemplate,
} from './models';
import type { Result } from './result';
import type { Equipment, ExerciseCategory, Muscle } from './schemas/enums';
import type {
  CompleteSessionInput, DateRange, ExerciseInput, ExercisePatch, FoodInput, GoalsInput, HabitInput, HabitLogInput, MealInput, MealPatch,
  ProfileInput, SessionPatch, SessionStartInput, SetInput, SetPatch, TemplateInput, WaterInput, WeightInput,
} from './schemas/inputs';
import type { SessionStatus } from './sessionLifecycle';

/**
 * Persistence contracts. Pure types: no SQL, no React, no Expo. Every method validates its input and returns a
 * `Result`; nothing here throws. Implementations live in src/db/repositories.
 * Empty data is reported honestly: `null` / `[]`, never zeros or sample values.
 */
export interface ProfileRepository {
  get(): Promise<Result<Profile | null>>;
  save(input: ProfileInput): Promise<Result<Profile>>;
}

export interface GoalsRepository {
  get(): Promise<Result<Goals | null>>;
  save(input: GoalsInput): Promise<Result<Goals>>;
}

export interface ExerciseFilter {
  search?: string;
  primaryMuscle?: Muscle;
  equipment?: Equipment;
  category?: ExerciseCategory;
  includeArchived?: boolean;
}
export interface ExerciseRepository {
  list(filter?: ExerciseFilter): Promise<Result<Exercise[]>>;
  get(id: number): Promise<Result<Exercise>>;
  create(input: ExerciseInput): Promise<Result<Exercise>>;
  /** User-created exercises only; built-in ones are immutable. */
  update(id: number, patch: ExercisePatch): Promise<Result<Exercise>>;
  setArchived(id: number, archived: boolean): Promise<Result<Exercise>>;
  /** Fails with a foreign-key constraint if the exercise appears in any template or session. */
  delete(id: number): Promise<Result<void>>;
}

export interface TemplateRepository {
  list(): Promise<Result<WorkoutTemplate[]>>;
  get(id: number): Promise<Result<WorkoutTemplate>>;
  create(input: TemplateInput): Promise<Result<WorkoutTemplate>>;
  update(id: number, input: TemplateInput): Promise<Result<WorkoutTemplate>>;
  delete(id: number): Promise<Result<void>>;
  duplicate(id: number, newName: string): Promise<Result<WorkoutTemplate>>;
}

export interface SessionListFilter {
  status?: SessionStatus;
  range?: DateRange;
  limit?: number;
  offset?: number;
}
export interface SessionRepository {
  /** Fails with `conflict/active_session` if a workout is already in progress. */
  start(input?: SessionStartInput): Promise<Result<WorkoutSessionDetail>>;
  getActive(): Promise<Result<WorkoutSessionDetail | null>>;
  get(id: number): Promise<Result<WorkoutSessionDetail>>;
  list(filter?: SessionListFilter): Promise<Result<WorkoutSession[]>>;
  addExercise(sessionId: number, exerciseId: number): Promise<Result<SessionExercise>>;
  removeExercise(sessionExerciseId: number): Promise<Result<void>>;
  addSet(sessionExerciseId: number, input: SetInput): Promise<Result<SessionSet>>;
  updateSet(setId: number, patch: SetPatch): Promise<Result<SessionSet>>;
  deleteSet(setId: number): Promise<Result<void>>;
  /** in_progress -> completed. Needs at least one completed set. */
  complete(sessionId: number, input?: CompleteSessionInput): Promise<Result<WorkoutSession>>;
  /** in_progress -> discarded. The data is kept but never counted. */
  discard(sessionId: number): Promise<Result<WorkoutSession>>;
  /** Corrections to a session's own fields (completed or in progress; never discarded). */
  updateDetails(sessionId: number, patch: SessionPatch): Promise<Result<WorkoutSession>>;
  /** Distinct local dates with at least one COMPLETED session (discarded / in-progress are excluded). */
  completedDates(range: DateRange): Promise<Result<string[]>>;
  countCompleted(range: DateRange): Promise<Result<number>>;
}

export interface FoodFilter {
  search?: string;
  favoritesOnly?: boolean;
  includeArchived?: boolean;
}
export interface NutritionRepository {
  listFoods(filter?: FoodFilter): Promise<Result<Food[]>>;
  getFood(id: number): Promise<Result<Food>>;
  createFood(input: FoodInput): Promise<Result<Food>>;
  /** User-created foods only. Past meals keep the values they were logged with. */
  updateFood(id: number, input: FoodInput): Promise<Result<Food>>;
  setFoodFavorite(id: number, favorite: boolean): Promise<Result<Food>>;
  setFoodArchived(id: number, archived: boolean): Promise<Result<Food>>;
  addMeal(input: MealInput): Promise<Result<MealEntry>>;
  updateMeal(id: number, patch: MealPatch): Promise<Result<MealEntry>>;
  deleteMeal(id: number): Promise<Result<void>>;
  listMeals(localDate: string): Promise<Result<MealEntry[]>>;
  /** `null` when nothing was logged that day. */
  dailyTotals(localDate: string): Promise<Result<DailyTotals | null>>;
}

export interface WaterRepository {
  add(input: WaterInput): Promise<Result<WaterEntry>>;
  /** Removes and returns the most recent entry of the day (`null` if there was none). */
  undoLast(localDate?: string): Promise<Result<WaterEntry | null>>;
  listDay(localDate: string): Promise<Result<WaterEntry[]>>;
  /** `null` when nothing was logged that day. */
  day(localDate: string): Promise<Result<WaterDay | null>>;
}

export interface WeightRepository {
  /** One entry per day: saving again for the same day replaces it. */
  save(input: WeightInput): Promise<Result<WeightEntry>>;
  remove(localDate: string): Promise<Result<void>>;
  list(range: DateRange): Promise<Result<WeightEntry[]>>;
  latest(): Promise<Result<WeightEntry | null>>;
}

export interface HabitRepository {
  create(input: HabitInput): Promise<Result<Habit>>;
  list(opts?: { includeArchived?: boolean }): Promise<Result<Habit[]>>;
  setArchived(id: number, archived: boolean): Promise<Result<Habit>>;
  /** One log per habit per day; saving again replaces it. */
  setLog(input: HabitLogInput): Promise<Result<HabitLog>>;
  removeLog(habitId: number, localDate: string): Promise<Result<void>>;
  listLogs(range: DateRange, habitId?: number): Promise<Result<HabitLog[]>>;
}

export interface Repositories {
  profile: ProfileRepository;
  goals: GoalsRepository;
  exercises: ExerciseRepository;
  templates: TemplateRepository;
  sessions: SessionRepository;
  nutrition: NutritionRepository;
  water: WaterRepository;
  weight: WeightRepository;
  habits: HabitRepository;
}
