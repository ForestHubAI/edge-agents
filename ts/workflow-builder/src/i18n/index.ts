import i18next, { type i18n as I18n } from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";

const resources = {
  de: {
    translation: de,
  },
  en: {
    translation: en,
  },
};

// A PRIVATE i18next instance, not the global default. This keeps the builder's
// translations isolated from any i18next the host app runs, so the two never
// collide. We deliberately do NOT use LanguageDetector: the host owns locale and
// drives it via the WorkflowBuilder `language` prop (see WorkflowBuilder.tsx),
// rather than the builder reading navigator/localStorage behind the host's back.
//
// Init is eager (module load) because non-React callers capture `i18n.t` at
// module-eval time (e.g. hooks/useNodeDefinitions.ts). Resources are bundled, so
// i18next loads them synchronously inside init() and `t` is usable immediately.
const i18n: I18n = i18next.createInstance();

i18n.use(initReactI18next).init({
  resources,
  fallbackLng: "en",
  lng: "en",
  debug: false,

  interpolation: {
    escapeValue: false, // not needed for react as it escapes by default
  },

  defaultNS: "translation",
});

export default i18n;
