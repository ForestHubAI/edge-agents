import type { Reference } from "../node";
import { refToLookupKey, type AvailableVariable } from "../variable";
import type { Parameter } from "./parameter";

export interface ParamDisplayResult {
  text: string;
  isInvalid?: boolean;
}

/** Format a non-expression parameter value for inline display on the node. */
export function formatParamDisplay(
  param: Parameter,
  value: unknown,
  variables: Record<string, AvailableVariable>,
  channelLabels?: Record<string, string>,
  memoryLabels?: Record<string, string>,
  modelLabels?: Record<string, string>,
): ParamDisplayResult {
  switch (param.type) {
    case "variable-reference": {
      const ref = value as Reference | undefined;
      if (!ref?.varId) return { text: "" };
      const v = variables[refToLookupKey(ref)];
      return v ? { text: v.name } : { text: "unknown", isInvalid: true };
    }
    case "bool":
      return { text: (value as boolean) ? "true" : "false" };
    case "weekdays": {
      const days = value as string[] | undefined;
      return { text: !days?.length ? "every day" : days.join(", ") };
    }
    case "selection": {
      const option = param.options.find((o) => o.value === value);
      return { text: option?.label ?? String(value ?? "") };
    }
    case "memorySelect": {
      const memoryId = value as string | undefined;
      if (!memoryId) return { text: "" };
      return memoryLabels?.[memoryId] ? { text: memoryLabels[memoryId] } : { text: "unknown", isInvalid: true };
    }
    case "channelSelect": {
      const channelId = value as string | undefined;
      if (!channelId) return { text: "" };
      return channelLabels?.[channelId] ? { text: channelLabels[channelId] } : { text: "unknown", isInvalid: true };
    }
    case "modelSelect": {
      // A ModelID is human-meaningful (e.g. "claude-opus-4-7"); show the catalog/
      // custom label when known, otherwise the id itself. Staleness is surfaced
      // by diagnostics, not inline, since the catalog isn't available headlessly.
      const modelId = value as string | undefined;
      if (!modelId) return { text: "" };
      return { text: modelLabels?.[modelId] ?? modelId };
    }
    default:
      return { text: String(value ?? "") };
  }
}
