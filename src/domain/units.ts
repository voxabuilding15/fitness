/**
 * Unit conversion. The database and every calculation use metric units only (kg, cm); pounds and feet/inches exist
 * purely at the input/display edge. Conversions keep full precision; only the `display*` helpers round.
 */
export type WeightUnit = 'kg' | 'lb';
export type HeightUnit = 'cm' | 'ft_in';

/** Exact definitions: 1 lb = 0.45359237 kg, 1 in = 2.54 cm. */
export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

export const roundTo = (n: number, decimals = 1) => {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;

/** Converts a value entered in `unit` to kilograms (the stored unit). */
export const toKg = (value: number, unit: WeightUnit) => (unit === 'kg' ? value : lbToKg(value));
/** Converts stored kilograms to `unit` (unrounded). */
export const fromKg = (kg: number, unit: WeightUnit) => (unit === 'kg' ? kg : kgToLb(kg));
/** Weight rounded for display (default one decimal). */
export const displayWeight = (kg: number, unit: WeightUnit, decimals = 1) => roundTo(fromKg(kg, unit), decimals);

export const feetInchesToCm = (feet: number, inches: number) => (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH;

/** Whole inches, with 12 inches carried into the feet, so the result never shows "5 ft 12 in". */
export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(totalInches / INCHES_PER_FOOT), inches: totalInches % INCHES_PER_FOOT };
}
