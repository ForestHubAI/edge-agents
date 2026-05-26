import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Pulls in the workflow-builder's full design system + tailwind layers.
import "@foresthubai/workflow-builder/styles/index.css";
// Host token overrides — imported AFTER the builder's CSS so they win by cascade.
// Inert by default (see the file); uncomment its rules to rebrand the builder.
import "./theme-overrides.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
