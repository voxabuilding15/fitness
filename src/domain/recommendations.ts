import type { Exercise } from './models';
import type { Equipment, Muscle } from './schemas/enums';
import type { CautionArea, ExperienceLevel } from '../types/settings';

/**
 * Hints from the Profile settings, derived ONLY from what the exercise library records (muscles and equipment).
 * They are reminders, not medical advice and not a guarantee of safety; nothing is hidden or blocked because of them.
 *
 * Caution areas: the library records which MUSCLES an exercise works, not which joints it loads. So an area can only be
 * checked where a muscle stands in for it:
 *  - `muscle`  - the area IS a muscle group in the library (shoulders);
 *  - `partial` - a muscle is related but does not cover everything (wrists via forearms; body-weight
 *                support and impact are not recorded);
 *  - `none`    - nothing in the library corresponds (neck, lower back, knees, ankles - calf muscles say too little about the ankle joint) - no exercise is flagged and the person is told.
 */
export type CautionCoverage = 'muscle' | 'partial' | 'none';

export const CAUTION_MAP: Readonly<Record<CautionArea, { coverage: CautionCoverage; muscles: readonly Muscle[] }>> = {
  shoulders: { coverage: 'muscle', muscles: ['shoulders'] },
  wrists: { coverage: 'partial', muscles: ['forearms'] },
  ankles: { coverage: 'none', muscles: [] }, // calf-muscle data does not tell how an exercise loads the ankle joint
  knees: { coverage: 'none', muscles: [] },
  lowerBack: { coverage: 'none', muscles: [] },
  neck: { coverage: 'none', muscles: [] },
};
export const CAUTION_AREAS = Object.keys(CAUTION_MAP) as CautionArea[];

type Worked = Pick<Exercise, 'primaryMuscle' | 'secondaryMuscles'>;

/** The chosen caution areas whose mapped muscles this exercise works (as main or supporting muscle), in the order chosen. */
export function cautionFlags(ex: Worked, areas: readonly CautionArea[]): CautionArea[] {
  const worked = new Set<Muscle>([ex.primaryMuscle, ...ex.secondaryMuscles]);
  return areas.filter((a) => CAUTION_MAP[a].muscles.some((m) => worked.has(m)));
}

/** The chosen areas that cannot be checked completely, split by how much of them is covered. Areas not chosen are never listed. */
export function coverageGaps(areas: readonly CautionArea[]): { none: CautionArea[]; partial: CautionArea[] } {
  return {
    none: areas.filter((a) => CAUTION_MAP[a].coverage === 'none'),
    partial: areas.filter((a) => CAUTION_MAP[a].coverage === 'partial'),
  };
}

export type TechniqueDemand = 'low' | 'medium' | 'high';
/** How much technique the equipment usually asks for; `null` for "other", where the library says nothing. */
export function techniqueDemand(equipment: Equipment): TechniqueDemand | null {
  switch (equipment) {
    case 'bodyweight': case 'machine': case 'band': case 'cardio_machine': return 'low';
    case 'dumbbell': case 'cable': return 'medium';
    case 'barbell': case 'kettlebell': return 'high';
    default: return null;
  }
}

export type LevelHint = 'friendly' | 'technical';
/** Only for beginners: easy-to-start equipment is marked, and equipment that asks for more technique is marked as such. */
export function levelHint(ex: Pick<Exercise, 'equipment'>, level: ExperienceLevel): LevelHint | null {
  if (level !== 'beginner') return null;
  const d = techniqueDemand(ex.equipment);
  return d === 'low' ? 'friendly' : d === 'high' ? 'technical' : null;
}

export interface Assessment { cautions: CautionArea[]; level: LevelHint | null }
export const assessExercise = (ex: Worked & Pick<Exercise, 'equipment'>, settings: { cautionAreas: readonly CautionArea[]; experience: ExperienceLevel }): Assessment => ({
  cautions: cautionFlags(ex, settings.cautionAreas), level: levelHint(ex, settings.experience),
});

/** Picker order: exercises that touch a caution area go after the others, then (beginners) easy-to-start ones come first; otherwise unchanged. */
export function compareForPicker(a: Assessment, b: Assessment): number {
  const rank = (x: Assessment) => (x.cautions.length ? 4 : 0) + (x.level === 'technical' ? 2 : x.level === 'friendly' ? 0 : 1);
  return rank(a) - rank(b);
}
