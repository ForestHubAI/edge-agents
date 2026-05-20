import { useEffect, useState } from "react";

/**
 * Returns "light" if `<html>` has the `light` class, else "dark". Subscribes to
 * MutationObserver so toggles by the embedder propagate immediately.
 *
 * Dark is the default — the builder's CSS puts dark tokens on `:root` and
 * overrides them under `.light`. This hook exists so things that need an
 * explicit value — notably ReactFlow's `colorMode` prop — stay in sync.
 */
export function useResolvedTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">(() => detect());

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(detect()));
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    // Initial sync in case it changed between mount and effect.
    setTheme(detect());
    return () => observer.disconnect();
  }, []);

  return theme;
}

function detect(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("light") ? "light" : "dark";
}
