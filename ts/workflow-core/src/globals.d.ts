// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

/**
 * This package drops the `DOM` lib (see tsconfig.json) to stay headless, so the
 * Web Crypto `crypto` global is untyped. It exists at runtime everywhere we run
 * — browsers, Node >= 19, Deno, Bun — so we declare only the one member we use
 * rather than pulling in `DOM` or `@types/node` and their global scope.
 */
declare const crypto: {
  randomUUID(): `${string}-${string}-${string}-${string}-${string}`;
};
