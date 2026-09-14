// UI language — SR-42, TR-16. Pure: the phone's locales and the saved choice come in as data.

export const LANGUAGES = ['en', 'fil'] as const;
export type Language = (typeof LANGUAGES)[number];

/** The app_meta row holding the tindera's explicit choice. Absent until she switches once. */
export const UI_LANGUAGE_META_KEY = 'ui_language';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Which language to show.
 *
 * 1. An explicit, valid saved choice always wins.
 * 2. Otherwise, the first of the phone's preferred languages that the app supports. Android may
 *    report Filipino as `fil` or as the legacy Tagalog code `tl`; both mean Filipino here.
 * 3. Otherwise, English.
 *
 * An unrecognised saved value is ignored rather than thrown on. A language preference is not a
 * price, and a bad row should never stop the app from opening.
 */
export function resolveLanguage(saved: string | null, deviceLanguageCodes: readonly (string | null)[]): Language {
  if (isLanguage(saved)) return saved;
  for (const code of deviceLanguageCodes) {
    const normalized = code?.toLowerCase();
    if (normalized === 'fil' || normalized === 'tl') return 'fil';
    if (normalized === 'en') return 'en';
  }
  return 'en';
}
