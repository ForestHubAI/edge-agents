import { Expression, FunctionInfo, NodeBase, OutputBinding } from ".";
import { NodeDefinition } from "./NodeDefinition";

// Function Call Node - invokes a user-defined function.
// Arguments are flat — keyed by Variable uid. Input argument uids map to Expression,
// return uids map to OutputBinding. Same shape as every other node, so the rest of
// the system (parameter editors, output bindings, merge/update) treats FunctionCall
// uniformly. Outputs are derived on-the-fly via buildFunctionNodeDef from
// functionInfo.returns — there is no registered NodeDefinition.
export interface FunctionCallNode extends NodeBase {
  type: "FunctionCall";
  functionInfo: FunctionInfo; // Snapshot at creation; may be stale vs registry
  // Flat bag keyed by Variable uid (Expression for args, OutputBinding for returns),
  // plus the reserved `toolDescription` key (string) for the tool-mode parameter.
  arguments: Record<string, Expression | OutputBinding | string>;
}

export type FunctionCallNodeType = "FunctionCall";

// FunctionNodeDefinition extends NodeDefinition with function-specific fields
// Used by NodeLibrary to create new FunctionCall nodes
export interface FunctionNodeDefinition extends NodeDefinition {
  type: "FunctionCall";
  functionInfo: FunctionInfo; // Metadata about the function being called
}
