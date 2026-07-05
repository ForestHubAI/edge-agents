// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { NodeDefinition, NodeData } from "../node";
import type { Expression } from "../api";
import { NodeCategory, NodeRegistry } from "../node";
import type { EdgeData, EdgeType } from "../edge";
import { getEdgeDefinition, isControlFlow } from "../edge";
import { getArguments, getNodeAvailableOutput, getOutputBinding, getPorts, isNodeUsedAsTool } from "../node/methods";
import type { Edge } from "../edge";
import type { Variable } from "../variable";
import { computeAvailableVariables, refToLookupKey } from "../variable";
import { isExpression, resolveExpression } from "../expression/types";
import { parseExpression } from "../expression/parser";
import { isParameterActive, isEmpty, resolveExpressionType, resolveChannelTypes, resolveMemoryTypes, resolveModelTypes } from "../parameter";
import type { ExpressionParam, ChannelSelectParam, MemorySelectParam, ModelSelectParam, OutputDeclaration } from "../parameter";
import type { Channel } from "../channel";
import { CHANNEL_DEFINITION } from "../channel";
import type { Memory } from "../memory";
import { MemoryRegistry } from "../memory";
import type { Model } from "../model";
import { ModelRegistry } from "../model";
import type { Schemas } from "../api";
import type { Reference } from "../api";
import { FunctionCallNode, buildFunctionNodeDef } from "../node/FunctionNode";
import type { FunctionDeclaration, FunctionInfo, OutputAssignment } from "../function";
import { toFunctionInfo } from "../function";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "../workflow/Workflow";

// ============================================================================
// Types
// ============================================================================

export type DiagnosticSeverity = "error" | "warning";

export type DiagnosticCategory =
  | "missing-required-param"
  | "invalid-expression"
  | "invalid-reference"
  | "function-deleted"
  | "function-stale"
  | "unconnected-input"
  | "unconnected-output"
  | "tool-not-connected"
  | "missing-output-assignment"
  | "assign-type-mismatch"
  | "duplicate-output-name";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  category: DiagnosticCategory;
  message: string;
  /** Canvas this diagnostic belongs to. Omitted for project-scoped sources (e.g. channels). */
  canvasId?: string;
  nodeId?: string;
  edgeId?: string;
  /** Set when the diagnostic targets a project-scoped channel. */
  channelId?: string;
  /** Set when the diagnostic targets a project-scoped memory primitive. */
  memoryId?: string;
  /** Set when the diagnostic targets a project-scoped declared model. */
  modelId?: string;
  /** Set when the diagnostic targets a project-scoped function declaration. */
  functionId?: string;
  paramId?: string;
  outputId?: string; // For output binding diagnostics
}

/**
 * Compute diagnostics for a single node.
 */
export function computeNodeDiagnostics(opts: {
  canvasId: string;
  nodeId: string;
  nodeData: NodeData;
  nodeDefinition: NodeDefinition | undefined;
  availableVariables: Record<string, Variable>;
  channels: Record<string, Channel>;
  memory?: Record<string, Memory>;
  /** Declared custom models (project-scoped). */
  models?: Record<string, Model>;
  /** Ids in the static model catalog (props-supplied). Undefined headlessly — catalog ids then aren't flagged. */
  availableModelIds?: Set<string>;
  edges: readonly Edge[];
  isStale?: boolean;
  isDeleted?: boolean;
}): Diagnostic[] {
  const {
    canvasId,
    nodeId,
    nodeData,
    nodeDefinition,
    availableVariables,
    channels,
    memory,
    models,
    availableModelIds,
    edges,
    isStale = false,
    isDeleted = false,
  } = opts;

  const diags: Diagnostic[] = [];

  // --- Function-specific diagnostics ---
  if (isDeleted) {
    diags.push({
      severity: "error",
      category: "function-deleted",
      canvasId,
      nodeId,
      message: "Function has been deleted. Remove this node.",
    });
  } else if (isStale) {
    diags.push({
      severity: "warning",
      category: "function-stale",
      canvasId,
      nodeId,
      message: "Function definition has changed. Please update this node.",
    });
  }

  if (!nodeDefinition) return diags;

  const portDefinitions = getPorts(nodeData);
  const parameters = getArguments(nodeData);
  const usedAsToolInput = isNodeUsedAsTool(nodeId, nodeData, edges);

  // --- Parameter diagnostics ---
  for (const param of nodeDefinition.parameters) {
    if (!isParameterActive(param, parameters, usedAsToolInput)) continue;
    const value = parameters[param.id];

    // invalid-expression (skip empty — caught by missing-required-param)
    if (isExpression(value) && value.expression) {
      const expr = resolveExpression(value, availableVariables);
      // Resolve expressionType (static, args-only lambda, or derived from a referenced variable)
      if (param.type === "expression") {
        expr.expectedType = resolveExpressionType(param as ExpressionParam, parameters, availableVariables);
      }
      const parseRes = parseExpression(expr);
      if (!parseRes.isValid) {
        diags.push({
          severity: "error",
          category: "invalid-expression",
          canvasId,
          nodeId,
          paramId: param.id,
          message: `Invalid expression for "${param.label}": ${parseRes.errors.join(", ")}`,
        });
      }
    }

    // missing-required-param
    if (!param.optional) {
      const isEmptyExpression = isExpression(value) && !value.expression;
      const isEmptyReference =
        param.type === "variableSelect" &&
        (!value || (typeof value === "object" && value !== null && !(value as { varId?: string }).varId));
      if (isEmpty(value) || isEmptyExpression || isEmptyReference) {
        diags.push({
          severity: "error",
          category: "missing-required-param",
          canvasId,
          nodeId,
          paramId: param.id,
          message: `Missing required parameter "${param.label}"`,
        });
      }
    }

    // invalid-reference: variableSelect points to deleted variable
    if (param.type === "variableSelect" && value) {
      const ref = value as Reference;
      if (ref.varId) {
        const key = refToLookupKey(ref);
        if (!availableVariables[key]) {
          diags.push({
            severity: "error",
            category: "invalid-reference",
            canvasId,
            nodeId,
            paramId: param.id,
            message: `"${param.label}" references a deleted variable`,
          });
        }
      }
    }

    // invalid-reference: channelSelect points to deleted or incompatible channel
    if (param.type === "channelSelect" && value) {
      const channelId = value as string;
      const channel = Object.values(channels).find((v) => v.id === channelId);
      if (!channel) {
        diags.push({
          severity: "error",
          category: "invalid-reference",
          canvasId,
          nodeId,
          paramId: param.id,
          message: `"${param.label}" references a deleted channel`,
        });
      } else {
        const channelParam = param as ChannelSelectParam;
        const allowedTypes = resolveChannelTypes(channelParam, parameters);
        if (!allowedTypes.includes(channel.type)) {
          diags.push({
            severity: "error",
            category: "invalid-reference",
            canvasId,
            nodeId,
            paramId: param.id,
            message: `"${param.label}" references "${channel.label}" (${channel.type}), which is not a compatible channel type`,
          });
        }
      }
    }

    // invalid-reference: memory-refs entries point to deleted memory files
    if (param.type === "memory-refs" && Array.isArray(value) && memory) {
      const refs = value as Schemas["MemoryRef"][];
      const knownIds = new Set(
        Object.values(memory)
          .filter((m) => m.type === "MemoryFile")
          .map((m) => m.id),
      );
      const missing = refs.filter((r) => !r.id || !knownIds.has(r.id));
      if (missing.length > 0) {
        diags.push({
          severity: "error",
          category: "invalid-reference",
          canvasId,
          nodeId,
          paramId: param.id,
          message: `"${param.label}" references ${missing.length} deleted memory file${missing.length === 1 ? "" : "s"}`,
        });
      }
    }

    // invalid-reference: memorySelect points to deleted or incompatible memory
    if (param.type === "memorySelect" && value && memory) {
      const memoryId = value as string;
      const mem = Object.values(memory).find((m) => m.id === memoryId);
      if (!mem) {
        diags.push({
          severity: "error",
          category: "invalid-reference",
          canvasId,
          nodeId,
          paramId: param.id,
          message: `"${param.label}" references a deleted memory`,
        });
      } else {
        const memoryParam = param as MemorySelectParam;
        const allowedTypes = resolveMemoryTypes(memoryParam, parameters);
        if (!allowedTypes.includes(mem.type)) {
          diags.push({
            severity: "error",
            category: "invalid-reference",
            canvasId,
            nodeId,
            paramId: param.id,
            message: `"${param.label}" references "${mem.label}" (${mem.type}), which is not a compatible memory type`,
          });
        }
      }
    }

    // invalid-reference: modelSelect points to a deleted custom model or unknown catalog id
    if (param.type === "modelSelect" && value && models) {
      const modelId = value as string;
      const custom = Object.values(models).find((m) => m.id === modelId);
      if (custom) {
        const modelParam = param as ModelSelectParam;
        const allowedTypes = resolveModelTypes(modelParam, parameters);
        if (!allowedTypes.includes(custom.type)) {
          diags.push({
            severity: "error",
            category: "invalid-reference",
            canvasId,
            nodeId,
            paramId: param.id,
            message: `"${param.label}" references "${custom.label}" (${custom.type}), which is not a compatible model type`,
          });
        }
      } else if (availableModelIds && !availableModelIds.has(modelId)) {
        // Not a declared custom model and not in the supplied catalog → stale.
        // Headlessly (no catalog) static ids can't be verified, so we don't flag.
        diags.push({
          severity: "error",
          category: "invalid-reference",
          canvasId,
          nodeId,
          paramId: param.id,
          message: `"${param.label}" references a deleted model`,
        });
      }
    }
  }

  // --- Output binding diagnostics (skip when node is used as tool — outputs are scoped out) ---
  if (!usedAsToolInput) {
    const availableOutput = getNodeAvailableOutput(nodeData);
    for (const outputId of Object.keys(availableOutput)) {
      const binding = getOutputBinding(nodeData, outputId);
      // Inactive bindings are discarded — nothing to validate.
      if (!binding || !binding.active || binding.mode !== "assign") continue;

      const outputDef = availableOutput[outputId];
      if (!binding.target.srcId) {
        diags.push({
          severity: "error",
          category: "assign-type-mismatch",
          canvasId,
          nodeId,
          outputId,
          message: `Output "${outputDef?.name ?? outputId}" has no variable selected`,
        });
        continue;
      }
      const key = refToLookupKey(binding.target);
      const targetVar = availableVariables[key];
      if (!targetVar) {
        diags.push({
          severity: "error",
          category: "assign-type-mismatch",
          canvasId,
          nodeId,
          outputId,
          message: `Output "${outputDef?.name ?? outputId}" assigns to a deleted variable`,
        });
      } else if (outputDef && targetVar.dataType !== outputDef.dataType) {
        diags.push({
          severity: "error",
          category: "assign-type-mismatch",
          canvasId,
          nodeId,
          outputId,
          message: `Output "${outputDef.name}" (${outputDef.dataType}) cannot assign to "${targetVar.name}" (${targetVar.dataType})`,
        });
      }
    }

    // --- List-output declaration diagnostics ---
    // Walk each list-output entry. Two layers of validation:
    //  1. Per-entry: name non-empty, assign target valid + type-compatible.
    //  2. Per-list: names unique within the list — the `name` field doubles as the
    //     JSON property name in the LLM's structured response, so duplicates would
    //     silently collide. Required for both modes (emit and assign).
    const listOutputs = (nodeDefinition.outputs ?? []).filter((o) => o.type === "list");
    for (const out of listOutputs) {
      const entries = ((nodeData.arguments as Record<string, unknown>)[out.id] as OutputDeclaration[] | undefined) ?? [];

      // Build a name → indices map up-front; flag duplicates and empties on a per-entry basis.
      const nameToIndices = new Map<string, number[]>();
      entries.forEach((entry, index) => {
        const arr = nameToIndices.get(entry.name);
        if (arr) arr.push(index);
        else nameToIndices.set(entry.name, [index]);
      });

      entries.forEach((entry, index) => {
        const outputId = `${out.id}[${index}]`;

        // missing name (both modes)
        if (!entry.name || entry.name.trim() === "") {
          diags.push({
            severity: "error",
            category: "missing-required-param",
            canvasId,
            nodeId,
            outputId,
            message: `${out.label} entry #${index + 1} has no name`,
          });
        } else {
          const collisions = nameToIndices.get(entry.name) ?? [];
          if (collisions.length > 1) {
            diags.push({
              severity: "error",
              category: "duplicate-output-name",
              canvasId,
              nodeId,
              outputId,
              message: `${out.label} entry #${index + 1} has duplicate name "${entry.name}"`,
            });
          }
        }

        if (entry.mode !== "assign") return;
        // Use a synthetic outputId: `<listId>[<index>]`. Stable per-position, surfaces the
        // error on the node badge. (ListOutputSection could light up individual rows from
        // this key in a follow-up.)
        if (!entry.target.srcId) {
          diags.push({
            severity: "error",
            category: "assign-type-mismatch",
            canvasId,
            nodeId,
            outputId,
            message: `${out.label} entry #${index + 1} has no variable selected`,
          });
          return;
        }
        const key = refToLookupKey(entry.target);
        const targetVar = availableVariables[key];
        if (!targetVar) {
          diags.push({
            severity: "error",
            category: "assign-type-mismatch",
            canvasId,
            nodeId,
            outputId,
            message: `${out.label} entry #${index + 1} assigns to a deleted variable`,
          });
        } else if (targetVar.dataType !== entry.dataType) {
          diags.push({
            severity: "error",
            category: "assign-type-mismatch",
            canvasId,
            nodeId,
            outputId,
            message: `${out.label} entry #${index + 1} (${entry.dataType}) cannot assign to "${targetVar.name}" (${targetVar.dataType})`,
          });
        }
      });
    }
  }

  // --- Port connectivity diagnostics ---
  const controlInputs = portDefinitions.input.filter((p) => p.type === "control");
  const toolInputPorts = portDefinitions.input.filter((p) => p.type === "tool");
  const controlOutputs = portDefinitions.output.filter((p) => p.type === "control");
  const connectedTargetHandles = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.targetHandle));
  const connectedSourceHandles = new Set(edges.filter((e) => e.source === nodeId).map((e) => e.sourceHandle));

  // Check unconnected control inputs (applies to ALL nodes that have them)
  if (controlInputs.length > 0) {
    if (usedAsToolInput) {
      for (const port of toolInputPorts) {
        if (!connectedTargetHandles.has(port.id)) {
          diags.push({
            severity: "warning",
            category: "unconnected-input",
            canvasId,
            nodeId,
            message: `Node is not connected and will never run`,
          });
        }
      }
    } else {
      for (const port of controlInputs) {
        if (!connectedTargetHandles.has(port.id)) {
          diags.push({
            severity: "warning",
            category: "unconnected-input",
            canvasId,
            nodeId,
            message: `Node is not connected and will never run`,
          });
        }
      }
    }
  } else if (toolInputPorts.length > 0) {
    // Tool-only input nodes (e.g. WebSearchTool)
    const hasAnyConnection = toolInputPorts.some((p) => connectedTargetHandles.has(p.id));
    if (!hasAnyConnection) {
      diags.push({
        severity: "warning",
        category: "tool-not-connected",
        canvasId,
        nodeId,
        message: `"${nodeDefinition.label}" is not connected to an agent`,
      });
    }
  }

  // Check unconnected control outputs (triggers only — they are entry points that must lead somewhere)
  if (controlOutputs.length > 0 && nodeDefinition.category === NodeCategory.Trigger) {
    for (const port of controlOutputs) {
      if (!connectedSourceHandles.has(port.id)) {
        diags.push({
          severity: "warning",
          category: "unconnected-output",
          canvasId,
          nodeId,
          message: `"${nodeDefinition.label}" has no outgoing connection — nothing will run after it`,
        });
      }
    }
  }

  return diags;
}

/**
 * Compute diagnostics for a single edge. Extracted from CustomEdge's useMemo.
 */
export function computeEdgeDiagnostics(opts: {
  canvasId: string;
  edgeId: string;
  edgeType: EdgeType;
  edgeData: EdgeData | undefined;
  availableVariables: Record<string, Variable>;
  sourceControlEdgeCount: number;
}): Diagnostic[] {
  const { canvasId, edgeId, edgeType, edgeData, availableVariables, sourceControlEdgeCount } = opts;
  const diags: Diagnostic[] = [];
  const def = getEdgeDefinition(edgeType);
  if (def.parameters.length === 0) return diags;

  const isBranching = sourceControlEdgeCount > 1;

  for (const param of def.parameters) {
    // Description is optional on agent output edges when not branching
    if (param.id === "description" && !isBranching && (edgeType === "agentChoice" || edgeType === "agentDelegate")) {
      continue;
    }

    const value = edgeData?.[param.id];

    if (param.type === "expression") {
      const exprValue = value as Expression | undefined;
      if (!exprValue?.expression) {
        diags.push({
          severity: "error",
          category: "missing-required-param",
          canvasId,
          edgeId,
          paramId: param.id,
          message: `Missing required parameter "${param.label}" on edge`,
        });
        continue;
      }
      if (isExpression(exprValue)) {
        const expr = resolveExpression(exprValue, availableVariables);
        const parseRes = parseExpression(expr);
        if (!parseRes.isValid) {
          diags.push({
            severity: "error",
            category: "invalid-expression",
            canvasId,
            edgeId,
            paramId: param.id,
            message: `Invalid expression for "${param.label}": ${parseRes.errors.join(", ")}`,
          });
        }
      }
    } else {
      if (!value) {
        diags.push({
          severity: "error",
          category: "missing-required-param",
          canvasId,
          edgeId,
          paramId: param.id,
          message: `Missing required parameter "${param.label}" on edge`,
        });
      }
    }
  }

  return diags;
}

/**
 * Compute diagnostics for a single channel. Mirrors the parameter loop
 * from computeNodeDiagnostics: filter to active params (per the type
 * discriminator), then required-check each. Empty label is also flagged so
 * the user has a non-blank name in `channelSelect` dropdowns.
 */
export function validateChannel(channel: Channel): Diagnostic[] {
  const diags: Diagnostic[] = [];

  if (!channel.label || channel.label.trim() === "") {
    diags.push({
      severity: "error",
      category: "missing-required-param",
      channelId: channel.id,
      message: `Channel has no label`,
    });
  }

  // `type` is mirrored into the args record so activation rules can read it.
  const args: Record<string, unknown> = { ...channel.arguments, type: channel.type };
  for (const param of CHANNEL_DEFINITION.parameters) {
    if (param.id === "type") continue; // top-level discriminator, always set
    if (!isParameterActive(param, args, false)) continue;
    if (param.optional) continue;

    const value = channel.arguments[param.id];
    if (isEmpty(value)) {
      diags.push({
        severity: "error",
        category: "missing-required-param",
        channelId: channel.id,
        paramId: param.id,
        message: `Missing required parameter "${param.label}" on channel "${channel.label}"`,
      });
    }
  }

  return diags;
}

/**
 * Compute diagnostics for a single memory primitive. Mirrors validateChannel:
 * an empty label is flagged (so memorySelect/memory-refs dropdowns have a
 * non-blank name), then each required parameter for the memory's type is checked.
 */
export function validateMemory(mem: Memory): Diagnostic[] {
  const diags: Diagnostic[] = [];

  if (!mem.label || mem.label.trim() === "") {
    diags.push({
      severity: "error",
      category: "missing-required-param",
      memoryId: mem.id,
      message: `Memory has no label`,
    });
  }

  const def = MemoryRegistry.getByType(mem.type);
  for (const param of def?.parameters ?? []) {
    if (!isParameterActive(param, mem.arguments, false)) continue;
    if (param.optional) continue;

    const value = mem.arguments[param.id];
    if (isEmpty(value)) {
      diags.push({
        severity: "error",
        category: "missing-required-param",
        memoryId: mem.id,
        paramId: param.id,
        message: `Missing required parameter "${param.label}" on memory "${mem.label}"`,
      });
    }
  }

  return diags;
}

/**
 * Compute diagnostics for a single declared (custom) model. Mirrors
 * validateMemory: an empty label is flagged, then each required parameter for
 * the model's type is checked (LLMModel has none today, so this is label-only).
 */
export function validateModel(model: Model): Diagnostic[] {
  const diags: Diagnostic[] = [];

  if (!model.label || model.label.trim() === "") {
    diags.push({
      severity: "error",
      category: "missing-required-param",
      modelId: model.id,
      message: `Model has no label`,
    });
  }

  const def = ModelRegistry.getByType(model.type);
  for (const param of def?.parameters ?? []) {
    if (!isParameterActive(param, model.arguments, false)) continue;
    if (param.optional) continue;

    const value = model.arguments[param.id];
    if (isEmpty(value)) {
      diags.push({
        severity: "error",
        category: "missing-required-param",
        modelId: model.id,
        paramId: param.id,
        message: `Missing required parameter "${param.label}" on model "${model.label}"`,
      });
    }
  }

  return diags;
}

/**
 * Validate a function's bundled output assignments, keyed by `outputId` so a caller
 * can ring the specific row. The single home for this logic — shared by the live
 * config panel, the project-scoped {@link validateFunction}, and the full
 * {@link validateWorkflowState}.
 *
 * Without `availableVariables` (no body scope) it can only flag a *missing*
 * expression (the engine-invariant check). Given the body's variables it also
 * resolves + parses each expression, catching invalid references and type mismatches
 * — the same `resolveExpression`/`parseExpression` path node expression params use.
 */
export function validateFunctionOutputs(
  outputs: readonly OutputAssignment[],
  availableVariables?: Record<string, Variable>,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const out of outputs) {
    const text = out.expression?.expression;
    if (!text || text.trim() === "") {
      diags.push({
        severity: "error",
        category: "missing-output-assignment",
        outputId: out.uid,
        message: `Missing return value assignment for "${out.name}"`,
      });
    } else if (availableVariables) {
      const parseRes = parseExpression(resolveExpression(out.expression, availableVariables));
      if (!parseRes.isValid) {
        diags.push({
          severity: "error",
          category: "invalid-expression",
          outputId: out.uid,
          message: `Invalid expression for "${out.name}": ${parseRes.errors.join(", ")}`,
        });
      }
    }
  }
  return diags;
}

/**
 * Compute diagnostics for a single function declaration (the project-scoped
 * signature + bundled output assignments, independent of the body canvas). Flags an
 * empty name and any output without an assigned expression. Expression *validity*
 * (which needs the body's variable scope) is left to the scoped callers — the config
 * panel and validateWorkflowState (keyed by the function's canvas).
 */
export function validateFunction(fn: FunctionDeclaration, availableVariables?: Record<string, Variable>): Diagnostic[] {
  const diags: Diagnostic[] = [];

  if (!fn.name || fn.name.trim() === "") {
    diags.push({
      severity: "error",
      category: "missing-required-param",
      functionId: fn.id,
      message: `Function has no name`,
    });
  }

  // Pass the body scope through when the caller has it (the sidebar sync supplies the
  // function's canvas variables) so invalid/typed expressions surface too, not just
  // missing ones. Tag with functionId for the sidebar list ring / tab badge.
  for (const d of validateFunctionOutputs(fn.outputs, availableVariables)) diags.push({ ...d, functionId: fn.id });

  return diags;
}

// ============================================================================
// Full-Project Validation Result Types
// ============================================================================

export interface CanvasValidationResult {
  canvasId: string;
  canvasLabel: string;
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
}

export interface ValidationResult {
  canvases: CanvasValidationResult[];
  /** Project-scoped channel diagnostics (no canvasId). */
  channelDiagnostics: Diagnostic[];
  /** Project-scoped memory diagnostics (no canvasId). */
  memoryDiagnostics: Diagnostic[];
  /** Project-scoped declared-model diagnostics (no canvasId). */
  modelDiagnostics: Diagnostic[];
  totalErrors: number;
  totalWarnings: number;
}

/**
 * Derive the function registry from a snapshot's canvases. Mirrors
 * `computeAllFunctions()` in useFunctionRegistry exactly: every non-main
 * canvas that carries a `functionInfo` is a function, keyed by canvas id
 * (which equals the function id by invariant).
 *
 * Deriving from the snapshot rather than the module-level cache makes
 * validation deterministic from its input alone — and removes the cache-lag
 * window the store-bound path had.
 */
function deriveFunctionRegistry(functions: Record<string, FunctionDeclaration>): Record<string, FunctionInfo> {
  const out: Record<string, FunctionInfo> = {};
  for (const [id, decl] of Object.entries(functions)) out[id] = toFunctionInfo(decl);
  return out;
}

/**
 * Headless full-project validation. Pure: depends only on the passed
 * {@link Workflow} (the in-memory domain shape) — no Zustand stores, no
 * React, no DOM. Runnable in Node, a CLI, or a Claude Code skill.
 *
 * Two producers feed this: the editor reads its live stores into a
 * `Workflow` literal; the CLI calls `deserialize(apiWorkflow)` from
 * `../workflow/serialization` to convert the api JSON into this shape.
 */
export function validateWorkflowState(state: Workflow): ValidationResult {
  const canvasData = state.canvases ?? {};
  const functionDecls = state.functions ?? {};
  const allFunctions = deriveFunctionRegistry(functionDecls);
  const channels = state.channels ?? {};
  const memory = state.memory ?? {};
  const models = state.models ?? {};

  const canvases: CanvasValidationResult[] = [];
  let totalErrors = 0;
  let totalWarnings = 0;

  for (const [canvasId, canvas] of Object.entries(canvasData)) {
    const { nodes, edges } = canvas;

    // Each canvas is fully self-contained — function canvases do not see main-canvas variables.
    const { lookup: availableVariables } = computeAvailableVariables(canvas.variables, edges);

    const canvasDiags: Diagnostic[] = [];

    // Compute node diagnostics
    for (const node of nodes) {
      const nodeData = node;

      // Resolve node definition
      let nodeDefinition: NodeDefinition | undefined;
      let isStale = false;
      let isDeleted = false;

      if (nodeData.type === "FunctionCall") {
        const fnNode = nodeData as FunctionCallNode;
        const registryFn = allFunctions[fnNode.functionInfo.id];
        isDeleted = !registryFn;
        isStale = registryFn ? fnNode.functionInfo.version !== registryFn.version : false;
        if (registryFn) {
          nodeDefinition = buildFunctionNodeDef(registryFn) as NodeDefinition;
        } else {
          nodeDefinition = buildFunctionNodeDef(fnNode.functionInfo) as NodeDefinition;
        }
      } else {
        nodeDefinition = NodeRegistry.getByType(nodeData.type);
      }

      const diags = computeNodeDiagnostics({
        canvasId,
        nodeId: node.id,
        nodeData,
        nodeDefinition,
        availableVariables,
        channels,
        memory,
        models,
        edges,
        isStale,
        isDeleted,
      });

      canvasDiags.push(...diags);
    }

    // Compute edge diagnostics
    const sourceControlCounts = new Map<string, number>();
    for (const edge of edges) {
      if (isControlFlow(edge.type as EdgeType)) {
        sourceControlCounts.set(edge.source, (sourceControlCounts.get(edge.source) ?? 0) + 1);
      }
    }

    for (const edge of edges) {
      const edgeType = (edge.type ?? "control") as EdgeType;
      const diags = computeEdgeDiagnostics({
        canvasId,
        edgeId: edge.id,
        edgeType,
        edgeData: edge.data,
        availableVariables,
        sourceControlEdgeCount: sourceControlCounts.get(edge.source) ?? 0,
      });

      canvasDiags.push(...diags);
    }

    // Output assignment diagnostics: the function's declaration (functions[canvasId])
    // owns the bundled outputs; their expressions resolve against this body's scope.
    const fnDecl = functionDecls[canvasId];
    if (fnDecl) {
      for (const d of validateFunctionOutputs(fnDecl.outputs, availableVariables)) {
        canvasDiags.push({ ...d, canvasId });
      }
    }

    // Only include canvases with issues
    if (canvasDiags.length > 0) {
      const errorCount = canvasDiags.filter((d) => d.severity === "error").length;
      const warningCount = canvasDiags.filter((d) => d.severity === "warning").length;

      // Derive canvas label
      const canvasLabel = canvasId === MAIN_CANVAS_ID ? "Main" : (functionDecls[canvasId]?.name ?? canvasId);

      canvases.push({
        canvasId,
        canvasLabel,
        diagnostics: canvasDiags,
        errorCount,
        warningCount,
      });

      totalErrors += errorCount;
      totalWarnings += warningCount;
    }
  }

  // Project-scoped channel diagnostics — independent of canvas iteration.
  const channelDiagnostics: Diagnostic[] = [];
  for (const channel of Object.values(channels)) {
    channelDiagnostics.push(...validateChannel(channel));
  }
  for (const d of channelDiagnostics) {
    if (d.severity === "error") totalErrors++;
    else totalWarnings++;
  }

  // Project-scoped memory diagnostics — independent of canvas iteration.
  const memoryDiagnostics: Diagnostic[] = [];
  for (const mem of Object.values(memory)) {
    memoryDiagnostics.push(...validateMemory(mem));
  }
  for (const d of memoryDiagnostics) {
    if (d.severity === "error") totalErrors++;
    else totalWarnings++;
  }

  // Project-scoped declared-model diagnostics — independent of canvas iteration.
  const modelDiagnostics: Diagnostic[] = [];
  for (const model of Object.values(models)) {
    modelDiagnostics.push(...validateModel(model));
  }
  for (const d of modelDiagnostics) {
    if (d.severity === "error") totalErrors++;
    else totalWarnings++;
  }

  return { canvases, channelDiagnostics, memoryDiagnostics, modelDiagnostics, totalErrors, totalWarnings };
}
