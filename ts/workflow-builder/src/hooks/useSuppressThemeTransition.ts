import { useEffect, useLayoutEffect } from "react";

import { useResolvedTheme } from "./useResolvedTheme";

/**
 * Makes color-mode switches snap instead of fade.
 *
 * The embedder toggles the `light` class on `<html>`. Two different mechanisms
 * recolor the UI when it does, and both would otherwise animate to the new
 * tokens over their transition duration:
 *
 *  1. CSS-variable cascade — components with `transition-all` (canvas tabs, the
 *     builder sidebar). These recolor the instant the class flips.
 *  2. React re-render — ReactFlow's controls and node chrome recolor only once
 *     `useResolvedTheme` re-renders and ReactFlow re-applies its `colorMode`
 *     class, which commits a tick or two *after* the class flip.
 *
 * So a fixed one-frame suppression window catches (1) but misses (2). Instead:
 *
 *  - A MutationObserver adds `theme-changing` (CSS kills all transitions under
 *    it) the moment the class flips — a microtask, before any paint — and forces
 *    a reflow so the cascade-driven colors commit with no transition.
 *  - A layout effect keyed on the resolved theme removes it. Parent layout
 *    effects run after children's, so this fires after ReactFlow has committed
 *    its `colorMode` change; a reflow first flushes those colors while
 *    transitions are still suppressed, then we restore them. Tying removal to
 *    the React commit (not a timer) makes it deterministic regardless of how
 *    late the re-render lands.
 *
 * A short fallback timer removes the class even if no re-render follows, so a
 * theme-only-affects-CSS flip can never leave transitions permanently off.
 *
 * Mount once at the builder root.
 */
export function useSuppressThemeTransition(): void {
  // Re-renders on every color-mode flip; drives the layout effect below.
  const theme = useResolvedTheme();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;

    let wasLight = root.classList.contains("light");
    let fallback = 0;

    const observer = new MutationObserver(() => {
      const isLight = root.classList.contains("light");
      if (isLight === wasLight) return; // class changed for some other reason
      wasLight = isLight;

      root.classList.add("theme-changing");
      // Force a synchronous reflow so cascade-driven colors commit while
      // transitions are disabled, before the browser's next paint.
      void root.offsetHeight;

      // Safety net: if no React re-render follows (theme flip touched only CSS),
      // the layout effect won't run — drop the class anyway after a beat.
      clearTimeout(fallback);
      fallback = window.setTimeout(() => root.classList.remove("theme-changing"), 120);
    });

    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      clearTimeout(fallback);
      root.classList.remove("theme-changing");
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!root.classList.contains("theme-changing")) return; // initial mount, no flip
    // ReactFlow has committed its colorMode change by now (child layout effects
    // run first). Flush those colors under suppression, then restore transitions.
    void root.offsetHeight;
    root.classList.remove("theme-changing");
  }, [theme]);
}
