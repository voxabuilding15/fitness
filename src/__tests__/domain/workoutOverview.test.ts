import { workoutOverview } from '../../domain/workoutOverview';

const row = (exerciseId: number, targetSets: number) => ({ id: exerciseId, exerciseId, position: 1, targetSets, targetRepsMin: 8, targetRepsMax: null, targetDurationSec: null, restSec: 60 });
const ex = (id: number, equipment: 'barbell' | 'bodyweight' | 'cable', primaryMuscle: 'chest' | 'shoulders' | 'core' | 'back', secondaryMuscles: ('triceps' | 'shoulders' | 'chest' | 'biceps')[] = []) => [id, { id, equipment, primaryMuscle, secondaryMuscles }] as const;

describe('workoutOverview', () => {
  it('counts exercises and sets and lists equipment and muscles in a stable, meaningful order', () => {
    const lib = new Map([ex(1, 'barbell', 'chest', ['triceps', 'shoulders']), ex(2, 'barbell', 'shoulders', ['triceps']), ex(3, 'bodyweight', 'chest'), ex(4, 'cable', 'back', ['biceps'])]);
    const o = workoutOverview({ exercises: [row(1, 4), row(2, 3), row(3, 2), row(4, 3)] }, lib);
    expect(o.exerciseCount).toBe(4);
    expect(o.totalSets).toBe(12);
    expect(o.equipment).toEqual(['barbell', 'bodyweight', 'cable']); // first use
    expect(o.mainMuscles).toEqual(['chest', 'shoulders', 'back']); // chest twice, then first-use order
    expect(o.supportingMuscles).toEqual(['triceps', 'biceps']); // shoulders is a main muscle here, so it is not repeated
    expect(o.unknown).toBe(0);
  });
  it('the same exercise twice counts twice for sets and muscles but lists its equipment once', () => {
    const lib = new Map([ex(1, 'barbell', 'chest')]);
    const o = workoutOverview({ exercises: [row(1, 3), row(1, 2)] }, lib);
    expect(o).toMatchObject({ exerciseCount: 2, totalSets: 5, equipment: ['barbell'], mainMuscles: ['chest'] });
  });
  it('a row whose exercise is missing is counted as unknown and adds no equipment or muscles', () => {
    const lib = new Map([ex(1, 'cable', 'back')]);
    const o = workoutOverview({ exercises: [row(1, 3), row(99, 5)] }, lib);
    expect(o).toMatchObject({ exerciseCount: 2, totalSets: 8, equipment: ['cable'], mainMuscles: ['back'], unknown: 1 });
  });
  it('an empty workout gives empty lists, not placeholders', () => {
    expect(workoutOverview({ exercises: [] }, new Map())).toEqual({ exerciseCount: 0, totalSets: 0, equipment: [], mainMuscles: [], supportingMuscles: [], unknown: 0 });
  });
});
