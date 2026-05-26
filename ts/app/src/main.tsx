import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Init the host's i18next instance before any component renders (so the toolbar
// paints in the persisted language on the first frame). This registers the host
// instance as react-i18next's default; the builder runs a private instance that
// deliberately does NOT touch that default, so the toolbar needs no provider.
import "./i18n";
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
