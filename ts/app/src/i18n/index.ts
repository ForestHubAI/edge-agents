import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";

// localStorage key for the host's chosen locale. App reads/writes the same key
// for its `lang` state, so the two stay in agreement.
export const LANG_STORAGE_KEY = "fh-lang";

export type Language = "en" | "de";

// Initial locale: persisted choice, else English. Read here (not just in App) so
// the toolbar paints in the right language on the first frame — no en→de flash.
export function getStoredLanguage(): Language {
  return localStorage.getItem(LANG_STORAGE_KEY) === "de" ? "de" : "en";
}

// The host's OWN translations (toolbar, status, dialogs). This uses the GLOBAL
// i18next singleton; the builder runs a separate PRIVATE instance scoped to its
// own subtree, so the two never collide. We don't use LanguageDetector — App owns
// locale and drives it via i18n.changeLanguage + the builder's `language` prop.
void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  lng: getStoredLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
});

export default i18n;
