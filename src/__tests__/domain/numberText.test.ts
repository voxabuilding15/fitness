import { NUMBER_ISSUE_KEY, parseNumber, parseNumberText } from '../../domain/numberText';

const ok = (value: number) => ({ ok: true, value });
const bad = (reason: 'empty' | 'invalid' | 'ambiguous') => ({ ok: false, reason });

describe('R1: decimal and grouping marks are never guessed', () => {
  it.each([
    ['80', 80], ['0', 0], ['007', 7], ['80.5', 80.5], ['80,5', 80.5], ['0,5', 0.5], ['0.500', 0.5], ['0,500', 0.5], ['1,25', 1.25], ['1.2', 1.2],
    ['1,2345', 1.2345], ['1234,567', 1234.567], ['1234.567', 1234.567], ['12,3456', 12.3456], ['  80,5  ', 80.5],
  ])('%j is the decimal number %j', (raw, n) => expect(parseNumber(raw)).toEqual(ok(n)));

  it.each([['1,500'], ['2,500'], ['1.500'], ['2.500'], ['999,999'], ['12,345'], ['120.500'], ['٢٬٥٠٠'], ['١٫٥٠٠']])(
    '%j could be a decimal or a thousands separator: ambiguous, not silently 1.5 / 2.5',
    (raw) => expect(parseNumber(raw)).toEqual(bad('ambiguous')),
  );

  it.each([
    ['1,500,000', 1500000], ['1.500.000', 1500000], ['12,345,678', 12345678], ['1,500.5', 1500.5], ['1.500,5', 1500.5], ['12,345.67', 12345.67],
    ['1,234,567.891', 1234567.891], ['1.234.567,891', 1234567.891], ['999,999.9', 999999.9],
  ])('%j is unambiguous grouping: %j', (raw, n) => expect(parseNumber(raw)).toEqual(ok(n)));

  it.each([
    ['1,5,5'], ['12,34,567'], ['1,5000,000'], ['0,500,000'], ['1,500,00'], ['1.5.5'], ['1,500.5.5'], ['1.5,5.5'], ['1,5.500,5'], ['1,500,5'], ['1.500.5'],
    ['.5'], ['5.'], [',5'], ['5,'], ['1..5'], ['1,,5'], ['1.,5'], ['-5'], ['+5'], ['1e3'], ['8 0'], ['1 500'], ['80kg'], ['abc'], ['NaN'], ['Infinity'], ['٨٠x'], ['1,500.'], ['1,500,'],
  ])('%j is invalid', (raw) => expect(parseNumber(raw)).toEqual(bad('invalid')));

  it('empty and blank text is "empty"', () => {
    expect(parseNumber('')).toEqual(bad('empty'));
    expect(parseNumber('   ')).toEqual(bad('empty'));
  });

  it.each([['٨٠', 80], ['٨٠٫٥', 80.5], ['۸۰', 80], ['٢٬٥٠٠٬٠٠٠', 2500000], ['٢٬٥٠٠٫٥', 2500.5], ['٠٫٥٠٠', 0.5]])('Arabic and Persian digits and marks: %j is %j', (raw, n) => {
    expect(parseNumber(raw)).toEqual(ok(n));
  });

  it('the boundary of "three digits after the mark": 2 and 4 digits are decimals, exactly 3 is ambiguous', () => {
    expect(parseNumber('1,50')).toEqual(ok(1.5));
    expect(parseNumber('1,500')).toEqual(bad('ambiguous'));
    expect(parseNumber('1,5000')).toEqual(ok(1.5));
    expect(parseNumber('1234,500')).toEqual(ok(1234.5)); // four-digit whole part cannot be a group
    expect(parseNumber('0,500')).toEqual(ok(0.5)); // a leading 0 cannot be a group
  });

  it('never returns a non-finite number', () => {
    expect(parseNumber('9'.repeat(400))).toEqual(bad('invalid'));
  });

  it('parseNumberText returns the number only for unambiguous input', () => {
    expect(parseNumberText('80,5')).toBe(80.5);
    expect(parseNumberText('1,500')).toBeNull();
    expect(parseNumberText('1,500.5')).toBe(1500.5);
    expect(parseNumberText('')).toBeNull();
  });

  it('each failure maps to a translation key', () => {
    expect(NUMBER_ISSUE_KEY).toEqual({ empty: 'validation.required', invalid: 'validation.invalid', ambiguous: 'validation.ambiguousNumber' });
  });
});
