import { pl } from "./locales/pl.js";

/**
 * i18n: every string shown to the user comes from a locale dictionary —
 * the code (and the API) stays in English, while the UI displays in Polish
 * (plan A5). Adding a new language = a new locale object + registration below.
 */
type Locale = typeof pl;
export type MessageKey = keyof Locale;

const locales: Record<string, Locale> = { pl };
let currentLocale = "pl";

/** Switch the locale; unknown codes are ignored (no-op). */
export function setLocale(code: string): void {
  if (locales[code] !== undefined) {
    currentLocale = code;
  }
}

/** The active locale code. */
export function getLocale(): string {
  return currentLocale;
}

/** Translate a message key with the active locale. */
export function t(key: MessageKey): string {
  return locales[currentLocale][key];
}
