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
  type Schedule,
} from "frameact";
import { retain } from "../util/cleanup";
import { ReactiveFramework } from "../util/reactiveFramework";

// Effects are two-phase: `compute` is tracked and runs synchronously at creation; re-runs go
// through the effect's scheduler. The default `tickEnd` is a microtask with a loop guard (at most
// 100 runs of one effect per macrotask, then runs are moved to setTimeout) — the benchmark
// drives thousands of synchronous updates within one macrotask, so it would trip that guard.
// A plain queue drained at the outer batch boundary gives the benchmark's expected semantics
// (effects have run when withBatch returns), the same shape as the Vue/Oby adapters.
const queue: (() => void)[] = [];
const schedule: Schedule = (run) => {
  queue.push(run);
};
let batchDepth = 0;

function drain() {
  try {
    // Index loop: a running effect may schedule more effects (they are appended).
    for (let i = 0; i < queue.length; i++) queue[i]();
  } finally {
    queue.length = 0;
  }
}

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
  effect: (fn) => createEffect(fn, noop, schedule),
  withBatch: (fn) => {
    // Writes never run effects synchronously in frameact, so a "batch" is just the drain point.
    batchDepth++;
    try {
      fn();
    } finally {
      if (--batchDepth === 0) drain();
    }
  },
  withBuild: (fn) => {
    // Detached root kept alive until the upstream cleanup registry disposes it after the workload.
    const result = createRoot((dispose) => {
      retain(dispose);
      return fn();
    });
    // First apply of each new effect was queued; run it so the graph is quiet after construction.
    if (batchDepth === 0) drain();
    return result;
  },
};
