// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";

// Visual light/dark switch. The host owns theme state (App toggles the `.light`
// class on <html>, which the builder's useResolvedTheme reads); this component is
// purely presentational. Sun shows in dark mode (click → light); Moon in light.
export function ThemeToggle({ theme, onToggle }: { theme: "dark" | "light"; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onToggle}
      className="p-2 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
      title={t("a11y.toggleTheme")}
      aria-label={t("a11y.toggleTheme")}
    >
      {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </button>
  );
}
