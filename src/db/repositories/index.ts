import type { Repositories } from '../../domain/repositories';
import { createExerciseRepository } from './exercises';
import { createNutritionRepository } from './nutrition';
import { createGoalsRepository, createProfileRepository } from './profileGoals';
import { createSessionRepository } from './sessions';
import { createTemplateRepository } from './templates';
import { createHabitRepository, createWaterRepository, createWeightRepository } from './trackers';
import { RepoContext, type RepoDeps } from './base';

export type { RepoDeps } from './base';

export function createRepositories(deps: RepoDeps): Repositories {
  const ctx = new RepoContext(deps);
  return {
    profile: createProfileRepository(ctx),
    goals: createGoalsRepository(ctx),
    exercises: createExerciseRepository(ctx),
    templates: createTemplateRepository(ctx),
    sessions: createSessionRepository(ctx),
    nutrition: createNutritionRepository(ctx),
    water: createWaterRepository(ctx),
    weight: createWeightRepository(ctx),
    habits: createHabitRepository(ctx),
  };
}
