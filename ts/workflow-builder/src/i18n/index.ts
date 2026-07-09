// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import i18next, { type i18n as I18n } from "i18next";

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
// We also deliberately do NOT `.use(initReactI18next)`. That helper's init()
// calls react-i18next's setI18n(), which overwrites react-i18next's library-wide
// DEFAULT instance (a single module-level pointer) with whichever instance
// initialized last. The builder is a component, not the app — clobbering that
// global would hijack the HOST's provider-less useTranslation() (its toolbar,
// etc.). Instead this instance stays fully private: WorkflowBuilder feeds it to
// its subtree via <I18nextProvider>, and useTranslation resolves the instance
// from that context, never from the global — so no global registration is needed.
// React options live on the instance (useTranslation merges instance.options.react
// ahead of react-i18next's globals), keeping behaviour independent of the host.
//
// Init is eager (module load) because non-React callers capture `i18n.t` at
// module-eval time (e.g. hooks/useNodeDefinitions.ts). Resources are bundled, so
// i18next loads them synchronously inside init() and `t` is usable immediately.
const i18n: I18n = i18next.createInstance();

void i18n.init({
  resources,
  fallbackLng: "en",
  lng: "en",

  interpolation: {
    escapeValue: false, // not needed for react as it escapes by default
  },

  defaultNS: "translation",

  // Own these so the builder doesn't inherit the host's react-i18next defaults.
  // Resources are bundled synchronously, so there's nothing to suspend on.
  react: { useSuspense: false, bindI18n: "languageChanged" },
});

export default i18n;
