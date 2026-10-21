/**
 * Reading a number the way people type it, without ever guessing between a decimal mark and a thousands separator.
 *
 * Accepted:
 *  - digits in Latin, Arabic-Indic (٠-٩) or Persian (۰-۹) form; the Arabic decimal mark "٫" and thousands mark "٬";
 *  - one "." or "," as the decimal mark:                    80.5   80,5   0,500   1,2345   1234,567
 *  - repeated, correctly spaced grouping marks:             1,500,000   1.500.000
 *  - grouping + a different decimal mark (either order):    1,500.5   1.500,5
 * Rejected as `ambiguous` (could be 1.5 or 1500, and guessing would silently change the value by a factor of 1000):
 *  - a single "." or "," followed by exactly three digits, after one to three digits not starting with 0:  1,500   2.500
 * Rejected as `invalid`: anything else (letters, signs, exponents, spaces, stray or misplaced separators).
 */
export type NumberParse = { ok: true; value: number } | { ok: false; reason: 'empty' | 'invalid' | 'ambiguous' };

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';
const fail = (reason: 'empty' | 'invalid' | 'ambiguous'): NumberParse => ({ ok: false, reason });
const good = (text: string): NumberParse => {
  const value = Number(text);
  return Number.isFinite(value) ? { ok: true, value } : fail('invalid');
};
/** "1" to "999" with no leading zero, followed only by groups of exactly three digits. */
const isGroupedInteger = (parts: string[]) => /^[1-9]\d{0,2}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p));

export function parseNumber(raw: string): NumberParse {
  const s = raw
    .trim()
    .replace(/[٠-٩]/g, (c) => String(ARABIC_INDIC.indexOf(c)))
    .replace(/[۰-۹]/g, (c) => String(EXTENDED_ARABIC_INDIC.indexOf(c)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
  if (s === '') return fail('empty');
  if (!/^[0-9.,]+$/.test(s) || /^[.,]|[.,]$|[.,]{2}/.test(s)) return fail('invalid');

  const dots = s.split('.').length - 1;
  const commas = s.split(',').length - 1;
  if (dots === 0 && commas === 0) return good(s);

  if (dots === 0 || commas === 0) {
    const sep = dots > 0 ? '.' : ',';
    const parts = s.split(sep);
    if (parts.length === 2) {
      const [whole, fraction] = parts;
      if (fraction.length === 3 && /^[1-9]\d{0,2}$/.test(whole)) return fail('ambiguous'); // 1,500 / 2.500
      return good(`${whole}.${fraction}`);
    }
    return isGroupedInteger(parts) ? good(parts.join('')) : fail('invalid'); // 1,500,000 is grouping; 1,5,5 is nothing
  }

  // both marks present: the last one is the decimal mark and may appear once; the other one groups the whole part
  const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
  const group = decimal === '.' ? ',' : '.';
  const pieces = s.split(decimal);
  if (pieces.length !== 2 || pieces[1].length === 0 || pieces[1].includes(group)) return fail('invalid');
  const wholeParts = pieces[0].split(group);
  if (!isGroupedInteger(wholeParts)) return fail('invalid');
  return good(`${wholeParts.join('')}.${pieces[1]}`);
}

/** Back-compatible helper: the number, or null for anything empty, invalid or ambiguous. */
export const parseNumberText = (raw: string): number | null => {
  const r = parseNumber(raw);
  return r.ok ? r.value : null;
};

/** The translation key that explains why a number could not be read. */
export const NUMBER_ISSUE_KEY = { empty: 'validation.required', invalid: 'validation.invalid', ambiguous: 'validation.ambiguousNumber' } as const;
