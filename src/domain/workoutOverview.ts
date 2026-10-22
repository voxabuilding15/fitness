import type { Exercise, WorkoutTemplate } from './models';
import type { Equipment, Muscle } from './schemas/enums';

/**
 * A saved workout at a glance, computed only from the template and the exercises it points to: how many exercises and
 * sets, which equipment it needs and which muscles it works. Nothing is estimated (no duration or calories - the app has
 * no defensible numbers for them). A row whose exercise cannot be found is counted in `unknown` and contributes no
 * equipment or muscles, rather than being guessed.
 */
export interface WorkoutOverview {
  exerciseCount: number;
  totalSets: number;
  /** Equipment in order of first use. */
  equipment: Equipment[];
  /** Main muscles, most-used first; ties keep the order of first use. */
  mainMuscles: Muscle[];
  /** Muscles that are only supporting muscles in this workout (never a main muscle), same ordering. */
  supportingMuscles: Muscle[];
  unknown: number;
}

type Known = Pick<Exercise, 'id' | 'equipment' | 'primaryMuscle' | 'secondaryMuscles'>;

const ranked = (counts: Map<Muscle, number>): Muscle[] => [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m); // Array.sort is stable

export function workoutOverview(template: Pick<WorkoutTemplate, 'exercises'>, exercises: ReadonlyMap<number, Known>): WorkoutOverview {
  const equipment: Equipment[] = [];
  const main = new Map<Muscle, number>();
  const support = new Map<Muscle, number>();
  let unknown = 0;
  for (const row of template.exercises) {
    const ex = exercises.get(row.exerciseId);
    if (!ex) { unknown++; continue; }
    if (!equipment.includes(ex.equipment)) equipment.push(ex.equipment);
    main.set(ex.primaryMuscle, (main.get(ex.primaryMuscle) ?? 0) + 1);
    for (const m of ex.secondaryMuscles) support.set(m, (support.get(m) ?? 0) + 1);
  }
  return {
    exerciseCount: template.exercises.length,
    totalSets: template.exercises.reduce((sum, r) => sum + r.targetSets, 0),
    equipment, mainMuscles: ranked(main), supportingMuscles: ranked(support).filter((m) => !main.has(m)), unknown,
  };
}
