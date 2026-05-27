// Presentation-only formatters for inline node display. These render domain
// values to human-readable text; they live in the builder (not headless
// workflow-core) because formatting for display is an editor concern.
import type { Parameter } from "@foresthubai/workflow-core/parameter";
import type { Reference } from "@foresthubai/workflow-core";
import { refToLookupKey, type Variable } from "@foresthubai/workflow-core/variable";
import type { ResolvedExpr } from "@foresthubai/workflow-core/expression";

export interface ParamDisplayResult {
  text: string;
  isInvalid?: boolean;
}

/** Format a non-expression parameter value for inline display on the node. */
export function formatParamDisplay(
  param: Parameter,
  value: unknown,
  variables: Record<string, Variable>,
  channelLabels?: Record<string, string>,
  memoryLabels?: Record<string, string>,
  modelLabels?: Record<string, string>,
): ParamDisplayResult {
  switch (param.type) {
    case "variableSelect": {
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

/** Format an expression for display by replacing variable-reference placeholders with their names. */
export function displayValue(expr: ResolvedExpr): string {
  let result = expr.expression;
  // Replace each variable reference placeholder with its name
  expr.variables.forEach((variable) => {
    result = result.replace(/\$\{\}/, variable?.name || "unknown");
  });
  return result;
}
