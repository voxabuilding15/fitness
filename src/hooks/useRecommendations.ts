import { useTranslation } from 'react-i18next';
import { useApp } from '../context/AppContext';
import type { Exercise } from '../domain/models';
import { assessExercise, compareForPicker, coverageGaps, type Assessment } from '../domain/recommendations';

type Hinted = Pick<Exercise, 'primaryMuscle' | 'secondaryMuscles' | 'equipment'>;

/**
 * Hints from the Profile settings (caution areas, experience level) for exercises, as translated lines. Derived only from
 * the muscles and equipment the library records; see `domain/recommendations.ts` for what can and cannot be checked.
 */
export function useRecommendations() {
  const { t } = useTranslation();
  const { settings } = useApp();
  const areas = (list: readonly string[]) => list.map((a) => t(`profile.areas.${a}`)).join(', ');

  const assess = (ex: Hinted): Assessment => assessExercise(ex, settings);
  const notesOf = (a: Assessment, withLevel = true): string[] => [
    ...(a.cautions.length ? [t('recs.cautionNote', { areas: areas(a.cautions) })] : []),
    ...(withLevel && a.level ? [t(a.level === 'friendly' ? 'recs.friendly' : 'recs.technical')] : []),
  ];
  const gaps = coverageGaps(settings.cautionAreas);
  /** What the hints cannot check for the areas the person chose, plus the disclaimer. Empty when no caution area is chosen. */
  const limits: string[] = settings.cautionAreas.length === 0 ? [] : [
    ...(gaps.none.length ? [t('recs.notChecked', { areas: areas(gaps.none) })] : []),
    ...(gaps.partial.length ? [t('recs.partlyChecked', { areas: areas(gaps.partial) })] : []),
    t('recs.disclaimer'),
  ];
  return { assess, notesOf, limits, compareForPicker };
}
