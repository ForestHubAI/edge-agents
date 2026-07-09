// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { StateCreator, StoreMutatorIdentifier } from "zustand";

// Opaque type for exporting/importing history state
export interface HistoryData {
  past: HistoryFrame<unknown>[];
  future: HistoryFrame<unknown>[];
}

// Public interface - only actions
export interface History {
  /**
   * Manually saves the current state as an undo checkpoint.
   * Must be called BEFORE a state change that should be undoable.
   */
  takeCheckpoint: () => void;

  /**
   * Run the given operation and save a checkpoint if the state did change.
   * Good to wrap multiple state changes in a single undoable action.
   * If the operation throws, no checkpoint is saved and the error is propagated.
   * @param operation Function that may perform a state change.
   * @returns The result of the operation.
   */
  withCheckpoint: <R>(operation: () => R) => R;

  /**
   * Reverts the state to the previous snapshot in the undo history, if available.
   * Moves the current state to the redo history.
   */
  undo: () => void;

  /**
   * Reapplies the most recently undone state from the redo history, if available.
   * Moves the current state to the undo history.
   */
  redo: () => void;

  /**
   * Clears both the undo and redo history, but does not affect the current state.
   */
  clearHistory: () => void;

  /**
   * Returns true if there is at least one state in the undo history.
   */
  canUndo: () => boolean;

  /**
   * Returns true if there is at least one state in the redo history.
   */
  canRedo: () => boolean;

  /**
   * Exports the current undo/redo history as an opaque blob.
   */
  exportHistory: () => HistoryData;

  /**
   * Restores a previously exported history blob.
   */
  importHistory: (data: HistoryData) => void;
}

// A single frame in history
interface HistoryFrame<T> {
  state: T;
  timestamp: number;
}

// Internal state - not exposed publicly
interface HistoryState<T> {
  _history_past: HistoryFrame<T>[];
  _history_future: HistoryFrame<T>[];
}

/**
 * Public, opaque change signal: a monotonic counter the middleware bumps on every
 * history transition (checkpoint, undo, redo, clear, import). Subscribe to it to
 * detect domain mutations and undo/redo in O(1). It never ticks on selection or
 * drag — those mutate state without a checkpoint. Mirrors editorStore's counter
 * of the same name for project-scoped (channel/memory/model) mutations.
 */
export interface MutationCount {
  readonly mutationCount: number;
}

// Configuration for history middleware
interface HistoryConfig<T> {
  limit?: number;
  partialize?: (state: T) => Partial<T>;
  equality?: (before: Partial<T>, after: Partial<T>) => boolean;
}

export const history =
  <T>(config: HistoryConfig<T> = {}) =>
  <Mps extends [StoreMutatorIdentifier, unknown][] = [], Mcs extends [StoreMutatorIdentifier, unknown][] = []>(
    storeInitializer: StateCreator<T, Mps, Mcs>,
  ): StateCreator<T & HistoryState<T> & History & MutationCount, Mps, Mcs> => {
    const {
      limit = 50,
      partialize = (state) => state,
      equality = (before, after) => JSON.stringify(before) === JSON.stringify(after),
    } = config;

    return (set, get, store) => {
      type FullState = T & HistoryState<T> & History & MutationCount;

      const initialState = storeInitializer(
        set as Parameters<StateCreator<T, Mps, Mcs>>[0],
        get as Parameters<StateCreator<T, Mps, Mcs>>[1],
        store as Parameters<StateCreator<T, Mps, Mcs>>[2],
      );

      return {
        ...initialState,
        _history_past: [],
        _history_future: [],
        mutationCount: 0,

        takeCheckpoint: () => {
          const currentState = partialize(get() as T);
          set((state: FullState) => ({
            ...state,
            _history_past: [...state._history_past, { state: currentState as T, timestamp: Date.now() }].slice(-limit),
            _history_future: [],
            mutationCount: state.mutationCount + 1,
          }));
        },

        withCheckpoint: <R>(operation: () => R): R => {
          const beforeState = partialize(get() as T);
          // Execute operation and capture result to return later to caller
          const result = operation();
          const afterState = partialize(get() as T);
          // Compare using provided equality function
          const areEqual = equality(beforeState, afterState);
          if (!areEqual) {
            set((state: FullState) => ({
              ...state,
              _history_past: [...state._history_past, { state: beforeState as T, timestamp: Date.now() }].slice(-limit),
              _history_future: [],
              mutationCount: state.mutationCount + 1,
            }));
          }
          return result;
        },

        undo: () => {
          const state = get();
          if (state._history_past.length === 0) return;
          const past = [...state._history_past];
          const previousFrame = past.pop()!;
          // Save current state to future before restoring
          const currentState = partialize(state as T);
          set({
            ...state,
            ...previousFrame.state,
            _history_past: past,
            _history_future: [...state._history_future, { state: currentState as T, timestamp: Date.now() }],
            mutationCount: state.mutationCount + 1,
          } as FullState);
        },

        redo: () => {
          const state = get();
          if (state._history_future.length === 0) return;
          const future = [...state._history_future];
          const nextFrame = future.pop()!;
          // Save current state to past before restoring
          const currentState = partialize(state as T);
          set({
            ...state,
            ...nextFrame.state,
            _history_past: [...state._history_past, { state: currentState as T, timestamp: Date.now() }].slice(-limit),
            _history_future: future,
            mutationCount: state.mutationCount + 1,
          } as FullState);
        },

        clearHistory: () => {
          set((state: FullState) => ({
            ...state,
            _history_past: [],
            _history_future: [],
            mutationCount: state.mutationCount + 1,
          }));
        },

        canUndo: () => (get() as FullState)._history_past.length > 0,
        canRedo: () => (get() as FullState)._history_future.length > 0,

        exportHistory: () => ({
          past: [...(get() as FullState)._history_past],
          future: [...(get() as FullState)._history_future],
        }),

        importHistory: (data: HistoryData) => {
          set((state: FullState) => ({
            ...state,
            _history_past: [...data.past] as HistoryFrame<T>[],
            _history_future: [...data.future] as HistoryFrame<T>[],
            mutationCount: state.mutationCount + 1,
          }));
        },
      } as FullState;
    };
  };
