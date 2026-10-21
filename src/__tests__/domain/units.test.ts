import { CM_PER_INCH, KG_PER_LB, cmToFeetInches, displayWeight, feetInchesToCm, fromKg, kgToLb, lbToKg, roundTo, toKg } from '../../domain/units';

describe('weight', () => {
  it('uses the exact definition of the pound', () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(lbToKg(1)).toBe(0.45359237);
    expect(lbToKg(100)).toBeCloseTo(45.359237, 9);
  });
  it('known values: 70 kg = 154.3 lb; 154.3 lb = 69.99 kg; 200 lb = 90.72 kg', () => {
    expect(displayWeight(70, 'lb')).toBe(154.3);
    expect(roundTo(lbToKg(154.3), 2)).toBe(69.99);
    expect(roundTo(lbToKg(200), 2)).toBe(90.72);
  });
  it('round-trips within floating point error, for the whole accepted range', () => {
    for (const kg of [20, 45.5, 70, 99.9, 250, 500]) {
      expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 9);
      expect(toKg(fromKg(kg, 'lb'), 'lb')).toBeCloseTo(kg, 9);
    }
  });
  it('kg is the identity; toKg/fromKg pick the unit', () => {
    expect(toKg(80, 'kg')).toBe(80);
    expect(fromKg(80, 'kg')).toBe(80);
    expect(toKg(176.37, 'lb')).toBeCloseTo(80, 2);
  });
  it('stored values are never rounded by the conversion, only by display', () => {
    expect(lbToKg(154.3)).not.toBe(69.99);
    expect(displayWeight(lbToKg(154.3), 'lb')).toBe(154.3);
  });
});

describe('height', () => {
  it('uses the exact definition of the inch', () => {
    expect(CM_PER_INCH).toBe(2.54);
    expect(feetInchesToCm(5, 11)).toBeCloseTo(180.34, 9);
    expect(feetInchesToCm(0, 0)).toBe(0);
  });
  it('known values: 180 cm = 5 ft 11 in; 177.8 cm = 5 ft 10 in; 182.88 cm = 6 ft 0 in', () => {
    expect(cmToFeetInches(180)).toEqual({ feet: 5, inches: 11 });
    expect(cmToFeetInches(177.8)).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(182.88)).toEqual({ feet: 6, inches: 0 });
  });
  it('never shows 12 inches: 12 carries into the feet', () => {
    for (let cm = 100; cm <= 250; cm += 0.5) {
      const { feet, inches } = cmToFeetInches(cm);
      expect(inches).toBeGreaterThanOrEqual(0);
      expect(inches).toBeLessThanOrEqual(11);
      expect(Number.isInteger(feet) && Number.isInteger(inches)).toBe(true);
    }
    expect(cmToFeetInches(181.9)).toEqual({ feet: 6, inches: 0 }); // 71.6 in rounds to 72 -> 6 ft 0 in, not 5 ft 12 in
  });
  it('feet/inches -> cm -> feet/inches is stable', () => {
    for (let ft = 3; ft <= 8; ft++) for (let inch = 0; inch < 12; inch++) expect(cmToFeetInches(feetInchesToCm(ft, inch))).toEqual({ feet: ft, inches: inch });
  });
});

describe('roundTo', () => {
  it('rounds half away from zero at the given precision', () => {
    expect(roundTo(1.005, 2)).toBe(1.01);
    expect(roundTo(2.5, 0)).toBe(3);
    expect(roundTo(154.32356, 1)).toBe(154.3);
  });
});
