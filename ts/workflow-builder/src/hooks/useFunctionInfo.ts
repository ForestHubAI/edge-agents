import { useCallback } from "react";
import type { FunctionInfo, ApiVariable, NodeOutput } from "@foresthub/workflow-core/node";
import { ensureUid } from "@foresthub/workflow-core/variable";

/**
 * Hook for managing function info.
 */
export function useFunctionInfo(fn: FunctionInfo, onUpdate: (updates: FunctionInfo) => void) {
  const addArgument = useCallback(() => {
    const newParam: ApiVariable = ensureUid({
      name: `input${fn.arguments.length + 1}`,
      dataType: "string",
    });
    onUpdate({
      ...fn,
      arguments: [...fn.arguments, newParam],
    });
  }, [fn, onUpdate]);

  const addReturnValue = useCallback(() => {
    const newParam: ApiVariable = ensureUid({
      name: `output${fn.returns.length + 1}`,
      dataType: "string",
    });
    onUpdate({
      ...fn,
      returns: [...fn.returns, newParam],
    });
  }, [fn, onUpdate]);

  const updateArgument = useCallback(
    (index: number, updates: Partial<NodeOutput>) => {
      const existing = fn.arguments[index];
      if (!existing) return;
      const newArgs = [...fn.arguments];
      newArgs[index] = { ...existing, ...updates };
      onUpdate({ ...fn, arguments: newArgs });
    },
    [fn, onUpdate],
  );

  const updateReturnValue = useCallback(
    (index: number, updates: Partial<NodeOutput>) => {
      const existing = fn.returns[index];
      if (!existing) return;
      const newReturnValues = [...fn.returns];
      newReturnValues[index] = { ...existing, ...updates };
      onUpdate({ ...fn, returns: newReturnValues });
    },
    [fn, onUpdate],
  );

  const removeArgument = useCallback(
    (index: number) => {
      onUpdate({
        ...fn,
        arguments: fn.arguments.filter((_, i) => i !== index),
      });
    },
    [fn, onUpdate],
  );

  const removeReturnValue = useCallback(
    (index: number) => {
      onUpdate({
        ...fn,
        returns: fn.returns.filter((_, i) => i !== index),
      });
    },
    [fn, onUpdate],
  );

  return {
    addArgument,
    addReturnValue,
    updateArgument,
    updateReturnValue,
    removeArgument,
    removeReturnValue,
  };
}
