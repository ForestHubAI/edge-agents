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
  dynamicOptions?: Array<{ value: string; label: string }>,
  channelLabels?: Record<string, string>,
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
    case "rag-collection": {
      const strVal = value as string | undefined;
      if (!strVal) return { text: "" };
      const option = dynamicOptions?.find((o) => o.value === strVal);
      return option ? { text: option.label } : { text: "unknown", isInvalid: true };
    }
    case "channelSelect": {
      const channelId = value as string | undefined;
      if (!channelId) return { text: "" };
      return channelLabels?.[channelId] ? { text: channelLabels[channelId] } : { text: "unknown", isInvalid: true };
    }
    default:
      return { text: String(value ?? "") };
  }
}
