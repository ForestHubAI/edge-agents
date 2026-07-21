// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// The static LLM model catalog — a SNAPSHOT mirror of the engine's llmproxy
// (`go/llmproxy/provider/*/AvailableModels`), which is the single source of truth.
// Kept here because the OSS deploy CLI is headless/offline and has no running
// llmproxy to query, yet must resolve referenced model ids to their provider to
// derive which API keys a workflow needs. `provider` values are the llmproxy
// ProviderID (capitalized) — they flow verbatim into `directLlm.provider`, so the
// engine matches them against its adapter ids.
//
// KEEP IN SYNC with the Go `AvailableModels` vars. Drift is caught at deploy by
// the engine's `validateModelsResolvable` (a referenced model no provider serves
// fails the build), so a stale snapshot fails loud, not silent.

import type { ModelInfo } from "@foresthubai/workflow-core/model";

export const MODEL_CATALOG: ModelInfo[] = [
  // Anthropic — go/llmproxy/provider/anthropic
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", capabilities: ["chat"], provider: "Anthropic" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", capabilities: ["chat"], provider: "Anthropic" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", capabilities: ["chat"], provider: "Anthropic" },

  // OpenAI — go/llmproxy/provider/openai
  { id: "gpt-5.4", label: "GPT-5.4", capabilities: ["chat"], provider: "OpenAI" },
  { id: "gpt-5.2", label: "GPT-5.2", capabilities: ["chat"], provider: "OpenAI" },
  { id: "gpt-5.1", label: "GPT-5.1", capabilities: ["chat"], provider: "OpenAI" },
  { id: "gpt-5", label: "GPT-5", capabilities: ["chat"], provider: "OpenAI" },
  { id: "gpt-5-mini", label: "GPT-5 Mini", capabilities: ["chat"], provider: "OpenAI" },
  { id: "gpt-5-nano", label: "GPT-5 Nano", capabilities: ["chat"], provider: "OpenAI" },
  { id: "gpt-4.1-nano", label: "GPT-4.1 Nano", capabilities: ["chat"], provider: "OpenAI" },
  { id: "text-embedding-3-small", label: "text-embedding-3-small (OpenAI)", capabilities: ["embedding"], provider: "OpenAI" },
  { id: "text-embedding-3-large", label: "text-embedding-3-large (OpenAI)", capabilities: ["embedding"], provider: "OpenAI" },

  // Gemini — go/llmproxy/provider/gemini
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", capabilities: ["chat"], provider: "Gemini" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", capabilities: ["chat"], provider: "Gemini" },
  { id: "gemini-embedding-001", label: "Gemini Embedding 001", capabilities: ["embedding"], provider: "Gemini" },

  // Mistral — go/llmproxy/provider/mistral
  { id: "mistral-large-latest", label: "Mistral Large", capabilities: ["chat"], provider: "Mistral" },
  { id: "mistral-medium-latest", label: "Mistral Medium", capabilities: ["chat"], provider: "Mistral" },
  { id: "mistral-small-latest", label: "Mistral Small", capabilities: ["chat"], provider: "Mistral" },
  { id: "ministral-8b-latest", label: "Ministral 8B", capabilities: ["chat"], provider: "Mistral" },
  { id: "ministral-3b-latest", label: "Ministral 3B", capabilities: ["chat"], provider: "Mistral" },
  { id: "pixtral-large-latest", label: "Pixtral Large", capabilities: ["chat"], provider: "Mistral" },
  { id: "codestral-latest", label: "Codestral", capabilities: ["chat"], provider: "Mistral" },
  { id: "mistral-embed", label: "Mistral Embed", capabilities: ["embedding"], provider: "Mistral" },
];

// The distinct catalog provider ids, in first-seen order. These are the llmproxy
// ProviderIDs a deploy may need a key for.
export const PROVIDER_IDS: string[] = [...new Set(MODEL_CATALOG.map((m) => m.provider))];

// The CLI key flag for a provider is its id lowercased (`Anthropic` → `anthropic`).
export const providerFlag = (id: string): string => id.toLowerCase();

// Resolve a flag-name (lowercase) back to the catalog provider id, or undefined.
export const providerFromFlag = (flag: string): string | undefined =>
  PROVIDER_IDS.find((id) => providerFlag(id) === flag);
