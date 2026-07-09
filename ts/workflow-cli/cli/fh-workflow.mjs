#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Thin launcher that loads the TS source via tsx's programmatic API.
// Avoids a compile step — the CLI imports workflow-core source directly,
// which Node alone can't load.
import { tsImport } from "tsx/esm/api";

await tsImport("./index.ts", import.meta.url);
