// frameact adapter for js-reactivity-benchmark (copied by run.mjs into upstream's
// src/frameworks/frameact.ts; it is typechecked there, not by frameact's own tsconfig).
//
// Public API only (createSignal / createMemo / createEffect / createRoot): this measures what an
// app pays, including the Solid-style accessor wrappers over the vendored maverick nodes.
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flushSync,
} from "frameact";
import { retain } from "../util/cleanup";
import { ReactiveFramework } from "../util/reactiveFramework";

// Effects are two-phase: `compute` is tracked and runs synchronously at creation; re-runs go
// through the effect's scheduler — here the default `tickEnd` (what an app uses), drained
// synchronously by `flushSync()` at the outer batch boundary, so effects have run when withBatch
// returns. tickEnd's loop guard counts runs per drain, and every flushSync() is its own drain, so
// thousands of updates in one macrotask are not mistaken for a loop.
let batchDepth = 0;

const noop = () => {};

export const frameactFramework: ReactiveFramework = {
  name: "frameact",
  signal: (initialValue) => {
    // `equals` defaults to ===, like the other engines.
    const [read, write] = createSignal(initialValue);
    return {
      read,
      // The setter treats a function as an updater; the benchmark only writes plain values.
      write: (v) => {
        write(v);
      },
    };
  },
  computed: (fn) => ({ read: createMemo(fn) }),
  // The work happens in the tracked compute half; the untracked apply half has nothing to do.
  effect: (fn) => createEffect(fn, noop),
  withBatch: (fn) => {
    // Writes never run effects synchronously in frameact, so a "batch" is just the drain point.
    batchDepth++;
    try {
      fn();
    } finally {
      if (--batchDepth === 0) flushSync();
    }
  },
  withBuild: (fn) => {
    // Detached root kept alive until the upstream cleanup registry disposes it after the workload.
    const result = createRoot((dispose) => {
      retain(dispose);
      return fn();
    });
    // First apply of each new effect was scheduled on tickEnd; run it so the graph is quiet after construction.
    if (batchDepth === 0) flushSync();
    return result;
  },
};
