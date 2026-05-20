#!/usr/bin/env node
// Thin launcher that loads the TS source via tsx's programmatic API.
// Avoids a compile step — the CLI imports workflow-core source directly,
// which Node alone can't load.
import { tsImport } from "tsx/esm/api";

await tsImport("./index.ts", import.meta.url);
