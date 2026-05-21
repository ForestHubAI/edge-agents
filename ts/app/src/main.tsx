import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Pulls in the workflow-builder's full design system + tailwind layers.
import "@foresthub/workflow-builder/styles/index.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
