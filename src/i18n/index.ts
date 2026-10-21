import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ar from '../locales/ar.json';
import type { Language } from '../types/settings';

export const RTL_LANGUAGES: Language[] = ['ar'];
export const isRtlLanguage = (lng: string) => RTL_LANGUAGES.includes(lng as Language);

const i18n = createInstance();
i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
