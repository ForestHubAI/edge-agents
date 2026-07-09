// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Ambient types for the File System Access API pickers, which TS does not ship in
// its default DOM lib. The app uses them to open/save workflow JSON straight to
// disk (App.tsx). FileSystemFileHandle / createWritable() / getFile() ARE in
// lib.dom, so we only augment the two missing pickers on Window.
interface Window {
  showSaveFilePicker(options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }): Promise<FileSystemFileHandle>;
  showOpenFilePicker(options?: {
    multiple?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }): Promise<FileSystemFileHandle[]>;
}
