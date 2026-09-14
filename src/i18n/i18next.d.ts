import 'i18next';

import type en from './en.json';

// Typed keys: t('enroll.nmae') is a compile error, not a raw key shown on screen (SR-42).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en };
  }
}
