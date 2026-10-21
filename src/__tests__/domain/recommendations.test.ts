import { EXERCISE_LIBRARY } from '../../data/exerciseLibrary';
import {
  CAUTION_AREAS, CAUTION_MAP, assessExercise, cautionFlags, compareForPicker, coverageGaps, levelHint, techniqueDemand,
} from '../../domain/recommendations';
import { MUSCLE } from '../../domain/schemas/enums';
import type { CautionArea } from '../../types/settings';

const ex = (primaryMuscle: (typeof MUSCLE)[number], secondaryMuscles: (typeof MUSCLE)[number][] = [], equipment: Parameters<typeof levelHint>[0]['equipment'] = 'dumbbell') => ({ primaryMuscle, secondaryMuscles, equipment });

describe('caution areas map to muscles only where the library supports it', () => {
  it('lists every caution area exactly once, with a coverage level', () => {
    expect([...CAUTION_AREAS].sort()).toEqual(['ankles', 'knees', 'lowerBack', 'neck', 'shoulders', 'wrists']);
    expect(CAUTION_AREAS.filter((a) => CAUTION_MAP[a].coverage === 'muscle')).toEqual(['shoulders']);
    expect(CAUTION_AREAS.filter((a) => CAUTION_MAP[a].coverage === 'partial').sort()).toEqual(['wrists']);
    expect(CAUTION_AREAS.filter((a) => CAUTION_MAP[a].coverage === 'none').sort()).toEqual(['ankles', 'knees', 'lowerBack', 'neck']);
  });
  it('only maps to muscles that exist, and an unmapped area maps to none', () => {
    for (const a of CAUTION_AREAS) {
      for (const m of CAUTION_MAP[a].muscles) expect(MUSCLE).toContain(m);
      expect(CAUTION_MAP[a].coverage === 'none').toBe(CAUTION_MAP[a].muscles.length === 0);
    }
  });
  it('flags an exercise that works the mapped muscle as main or supporting muscle', () => {
    expect(cautionFlags(ex('shoulders'), ['shoulders'])).toEqual(['shoulders']);
    expect(cautionFlags(ex('chest', ['triceps', 'shoulders']), ['shoulders'])).toEqual(['shoulders']);
    expect(cautionFlags(ex('forearms'), ['wrists'])).toEqual(['wrists']);
    expect(cautionFlags(ex('calves'), ['ankles'])).toEqual([]); // calf muscles do not tell how the ankle joint is loaded
  });
  it('flags nothing for an area chosen but not selected, or for an exercise that does not work the muscle', () => {
    expect(cautionFlags(ex('chest', ['triceps']), ['shoulders'])).toEqual([]);
    expect(cautionFlags(ex('shoulders'), [])).toEqual([]);
    expect(cautionFlags(ex('shoulders'), ['wrists'])).toEqual([]);
  });
  it('never guesses for the unmapped areas: knees, ankles, lower back and neck flag no exercise at all', () => {
    for (const e of EXERCISE_LIBRARY) expect(cautionFlags(e, ['knees', 'ankles', 'lowerBack', 'neck'])).toEqual([]);
  });
  it('several areas are reported in the order chosen', () => {
    expect(cautionFlags(ex('shoulders', ['forearms']), ['wrists', 'knees', 'shoulders'])).toEqual(['wrists', 'shoulders']);
  });
  it('against the real library: shoulder-caution flags exist, and every flag is explained by the muscle data', () => {
    const flagged = EXERCISE_LIBRARY.filter((e) => cautionFlags(e, ['shoulders']).length > 0);
    expect(flagged.length).toBeGreaterThan(5);
    for (const e of flagged) expect([e.primaryMuscle, ...e.secondaryMuscles]).toContain('shoulders');
    expect(EXERCISE_LIBRARY.filter((e) => cautionFlags(e, ['wrists']).length > 0).every((e) => [e.primaryMuscle, ...e.secondaryMuscles].includes('forearms'))).toBe(true);
  });
});

describe('coverageGaps', () => {
  it('lists only the chosen areas that are not fully covered', () => {
    expect(coverageGaps(['shoulders'])).toEqual({ none: [], partial: [] });
    expect(coverageGaps(['knees', 'wrists', 'shoulders', 'neck', 'ankles'])).toEqual({ none: ['knees', 'neck', 'ankles'], partial: ['wrists'] });
    expect(coverageGaps([])).toEqual({ none: [], partial: [] });
  });
});

describe('experience level', () => {
  it.each([
    ['bodyweight', 'low'], ['machine', 'low'], ['band', 'low'], ['cardio_machine', 'low'], ['dumbbell', 'medium'], ['cable', 'medium'],
    ['barbell', 'high'], ['kettlebell', 'high'], ['other', null],
  ] as const)('%s asks for %s technique', (eq, d) => expect(techniqueDemand(eq)).toBe(d));
  it('only beginners get hints: easy-to-start equipment and equipment that asks for more technique', () => {
    expect(levelHint({ equipment: 'bodyweight' }, 'beginner')).toBe('friendly');
    expect(levelHint({ equipment: 'barbell' }, 'beginner')).toBe('technical');
    expect(levelHint({ equipment: 'dumbbell' }, 'beginner')).toBeNull();
    expect(levelHint({ equipment: 'other' }, 'beginner')).toBeNull(); // the library says nothing: no hint, no guess
    for (const level of ['intermediate', 'advanced'] as const) for (const eq of ['bodyweight', 'barbell', 'other'] as const) expect(levelHint({ equipment: eq }, level)).toBeNull();
  });
});

describe('assessExercise / compareForPicker', () => {
  const settings = (cautionAreas: CautionArea[], experience: 'beginner' | 'intermediate' | 'advanced') => ({ cautionAreas, experience });
  it('combines both and changes nothing when no setting applies', () => {
    expect(assessExercise(ex('shoulders', [], 'barbell'), settings(['shoulders'], 'beginner'))).toEqual({ cautions: ['shoulders'], level: 'technical' });
    expect(assessExercise(ex('chest', [], 'dumbbell'), settings([], 'intermediate'))).toEqual({ cautions: [], level: null });
  });
  it('orders exercises: no caution first, easy ones first for a beginner, caution ones last; equal ones keep their order', () => {
    const list = [
      { n: 'caution-friendly', a: { cautions: ['shoulders'], level: 'friendly' } },
      { n: 'technical', a: { cautions: [], level: 'technical' } },
      { n: 'neutral', a: { cautions: [], level: null } },
      { n: 'friendly', a: { cautions: [], level: 'friendly' } },
      { n: 'neutral2', a: { cautions: [], level: null } },
    ] as const;
    const sorted = [...list].sort((x, y) => compareForPicker(x.a as never, y.a as never)).map((x) => x.n);
    expect(sorted).toEqual(['friendly', 'neutral', 'neutral2', 'technical', 'caution-friendly']);
  });
});
