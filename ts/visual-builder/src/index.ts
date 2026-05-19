// @foresthub/visual-builder — public entry point.
//
// SCAFFOLD. Headless React component package: the canvas/editor, exported
// as importable components. NO app shell, NO router, NO governance menu.
//
// Two peer consumers import THIS package directly (not via each other):
//   - the open standalone SPA  (the thinnest possible shell)
//   - the closed governance FE (wraps it with the proprietary menu)
//
// Validation comes from @foresthub/workflow-core — the builder never calls
// a governance backend to validate, so it stands alone offline.

export { validateWorkflow } from "@foresthub/workflow-core";

// export { WorkflowCanvas } from "./canvas.js"; // after FE extraction
