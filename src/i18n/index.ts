import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { LANGUAGES } from '../domain/language.ts';
import en from './en.json';
import fil from './fil.json';

// UI copy — TR-16, SR-42. Import this module once, before anything renders.
//
// Both languages are bundled JSON. No i18next backend plugin is installed, so nothing is ever
// fetched (TR-51). Which language shows is decided in src/app/Root.tsx: the saved ui_language,
// else the phone's locale (src/domain/language.ts).

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
