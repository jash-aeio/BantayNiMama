import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './en.json';
import fil from './fil.json';

// UI copy — TR-16, SR-42. Import this module once, before anything renders.
//
// Both languages are bundled JSON. No i18next backend plugin is installed, so nothing is ever
// fetched (TR-51). Detecting the phone's language (expo-localization) arrives in P1-7. Until then
// English is the default and the dev bar switches languages.

export const LANGUAGES = ['en', 'fil'] as const;
export type Language = (typeof LANGUAGES)[number];

// Compile-time check that both files have the same keys, both ways. A key missing from fil.json
// would otherwise quietly show English to a Filipino-language user.
const filHasEveryEnglishKey: typeof en = fil;
const enHasEveryFilipinoKey: typeof fil = en;
void filHasEveryEnglishKey;
void enHasEveryFilipinoKey;

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, fil: { translation: fil } },
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  // The resources are inline, so init can finish synchronously, before the first render. Then no
  // component ever suspends waiting for translations.
  initAsync: false,
  // React already escapes text, so escaping here would show "&amp;" in product names.
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18next;
