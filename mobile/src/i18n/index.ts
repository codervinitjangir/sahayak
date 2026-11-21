// Translation groundwork (ADR-052). English is the only language today, so this
// changes no behaviour: it gives every string a key, so adding Hindi later is a
// new locales/hi.json plus device-language detection (expo-localization), not a
// hunt through every screen. Before a language with richer plural rules ships,
// check Intl.PluralRules on a real Android device (Hermes) and add the
// @formatjs/intl-pluralrules polyfill if it is missing.
//
// Components import useTranslation from here, not from react-i18next, so the
// instance is initialised by the import itself (screens, tests, everything).
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";

export const resources = { en: { translation: en } } as const;
export const SUPPORTED_LANGUAGES = ["en"] as const;

declare module "i18next" {
  interface CustomTypeOptions {
    resources: (typeof resources)["en"];
  }
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources,
    lng: "en",
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false }, // React escapes already
    initAsync: false,
  });
}

export { useTranslation } from "react-i18next";
export default i18n;

/** Plain words for a booking error code, or undefined for any other code. */
export function bookingError(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const key = `booking.errors.${code}`;
  return i18n.exists(key) ? (i18n.t as (k: string) => string)(key) : undefined;
}
