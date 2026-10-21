import { useTranslation } from 'react-i18next';

/** Numbers stay in Latin digits in both languages so values and units read consistently. */
export const formatNumber = (n: number, maxFractionDigits = 0) =>
  n.toLocaleString('en-US', { maximumFractionDigits: maxFractionDigits });

export function useFormat() {
  const { i18n } = useTranslation();
  const locale = i18n.language === 'ar' ? 'ar-u-nu-latn' : 'en-GB';
  const formatDate = (d: Date) =>
    d.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
  return { formatDate, formatNumber };
}
