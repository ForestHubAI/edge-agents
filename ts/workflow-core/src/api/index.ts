export type { components } from "./workflow";

import type { components } from "./workflow";
export type Schemas = components["schemas"];

// Api-layer type aliases used across the domain. They live here (not in any
// single domain module) so modules don't cross-import them; consumers pull
// them from the package root (`@foresthubai/workflow-core`).
export type DataType = Schemas["DataType"];
export type Reference = Schemas["Reference"];
export type Expression = Schemas["Expression"];
