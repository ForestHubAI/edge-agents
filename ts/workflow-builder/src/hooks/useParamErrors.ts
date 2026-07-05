// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { useMemo } from "react";
import type { Diagnostic } from "@foresthubai/workflow-core/diagnostics";

/**
 * Build a per-parameter error map (`paramId → messages`) from a resource's
 * diagnostics, keeping only `error`-severity entries. Shared by every config
 * panel that renders a parameter list (node / edge / channel / memory / model)
 * so the inline Map-building loop lives in exactly one place.
 *
 * Memoized on `diags`, so callers can read it from the diagnostics store with a
 * plain selector and pass the result straight through to `<ParameterEditor>`.
 */
export function useParamErrors(diags: Diagnostic[] | undefined): Map<string, string[]> {
  return useMemo(() => {
    const map = new Map<string, string[]>();
    if (!diags) return map;
    for (const d of diags) {
      if (d.paramId && d.severity === "error") {
        const arr = map.get(d.paramId);
        if (arr) arr.push(d.message);
        else map.set(d.paramId, [d.message]);
      }
    }
    return map;
  }, [diags]);
}
