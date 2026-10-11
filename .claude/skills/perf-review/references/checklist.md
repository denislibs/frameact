# perf-review checklist

Concrete things to check per area, with the Telegram Web A scenario that makes each one matter.
File names refer to the frameact layout (`src/core/*`, `src/scheduler/*`, later `src/dom/*`, `src/store/*`).

## Update pipeline (`src/core/effects.ts`, `src/core/frame.ts`)
- Allocations per `enqueue`: a new entry object and/or closure per dirtied effect? Could the node itself be
  queued (intrusive list / flag) instead?
- Per-drain allocations: `new Map()` for the loop guard, `new Map()` block cache, overflow arrays — created
  even when nothing is gated / no loop? Lazily create them.
- `runEffect` ancestor walk: O(depth) per run — measure at depth 20–40 (tt component trees are deep).
- Self-dirty / loop guards: cost on the common path (no loop) should be a counter increment at most.
- tt scenario: a new message arrives → store write → ~50–200 effects dirtied in one frame; reaction on one
  message → 1–5 effects. Both must be well under 1 ms at CPU ×4.

## Graph hot paths (`src/core/core.ts`)
- Extra work in `read()` (observer bookkeeping), `write()` (epoch stamping), `notify()` (latch checks),
  `update()` (try/finally, new-source scans) vs upstream maverick — measure a diamond and a 10k-fan-out.
- `_observers` removal is swap-with-last + `indexOf` (O(n)) — matters for a signal with thousands of readers
  (e.g. a global "current chat" signal read by every row).

## Lists (`src/core/map.ts`, later `src/dom/list.ts`)
- Per update: Map/Set rebuild, array copies (`slice`), `new Array(n)`; is there a prefix/suffix fast path?
- "1 of 1000 changed" should be O(n) cheap comparisons and O(1) row work; "prepend 50" should not touch the
  other 1000 rows' effects.
- Bytes per row (item node, index node, row owner, effects) × 1000 rows.
- Duplicate-key fallback must not cause churn on every update.

## Frame discipline (`src/scheduler/fasterdom.ts`, `src/core/frame.ts`)
- Exactly one rAF scheduled per frame regardless of how many effects/phases are dirty.
- Work produced in measure lands in the same frame's mutate; mutate→measure lands next frame (warned in DEV).
- No `Promise` chains or timers added per effect.
- tt scenario: scroll handler measures sticky dates and adjusts positions — must not force sync layout.

## Heavy animations (`src/scheduler/heavyAnimation.ts`, gating in `src/core/frame.ts`)
- No-animation path: one `peek()` per scope per drain, cached — not per entry.
- Parking 3000 entries: one `once` per scope, arrays not copied repeatedly.
- Release: lands in one frame — measure the length of that frame's task (it is the "long task after the
  chat-open animation" users feel); consider time-slicing if it exceeds ~16 ms at CPU ×4.

## Memory / GC
- After dispose: nothing in queues, parked lists, once-callback sets, WeakMap listeners or pending
  `setTimeout`s keeps the node alive (check with `gc()` + `heapUsed` over 200 create/dispose cycles).
- Arrays that only grow (`length = 0` reuse vs reallocation) — fine; arrays that never release references — not.
- tt scenario: 200 chat switches, each mounting/unmounting a 1000-row list — heap must return to baseline.

## JIT friendliness
- Node fields initialised in the constructor (stable hidden class); fields added later (`_writesDom`,
  `_bailed`, `_scope`, `_applyCleanup`, …) create shape transitions — check where they are first assigned.
- Polymorphic call sites in the drain (`entry.run()` with many closure shapes) — usually fine, measure if suspected.

## Cold start
- Module-level side effects (installing hooks, creating root scopes) — cheap and unavoidable is fine.
- DEV-only branches guarded by `DEV` (`process.env.NODE_ENV !== 'production'`) so they tree-shake.
- Rough minified+gzipped size of `src/index.ts` (esbuild: `npx esbuild src/index.ts --bundle --minify --format=esm --define:process.env.NODE_ENV='"production"' | gzip -c | wc -c`).
