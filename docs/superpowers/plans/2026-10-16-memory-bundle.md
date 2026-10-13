# frameact memory & bundle pass — Implementation Plan (perf/memory-bundle)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close frameact's three weak spots in the local krausest js-framework-benchmark run (`bench/krausest/results/latest.md`: brotli 14.6 kB vs Solid 4.5, memory geomean 1.55 vs Solid 1.20, first paint 98 ms vs Solid 57) without changing a single semantic: the krausest app's bundle goes from 46 012 B / 14 750 B brotli to 39 725 B / 12 734 B brotli (−14 %), the JS heap per 1 000 rows from 11 292 kB to 10 964 kB (Solid: 11 076 — frameact ends *below* Solid per row), what the heap keeps after five create/clear cycles from +437 kB to +364 kB (Solid +299; the rest is JIT code), ready memory follows the bundle (−27 kB of heap, UA metric 0.8 → 0.7 MB), and first paint follows the bundle too (see the diagnosis: on upstream's harness first paint is ~32 ms + 1 ms per uncompressed kB).

**Architecture:** Six measured changes, ordered by payoff. (1) A reproducible measurement tool (`bench/krausest/heap.mjs`: upstream's own memory/first-paint procedures plus heap snapshots aggregated by constructor), because every later task is judged by it. (2) Controlled inputs leave the always-bundled runtime: `attributes.ts` no longer registers `use:value`/`use:checked` at load, `controlled.ts` has no top-level side effect, and the Vite plugin injects `registerControlledDirectives()` into modules whose JSX uses them (−1 515 B brotli). (3) The class channel keeps its state on the element under symbol keys (not in a WeakMap whose table never shrinks), as a string for zero or one token (a Set only for two or more), and never reads `classList` when nothing changes (−107 B/row of Sets, −92 B/row of Blink `DOMTokenList`+rare data, −64 kB retained after clear). (4) Every node constructor assigns its fields syntactically (and effect/selector constructors chain to the Computation constructor), so V8 sizes the in-object area right: no out-of-object PropertyArray per effect, index node and selector node (−71 kB per 1 000 rows, faster field access). (5) Heavy-animation gating is installed into the frame drains by the first `begin()` (or the store gate), `frame.ts`/`effects.ts` stop importing `heavyAnimation.ts`, and the per-effect `_scope` field becomes a context lookup: an app that never starts a heavy animation does not bundle scopes or the gate (−807 B brotli, −4 B/effect). (6, optional) Built-in schedules queue the effect node itself instead of a per-effect `run` closure, and `_writesDom` becomes a flag (−42 kB per 1 000 rows, +147 B brotli; keep only if the krausest CPU spot check stays flat). A final task re-runs krausest and refreshes `bench/krausest/results/` and the README numbers.

**Tech Stack:** TypeScript 7 (strict), pnpm, Vite 8 (rolldown + oxc minifier) + vitest 5 + jsdom 30, oxlint, `@babel/core` (the Vite plugin already runs Babel). No new dependencies: `puppeteer-core` for the measurement tool comes from upstream's `webdriver-ts` checkout under `bench/krausest/.upstream/` (loaded with `createRequire`, never installed into the repo).

**Spec:** `docs/superpowers/specs/2026-10-11-frameact-design.md` §3.2 (effects, two halves, schedulers, heavy-animation scopes), §3.3 (`class` token diff: "imperative `addExtraClass` survives an update"; controlled inputs as directives), §3.5 (store gate, parking by cause — untouched in behaviour, its sampling hooks move behind a seam), §3.6 (the Vite plugin). Baseline: `bench/krausest/results/latest.md` (commit `91f93ac`). The prototype of every code block below lives in the scratch worktree `/Users/denisurevic/Documents/frameact/.worktrees/mem-scratch` (detached, WIP commits `0e35332` s1 … `fd2da59` s6, `e938e9a`/`9b9948e` tests, on top of `91f93ac`); `git diff 91f93ac 9b9948e` there reproduces Tasks 2–6 byte for byte, tests included (Task 1's script is `bench/krausest/heap.mjs` in that tree, uncommitted). The plan is authoritative — transcribe from here.

## Global Constraints

- Worktree `/Users/denisurevic/Documents/frameact/.worktrees/mem`, branch `perf/memory-bundle`, base commit `91f93ac` (= `bench/krausest` tip, on top of `perf/core-preact`). Never work under `/tmp`; never touch `docs/assets/*`; never edit anything under `bench/krausest/.upstream/` by hand except the throw-away variant directories Task 1 describes.
- Toolchain already installed (do not change versions): `typescript@^7.0.2`, `vite@^8.3.4`, `vitest@^5.0.3`, `jsdom@^30.1.2`, `oxlint@^1.87.0`, `@babel/core@^7.29.7`, `@solidjs/babel-plugin@2.0.0-rc.14`. **No new dependencies.**
- `pnpm check` (= `pnpm lint && pnpm typecheck && pnpm test`) must be clean — 0 errors, **0 warnings** — after every task. `pnpm lint` exits 0 even with warnings: its output must be nothing but the command line. Test count: 1026 at the base → 1028 (Task 2) → 1030 (Task 3) → 1030 (Task 4) → 1031 (Task 5) → 1032 (Task 6).
- `pnpm test:chrome` (headless Chrome lane, 9 scenarios) must pass after Tasks 2, 3, 5 and 6 (they touch the DOM runtime or the schedulers). `node bench/reactivity/run.mjs --check` must pass after every task that touches `src/core/**` or `src/scheduler/**` (Tasks 4, 5, 6); it **resets** `bench/reactivity/.upstream` (`git checkout -f`, `git clean -fd`) — copy any `results/*.json` you want to keep out of it first. js-reactivity-benchmark spot check (kairo and s suites, frameact next to `alien`, same run): `node bench/reactivity/run.mjs -- --framework frameact,alien --suite kairo,s` (the upstream name is `alien`, not `alien-signals`) — the ratios must stay within the ±0.1 run-to-run noise of `bench/reactivity/results/latest.md`.
- **No semantic change.** Owners and cleanup order, two-phase effects, frame phases, heavy-animation gating (what is parked, when it is released, measure before mutate in one frame), store parking and its per-drain sampling, the `tickEnd`/frame loop guards, the `class`/`classList` channel contract (token diff, imperative classes survive, channels independent, `class:x` untracked), controlled-input behaviour once registered, error semantics, the public API of `frameact`, `frameact/dom`, `frameact/vite` (one addition: `registerControlledDirectives` is exported from `frameact/dom`; `idle`, `createIdleEffect`, `gateOnHeavyAnimation`, `deferUntilIdle` keep their names and are still exported from `frameact`) — all unchanged. DEV-only code stays behind `DEV` (`src/env.ts`) and dead in prod builds: the tree-shaking test of Task 5 asserts that a prod bundle contains no `[frameact] use:` string, and the krausest bundle built in Task 1 must contain 0 `console.warn` calls (`grep -c "console.warn" bench/krausest/.upstream/frameworks/keyed/frameact/dist/main.js` → 0).
- oxlint: `no-underscore-dangle` is **off** in `src/core/**`, `test/core/**`, `test/effects/**` and **on** elsewhere — `src/scheduler/*` never reads `node._*` fields (Task 5 renames the two scope fields it moves there: `_parked` → `parked`, `_releaseArmed` → `releaseArmed`, both `@internal`). Also on: `unicorn/consistent-function-scoping`, `no-shadow`, `no-unused-vars` (prefix unused params with `_`). `bench/` is neither linted nor type-checked.
- Tests: vitest + jsdom; never `expect` inside a scheduler callback or an effect apply (log into arrays, assert after `flushSync()`/`await flushMicrotasks()`); console spies restored in `finally`/`afterEach`. `import.meta.url` is rewritten under vitest: tests that need repository paths use `resolve()` from `process.cwd()` (the repo root, where `vitest.config.ts` lives).
- Measuring: all numbers below were taken on this machine (Apple M1 Pro, 16 GB, macOS 26.5, Node v24.3.0, Google Chrome 155, a visible window as in upstream's default) with the 1-minute load average between 5 and 9 (the machine was in use); check `uptime` before quoting a CPU or first-paint number, take 7 samples (`--fp 7`, `--count 7`), compare medians within one run, and repeat a run that looks off. Heap-snapshot self sizes are deterministic to ±1 kB and are the primary memory metric; `performance.measureUserAgentSpecificMemory()` (what krausest reports) is rounded to 0.1 MB and adds Blink's native memory. Upstream's server brotli-compresses every response at quality 11 **synchronously, on the fly**: `main.js` of 46 kB takes ~46 ms to serve, 11.5 kB ~11 ms (`zlib.brotliCompressSync` default quality), which is where frameact's first-paint gap comes from (diagnosis below). Do not "fix" the server: it is upstream's harness, the same for every framework.
- Commits: stage **explicit paths only** (never `git add -A`); message ends with the implementer's own trailer `Co-Authored-By: <your model name> <noreply@anthropic.com>` (substitute your model's name). Do not push.

## What was measured (read before touching anything)

All numbers: krausest upstream `bf894b6` under `bench/krausest/.upstream/`, the frameact app of `bench/krausest/frameworks/keyed/frameact/` built the way `run.mjs` builds it (Vite 8, `frameact/vite` with `dev: false`, IIFE, oxc minifier — a build from the worktree sources with the same options is byte-identical to the `pnpm pack` route), served by upstream's server on :8080, measured with `bench/krausest/heap.mjs` (Task 1) — `--fp 7 --trace`, `--mem 3`, `--snap`. Solid 1.9.3 / Svelte 5.42.1 / vanillajs are upstream's own builds from the same run.

### First paint: the harness compresses the bundle on every load — 1 ms per kB

| | first paint, ms (median of 7) | `main.js` request → responseEnd, ms | FP − responseEnd, ms | `domInteractive`, ms | EvaluateScript, ms | encoded / decoded, B |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| frameact @ 91f93ac | **99.0** | **57.0** | 34 | 78 | 2.6 | 14 750 / 46 012 |
| solid 1.9.3 | 60.4 | 18.9 | 32 | 38 | 1.4 | 4 358 / 11 563 |
| vanillajs | 63.3 | 20.4 | 32 | 39 | 0.6 | 2 172 / 9 486 |
| svelte 5.42.1 | 87.5 | 37.7 | 41 | 72 | 3.6 | 9 716 / 26 953 |

- The time from the script's `responseEnd` to first paint is the same 32–34 ms for frameact, Solid and vanillajs: frameact's mount is **not** deferred to a later frame. `render()` → `insert()` → `createRenderEffect` with `immediateApply: true` applies synchronously inside `strictHooks.forceMutation`; the `<For>` of the empty list, the buttons' `insert`s, everything lands before the script ends (Chrome paints after the parser-blocking `<script>` finishes). Evaluate of the 46 kB script is 2.6 ms (Solid 1.4): +1.2 ms, not 40. **No "initial synchronous mount path" is needed — there already is one.**
- The whole gap is the fetch: upstream's `server/app.ts` `onSend` hook runs `zlib.brotliCompressSync(buffer)` (default quality 11) on every response while compression is enabled (the size benchmark enables it); on this machine that is 45.7 ms for frameact's 46 012 B, 25.2 ms for Svelte's 26 953 B, 11.1 ms for Solid's 11 563 B, 9.1 ms for vanilla's 9 486 B — ≈ 1 ms per uncompressed kB, and the fetch numbers above are exactly that plus ~8 ms. So first paint ≈ 32 ms + 1 ms × (uncompressed kB) on this harness, and every kB cut from the bundle is a millisecond of first paint. The architecture (frame phases, natives, gating) costs nothing here.
- Expected after Tasks 2–6: 39 725 B → fetch ≈ 50 ms → first paint ≈ 92 ms (measured: see the results table below).

### Memory: where the +0.4 MB at 1 000 rows and the +0.3 MB after clear come from

Heap-snapshot self sizes (kB) at the three krausest points, Chrome 155, after `window.gc({type:'major',execution:'sync',flavor:'last-resort'})`:

| | ready | run 1k − ready | clear×5 − ready (retained) | UA memory ready / run / clear×5, MB |
| --- | ---: | ---: | ---: | --- |
| frameact @ 91f93ac | 1 711 | 11 292 | 437 | 0.8 / 3.1 / 1.1 |
| solid 1.9.3 | 1 518 | 11 076 | 299 | 0.6 / 2.7 / 0.8 |

**Ready (+193 kB).** `native ExternalStringData` +81 kB (the script source: V8 keeps it for lazy compilation and stack traces), `code` objects +45 kB (bytecode, feedback, baseline `InstructionStream` of the functions run during load), strings +8 kB, `array (object properties)` +9 kB, shapes +4 kB. All proportional to the amount of code: there is no eager table of note left (`constants.ts`'s Sets are `/*#__PURE__*/` and already shaken out of this app). The fix is the bundle.

**Per row (frameact +216 B of JS and native over Solid at the base; the table lists the objects frameact creates per row and their cost):**

| per row (1 000 rows) | frameact @ 91f93ac | after this plan | Solid |
| --- | ---: | ---: | ---: |
| effect node (`Effect`, 32 fields) | 108 B in-object **+ 56 B PropertyArray** | 132 B, one object | computation ≈ 100 B + 2 arrays |
| index node (`createComputation(j)`, 18 fields) | 52 B **+ ~40 B PropertyArray** | 84 B | — (Solid creates index signals only for 2-arg mappers) |
| selector node (21 fields) | 56 B **+ ~48 B PropertyArray** | 96 B | `Set([listener])` per key ≈ 100 B |
| `Link` ×2 (class→selector, label→signal) | 80 B | 80 B | sources/observers arrays ≈ 100 B |
| class channel: `Applied{raw,tokens:Set}` + WeakMap entry | 24 + **107 B (JSSet + OrderedHashSet backing)** + ~12 B | 8 B (two symbol slots in the wrapper's existing property array) | — (`className=`) |
| Blink: `DOMTokenList` + `NodeRareData` for the `<tr>` (`node.classList` read even for `''`) | **92 B native** | 0 (not read while nothing changes) | 0 |
| `_run` closure + its context | 28 + 20 B | 0 (Task 6) | — |
| compute value `{e, t}`, 4 closures (compute, apply, 2 click handlers), `read.bind` ×3, contexts, `<tr>` `SLOT` slot | ≈ 330 B | ≈ 330 B | ≈ 6 closures + 5 objects + contexts ≈ 600 B |
| **JS + native, frameact − Solid** | **+216 B** | **−112 B** (10 964 vs 11 076 kB per 1k) | 0 |

The DOM itself (Blink `LayoutObject`, `ComputedStyle`, fragments, …) is ≈ 10.3 kB per row for everyone and dominates the UA metric; it is why the krausest "run memory" ratios are compressed.

**V8 sizes the in-object area from the constructor's syntax.** `initComputationNode(this, …)` assigns 18 fields from a helper; V8's `expected_nof_properties` counts only `this.x =` statements in the constructor function literal, summed over the constructor's own prototype chain (`Function.__proto__`), plus 8 slack slots, shrunk by slack tracking. Effect's constructor assigns 16 fields syntactically → 24 in-object slots, 8 of its 32 fields overflow into a `PropertyArray`; `ComputeNode` assigns 0 → the index node overflows 8 of 18; `Selector` assigns 3 → 11 slots for 21 fields. Verified in Node (`--allow-natives-syntax`, `%DebugPrint`): helper-initialised 32-field object → "inobject properties: 22, properties: PropertyArray[12]"; the same with the base fields assigned in a base constructor and `Object.setPrototypeOf(Sub, Base)` → "inobject properties: 32, properties: FixedArray[0]" (with or without the helper in the subclass). Task 4.

**Retained after clear×5 (frameact +437 kB vs Solid +299 kB, i.e. +138 kB):** one `array` of **65 556 B — the backing table of `classChannel`'s WeakMap** (`closure … .context → … .xr → WeakMap → .table`): a `WeakMap`'s `EphemeronHashTable` grows to hold the 1 000 live `<tr>` entries, dead entries are cleared by GC but the table is never shrunk; after five create/clear cycles it is 64 kB of empty buckets. The other +70 kB is `code InstructionStream`/`BytecodeArray`/`FeedbackVector` — JIT and bytecode for the functions that ran (frameact has more of them); not retention of app data. Nothing else frameact-specific stays: the frame queues are replaced per drain (`queues[phase] = []`), the `tickEnd` array is capped at 4 096 slots and was not among the largest objects, `disposeStack`/`checkStack`/`notifyStack` are depth-bounded, the selector `Map` is empty after dispose, `mapArray` resets `_items/_mappings/_nodes` to `[]` on an empty list. Task 3 removes the WeakMap.

### Bundle: what is in the 14.75 kB and what can leave without an API change

Unminified share of the krausest bundle by module (rolldown `//#region`; `events.ts` is merged into the `directives.ts` region by rolldown): `core/core.ts` 22.2 %, `dom/controlled.ts` 10.4 %, `core/map.ts` 9.8 %, `core/effects.ts` 8.1 %, `dom/insert.ts` 7.3 %, `dom/directives.ts`+`events.ts` 4.9 %, `core/frame.ts` 4.6 %, `dom/attributes.ts` 4.5 %, `dom/reconcile.ts` 4.5 %, `scheduler/schedulers.ts` 3.6 %, `main.jsx` 3.4 %, `scheduler/heavyAnimation.ts` 3.1 %, `dom/list.ts` 3.0 %, the rest < 2 % each.

- **Controlled inputs ship in every app** (10.4 % + the `installListeners`/`onClearDelegated` part of events): `attributes.ts` statically imports and calls `registerControlledDirectives()`, and `controlled.ts` has a top-level `onClearDelegated(...)` call, so rolldown keeps the module even where nothing uses `use:value`. Task 2: −1 515 B brotli (14 750 → 13 235), −5 053 B raw.
- **Heavy-animation scopes and the gate ship in every app** (3.1 % + the gating half of `frame.ts` + `schedulers.ts` `onIdle`): `effects.ts` snapshots `currentHeavyAnimationScope(this)` into every effect, `frame.ts`'s `drain` calls `isAnyScopeBlocking()`/`openGateSample()`, and `heavyAnimation.ts` creates `rootScope` (two signals) at load. Task 5: −807 B brotli, −4 B per effect.
- **Not shakeable without an API change (left alone, numbers for the record):** `For order="manual"` (`list.ts` `manualOrder` 4 021 B + `reconcile.ts` `reconcileManual` ≈ 1 400 B unminified ≈ 1.5 kB brotli): `For` reads `props.order` at run time, so both diffs must exist; a compile-time injection like Task 2's would silently fall back to the ordinary diff for `order={expr}` — a semantic change. Would need a separate component or an explicit import; an open question below. `map.ts`'s three map variants (9.8 %): `mapArray` dispatches on `options.keyed` at run time. The store-walk branch of `notify()`/`write()` (≈ 0.5 kB brotli): in the hottest function of the core; the core-perf pass measured it at ≤ 2 % and a hook-based split would cost more than it saves. Non-DEV error strings (`[frameact] Potential infinite loop…`, drain/cleanup errors, 11 messages ≈ 600 B raw ≈ 250 B brotli): kept — they are the only diagnostics a prod build has.

### Prototype results (scratch worktree, each variant built and served under its own `frameworks/keyed/frameact-sN/` and measured in isolation; "per 1k" = heap self size of run 1k − ready)

| variant (cumulative) | brotli, B | raw, B | ready, kB | per 1k rows, kB | retained after clear×5, kB | effect node |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| base `91f93ac` | 14 750 | 46 012 | 1 711 | 11 292 | 437 | 108 B + PropertyArray |
| s1 = Task 2 (controlled lazy) | **13 235** | 40 959 | 1 694 | 11 297 | 440 | — |
| s2 (class tokens as string, still WeakMap) | 13 339 | 41 317 | 1 695 | 11 207 | 436 | — |
| s3 = Task 4 (in-object sizing) | 13 372 | 41 549 | 1 695 | **11 136** | 435 | **140 B, one object** |
| s4 = Task 3 (symbol channel state, no classList read) | 13 394 | 41 615 | 1 695 | **11 025** | **370** | — |
| s5 = Task 5 (gating decoupled, no `_scope`) | **12 587** | 39 259 | **1 685** | 11 006 | 366 | 136 B |
| s6 = Task 6 (no `_run` closure, `_writesDom` flag) | 12 734 | 39 725 | 1 685 | **10 964** | 364 | 132 B |
| solid 1.9.3 | 4 358 | 11 563 | 1 518 | 11 076 | 299 | |

UA memory (krausest's metric, median of 3, MB): ready 0.8 → 0.7 (Solid 0.6), run 1k 3.1 → 2.8 (Solid 2.7), create/clear ×5 1.1 → 1.0 (Solid 0.8); `usedJSHeapSize` run 1k 2.26 → 2.02 MB (Solid 1.91), clear×5 1.32 → 1.23 MB (Solid 1.04).

CPU and first paint of the final prototype (s6) against the base, same run — the table is filled from `bench/krausest/heap.mjs --fp 7 --trace` and upstream's `benchmarkRunner` (`--count 7`, benchmarks 01, 02, 05, 07, 09), see "Prototype CPU / first paint" at the end of this document.

## File Structure

- Create `bench/krausest/heap.mjs` — the measurement tool (Task 1). Modify `bench/krausest/README.md` (a paragraph on the tool and, in Task 7, the numbers).
- Modify `src/dom/attributes.ts` (drop the registration), `src/dom/controlled.ts` (no top-level side effect; `uninstallListeners`), `src/dom/directives.ts` (DEV hint), `src/dom/index.ts` (export `registerControlledDirectives`), `src/vite/index.ts` (Babel plugin `registerControlled`) (Task 2).
- Modify `src/dom/classes.ts` — the channel state and diff (Task 3).
- Modify `src/core/core.ts` (`ScopeNode`/`ComputeNode` constructors, `initComputationNode`, `computationConstructor`), `src/core/effects.ts`, `src/core/selector.ts` (constructor chaining) (Task 4).
- Modify `src/core/frame.ts` (`drainHooks` seams, `requeueParked`; gating and the idle/gated schedules move out), `src/scheduler/heavyAnimation.ts` (receives them; `installGating`, `effectScopeOf`; pure module level), `src/core/effects.ts` (no `_scope`), `src/store/gate.ts`, `src/index.ts`, `src/dom/scope.ts` (comment) (Task 5).
- Modify `src/core/core.ts` (two flags), `src/core/effects.ts` (`RUN_NODE`, `runOf`, node-aware schedules), `src/core/frame.ts`, `src/scheduler/schedulers.ts` (`onTickEndNode`, node runner), `src/scheduler/heavyAnimation.ts` (one line) (Task 6).
- Tests: `test/vite/plugin.test.ts` (+1), `test/dom/directives.test.ts` (+1), `test/dom/controlled.test.ts`, `test/dom/spread.test.ts`, `test/store/controlled.test.ts` (register explicitly) (Task 2); `test/dom/classes.test.ts` (+2) (Task 3); `test/effects/frame.test.ts`, `test/effects/gating.test.ts` (imports, field names), new `test/vite/treeshake.test.ts` (+1) with `test/vite/fixtures/treeshake/{plain,inputs,animation}.jsx` (Task 5); `test/effects/basic.test.ts` (+1) (Task 6).
- Modify `bench/krausest/results/raw/*.json`, `bench/krausest/results/{latest.md,machine.json,correctness.json}`, `bench/krausest/README.md` (Task 7). `README.md` / `README.ru.md` / `README.zh-CN.md` quote no krausest numbers — unchanged.

---

### Task 1: `bench/krausest/heap.mjs` — the measurement tool

**Files:**
- Create: `bench/krausest/heap.mjs`
- Modify: `bench/krausest/README.md` (the "Запуск" section: one paragraph)

**Interfaces:**
- Consumes: upstream's server (`bench/krausest/.upstream/server`, `PORT`, `/enableCompression`, `/disableCompression`), `puppeteer-core@25.3.0` from `bench/krausest/.upstream/webdriver-ts/node_modules` (installed by `run.mjs`), Chrome at `CHROME_BINARY` or `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, the framework directories under `bench/krausest/.upstream/frameworks/keyed/<name>/` (`index.html` + `dist/main.js`; `--fw` takes several names).
- Produces: console tables; with `--snap <dir>`, `<dir>/<fw>.json` (`{ready, run, clear5: {constructor: {count, size}}, totals}`).

- [ ] **Step 1: Prepare the upstream checkout and the server**

```sh
node bench/krausest/run.mjs --frameworks frameact,solid,svelte,vanillajs --check   # clone/reset upstream, install, build, correctness checks; ~5 min the first time
(cd bench/krausest/.upstream/server && PORT=8080 node_modules/.bin/tsx index.ts > /dev/null 2>&1 &)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/ls                   # 200
```

The server stays up for the whole plan (kill it at the end: `pkill -f "tsx index.ts"`). To measure a variant side by side with the base, copy the framework directory: `V=bench/krausest/.upstream/frameworks/keyed; mkdir -p $V/frameact-x/dist && cp $V/frameact/index.html $V/frameact/package.json $V/frameact-x/ && ln -sfn ../frameact/node_modules $V/frameact-x/node_modules && cp <built main.js> $V/frameact-x/dist/main.js` — upstream's runner then accepts `--framework keyed/frameact-x` (both report as `frameact-v0.0.0-keyed`: run them one at a time and copy `webdriver-ts/results/*.json` away between runs). These directories are inside the git-ignored `.upstream` and are removed by the next `run.mjs` only for `frameact/` itself; delete them by hand when done.

- [ ] **Step 2: Write the tool**

Create `bench/krausest/heap.mjs` with exactly this content:

```js
#!/usr/bin/env node
// Memory and first-paint diagnostics for the krausest apps, the way upstream's webdriver-ts measures them
// (same Chrome flags, `window.gc` + `performance.measureUserAgentSpecificMemory()`, `performance` paint
// entries) plus what upstream does not give: several samples, resource/evaluate timings and V8 heap
// snapshots aggregated by constructor. Needs `bench/krausest/run.mjs --check` to have run once (upstream
// checkout, webdriver-ts deps, built frameworks) and upstream's server on PORT (default 8080):
//   (cd bench/krausest/.upstream/server && PORT=8080 node_modules/.bin/tsx index.ts &)
//
//   node bench/krausest/heap.mjs --fw frameact,solid --fp 7 [--trace]   first paint (43_): N fresh browsers each,
//                                       with the main.js fetch time (the server brotli-compresses on the fly) and,
//                                       with --trace, EvaluateScript / v8.compile durations from a Chrome trace
//   node bench/krausest/heap.mjs --fw frameact,solid --mem 3           21_/22_/25_ via measureUserAgentSpecificMemory
//                                       (+ usedJSHeapSize, 3 decimals: the UA number is rounded to 0.1 MB)
//   node bench/krausest/heap.mjs --fw frameact,solid --snap <dir>      heap snapshots ready / run 1k / create+clear x5:
//                                       per-constructor self sizes, the run-1k delta per row, what stays after
//                                       clear, the largest JS objects with one retainer chain each; JSON per fw in <dir>
//   --fw names directories under .upstream/frameworks/keyed/ (a copy of frameact/ with another dist/main.js
//   serves to compare variants side by side); --headless for headless Chrome (upstream's default is a window).
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const WD = join(here, '.upstream/webdriver-ts/');
const require = createRequire(WD);
const puppeteer = require('puppeteer-core');
const CHROME = process.env.CHROME_BINARY ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOST = `http://localhost:${Number(process.env.PORT) > 0 ? Number(process.env.PORT) : 8080}`;

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const fws = opt('--fw', 'frameact').split(',');
const fpN = Number(opt('--fp', 0));
const memN = Number(opt('--mem', 0));
const snapDir = opt('--snap', null);
const headless = argv.includes('--headless');
const trace = argv.includes('--trace');
const uriOf = (fw) => `frameworks/keyed/${fw}/index.html`;

async function startBrowser() {
  const args = [
    '--window-size=1280,800', '--js-flags=--expose-gc', '--no-default-browser-check', '--disable-sync', '--no-first-run',
    '--ash-no-nudges', '--disable-extensions', '--disable-features=Translate,PrivacySandboxSettings4,IPH_SidePanelGenericMenuFeature',
  ];
  if (headless) args.push('--headless=new');
  return puppeteer.launch({ headless: false, executablePath: CHROME, args, defaultViewport: { width: 1280, height: 800 } });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function click(page, sel) {
  const el = await page.waitForSelector(`pierce/${sel}`, { timeout: 10000 });
  await el.click();
}
async function waitText(page, sel, text) {
  await page.waitForFunction((s, t) => document.querySelector(s)?.textContent?.includes(t), { timeout: 10000 }, sel, text);
}
async function waitGone(page, sel) {
  await page.waitForFunction((s) => !document.querySelector(s), { timeout: 10000 }, sel);
}
const gc = (page) => page.evaluate("window.gc({type:'major',execution:'sync',flavor:'last-resort'})");
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const fmt = (a) => `${median(a).toFixed(1)} (${a.map((x) => x.toFixed(1)).join(' ')})`;

// ---- first paint --------------------------------------------------------------------------
async function firstPaint(fw) {
  const samples = { fp: [], fcp: [], jsDur: [], jsEnd: [], evalMs: [], compileMs: [], domInteractive: [] };
  for (let i = 0; i < fpN; i++) {
    const browser = await startBrowser();
    try {
      const page = await browser.newPage();
      if ((await (await fetch(`${HOST}/enableCompression`)).text()) !== 'OK') throw new Error('enableCompression');
      if (trace) await page.tracing.start({ categories: ['devtools.timeline', 'v8', 'disabled-by-default-v8.compile'] });
      await page.goto(`${HOST}/${uriOf(fw)}`, { waitUntil: 'networkidle0' });
      await click(page, '#run');
      await waitText(page, 'tbody>tr:nth-of-type(1)>td:nth-of-type(1)', '1');
      const info = await page.evaluate(() => {
        const paint = performance.getEntriesByType('paint');
        const nav = performance.getEntriesByType('navigation')[0];
        const js = performance.getEntriesByType('resource').find((r) => /main\.js|Main\.js/.test(r.name));
        return {
          fp: paint.find((e) => e.name === 'first-paint')?.startTime,
          fcp: paint.find((e) => e.name === 'first-contentful-paint')?.startTime,
          jsStart: js?.startTime, jsEnd: js?.responseEnd, jsSize: js?.encodedBodySize, jsDecoded: js?.decodedBodySize,
          domInteractive: nav?.domInteractive,
        };
      });
      let evalMs = 0, compileMs = 0;
      if (trace) {
        const buf = await page.tracing.stop();
        const events = JSON.parse(Buffer.from(buf).toString()).traceEvents;
        for (const e of events) {
          const url = e.args?.data?.url ?? e.args?.fileName ?? '';
          if (!/main\.js|Main\.js/i.test(url)) continue;
          if (e.name === 'EvaluateScript' && e.dur) evalMs += e.dur / 1000;
          if ((e.name === 'v8.compile' || e.name === 'V8.CompileScript' || e.name === 'v8.compileModule') && e.dur) compileMs += e.dur / 1000;
        }
      }
      await fetch(`${HOST}/disableCompression`);
      samples.fp.push(info.fp); samples.fcp.push(info.fcp ?? NaN); samples.jsDur.push(info.jsEnd - info.jsStart); samples.jsEnd.push(info.jsEnd);
      samples.domInteractive.push(info.domInteractive); samples.evalMs.push(evalMs); samples.compileMs.push(compileMs);
      if (i === 0) console.log(`  ${fw}: main.js encoded ${info.jsSize} B, decoded ${info.jsDecoded} B`);
    } finally {
      await browser.close();
    }
  }
  console.log(`${fw.padEnd(12)} first-paint ${fmt(samples.fp)} | js fetch ${fmt(samples.jsDur)} ms, js responseEnd ${fmt(samples.jsEnd)} | domInteractive ${fmt(samples.domInteractive)}${trace ? ` | evaluate ${fmt(samples.evalMs)} compile ${fmt(samples.compileMs)}` : ''}`);
  return samples;
}

// ---- memory (upstream method) ------------------------------------------------------------
async function memory(fw) {
  const steps = {
    '21_ready': async () => {},
    '22_run': async (page) => { await click(page, '#run'); await page.waitForSelector('pierce/tbody>tr:nth-of-type(1)>td:nth-of-type(2)>a'); },
    '25_run-clear5': async (page) => {
      for (let i = 0; i < 5; i++) {
        await click(page, '#run'); await waitText(page, 'tbody>tr:nth-of-type(1000)>td:nth-of-type(1)', String(1000 * (i + 1)));
        await click(page, '#clear'); await waitGone(page, 'tbody>tr:nth-of-type(1000)>td:nth-of-type(1)');
      }
    },
  };
  const out = {};
  for (const [id, run] of Object.entries(steps)) {
    const res = [], heap = [];
    for (let i = 0; i < memN; i++) {
      const browser = await startBrowser();
      try {
        const page = await browser.newPage();
        await page.goto(`${HOST}/${uriOf(fw)}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('pierce/#run');
        await run(page);
        await gc(page); await sleep(40);
        res.push((await page.evaluate('performance.measureUserAgentSpecificMemory()')).bytes / 1024 / 1024);
        heap.push((await page.evaluate('performance.memory.usedJSHeapSize')) / 1024 / 1024);
      } finally { await browser.close(); }
    }
    out[id] = res;
    console.log(`${fw.padEnd(12)} ${id.padEnd(14)} UA-memory MB ${fmt(res)} | usedJSHeapSize MB ${heap.map((x) => x.toFixed(3)).join(' ')}`);
  }
  return out;
}

// ---- heap snapshots ----------------------------------------------------------------------
async function takeSnapshot(page) {
  const client = await page.createCDPSession();
  const chunks = [];
  client.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
  await client.send('HeapProfiler.enable');
  await client.send('HeapProfiler.collectGarbage');
  await client.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  await client.detach();
  return JSON.parse(chunks.join(''));
}
/** Aggregate (type:name) → { count, size }; also total. */
function aggregate(snap) {
  const m = snap.snapshot.meta;
  const fields = m.node_fields, n = fields.length;
  const types = m.node_types[0];
  const iType = fields.indexOf('type'), iName = fields.indexOf('name'), iSize = fields.indexOf('self_size');
  const nodes = snap.nodes, strings = snap.strings;
  const agg = new Map();
  let total = 0;
  for (let i = 0; i < nodes.length; i += n) {
    const type = types[nodes[i + iType]];
    let name = strings[nodes[i + iName]];
    if (type === 'native' || type === 'code') name = `${type} ${name.replace(/^(system \/ )?/, '')}`;
    else if (type === 'closure' || type === 'concatenated string' || type === 'sliced string' || type === 'string' || type === 'number' || type === 'hidden' || type === 'synthetic' || type === 'bigint' || type === 'regexp' || type === 'symbol' || type === 'object shape') {
      // group by type for the noisy kinds; closures keep their function name (per-row closures matter)
      name = type === 'closure' ? `closure ${name}` : type === 'object shape' ? 'shape' : type;
    } else if (type === 'array') name = `array ${name}`;
    const key = `${type === 'object' ? '' : ''}${name}`;
    const e = agg.get(key) ?? { count: 0, size: 0 };
    e.count++; e.size += nodes[i + iSize]; total += nodes[i + iSize];
    agg.set(key, e);
  }
  return { agg, total, nodeCount: nodes.length / n };
}
function diff(a, b, label, perRow = 1, min = 2000) {
  const rows = [];
  for (const [k, vb] of b.agg) {
    const va = a.agg.get(k) ?? { count: 0, size: 0 };
    const dc = vb.count - va.count, ds = vb.size - va.size;
    if (Math.abs(ds) >= min || Math.abs(dc) >= perRow * 0.9 * 1000) rows.push([k, dc, ds]);
  }
  for (const [k, va] of a.agg) if (!b.agg.has(k) && va.size >= min) rows.push([k, -va.count, -va.size]);
  rows.sort((x, y) => Math.abs(y[2]) - Math.abs(x[2]));
  console.log(`\n== ${label}: total self size ${((b.total - a.total) / 1024).toFixed(1)} kB (${a.total / 1024 | 0} → ${b.total / 1024 | 0} kB), nodes ${a.nodeCount} → ${b.nodeCount}`);
  console.log(`${'delta count'.padStart(12)} ${'delta kB'.padStart(9)} ${'per row B'.padStart(10)}  constructor`);
  for (const [k, dc, ds] of rows.slice(0, 45)) console.log(`${String(dc).padStart(12)} ${(ds / 1024).toFixed(1).padStart(9)} ${(ds / perRow).toFixed(0).padStart(10)}  ${k}`);
}
function top(s, label, n = 30) {
  const rows = [...s.agg].sort((x, y) => y[1].size - x[1].size).slice(0, n);
  console.log(`\n== ${label}: total self size ${(s.total / 1024).toFixed(1)} kB, ${s.nodeCount} nodes`);
  for (const [k, v] of rows) console.log(`${String(v.count).padStart(8)} ${(v.size / 1024).toFixed(1).padStart(8)} kB  ${k}`);
}
/** The biggest array/object nodes (self size) of a raw snapshot with one retainer chain each. */
function retainers(snap, label, n = 12) {
  const m = snap.snapshot.meta;
  const nf = m.node_fields, nn = nf.length, ef = m.edge_fields, ne = ef.length;
  const types = m.node_types[0], etypes = m.edge_types[0];
  const iType = nf.indexOf('type'), iName = nf.indexOf('name'), iSize = nf.indexOf('self_size'), iEdges = nf.indexOf('edge_count');
  const eType = ef.indexOf('type'), eName = ef.indexOf('name_or_index'), eTo = ef.indexOf('to_node');
  const nodes = snap.nodes, edges = snap.edges, strings = snap.strings;
  const count = nodes.length / nn;
  // first edge index per node + reverse edges
  const firstEdge = new Uint32Array(count + 1);
  for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += nodes[i * nn + iEdges] * ne; }
  firstEdge[count] = edges.length;
  const back = new Map(); // to node index -> [from node index, edge idx]
  for (let i = 0; i < count; i++) {
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e += ne) {
      const et = etypes[edges[e + eType]];
      if (et === 'weak' || et === 'shortcut') continue;
      const to = edges[e + eTo] / nn;
      if (!back.has(to)) back.set(to, [i, e]); // (first retainer is enough for a chain)
    }
  }
  const desc = (i) => { const t = types[nodes[i * nn + iType]]; const nm = strings[nodes[i * nn + iName]]; return `${t}:${nm.slice(0, 40)}#${i}(${nodes[i * nn + iSize]}B)`; };
  const edesc = (e) => { const et = etypes[edges[e + eType]]; const x = edges[e + eName]; return et === 'element' || et === 'hidden' ? `[${x}]` : `.${strings[x]}`; };
  const big = [];
  for (let i = 0; i < count; i++) {
    const t = types[nodes[i * nn + iType]];
    if (t === 'native' || t === 'code' || t === 'synthetic' || t === 'object shape' || t === 'string' || t === 'concatenated string') continue;
    big.push([nodes[i * nn + iSize], i]);
  }
  big.sort((a, b) => b[0] - a[0]);
  console.log(`\n== ${label}: largest JS-heap objects`);
  for (const [size, i] of big.slice(0, n)) {
    let chain = desc(i), cur = i;
    for (let d = 0; d < 7; d++) { const r = back.get(cur); if (!r) break; chain = `${desc(r[0])} ${edesc(r[1])} -> ` + chain; cur = r[0]; if (types[nodes[cur * nn + iType]] === 'synthetic') break; }
    console.log(`${String(size).padStart(8)} B  ${chain}`);
  }
}

async function snapshots(fw) {
  const browser = await startBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(`${HOST}/${uriOf(fw)}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('pierce/#run');
    await gc(page); await sleep(40);
    const ready = aggregate(await takeSnapshot(page));
    await click(page, '#run'); await waitText(page, 'tbody>tr:nth-of-type(1000)>td:nth-of-type(1)', '1000');
    await gc(page); await sleep(40);
    const run = aggregate(await takeSnapshot(page));
    await click(page, '#clear'); await waitGone(page, 'tbody>tr:nth-of-type(1)');
    for (let i = 1; i < 5; i++) {
      await click(page, '#run'); await waitText(page, 'tbody>tr:nth-of-type(1000)>td:nth-of-type(1)', String(1000 * (i + 1)));
      await click(page, '#clear'); await waitGone(page, 'tbody>tr:nth-of-type(1)');
    }
    await gc(page); await sleep(40);
    const rawClear5 = await takeSnapshot(page);
    const clear5 = aggregate(rawClear5);
    const ua = async () => (await page.evaluate('performance.measureUserAgentSpecificMemory()')).bytes / 1024 / 1024;
    console.log(`\n#### ${fw}  (UA memory now, after clear5: ${(await ua()).toFixed(3)} MB)`);
    top(ready, `${fw} ready (top constructors)`);
    diff(ready, run, `${fw} run 1k − ready (per row = /1000)`, 1000);
    diff(ready, clear5, `${fw} clear×5 − ready (retained after clear)`, 1, 500);
    retainers(rawClear5, `${fw} after clear×5`);
    if (snapDir) {
      mkdirSync(snapDir, { recursive: true });
      const dump = (s) => Object.fromEntries([...s.agg].map(([k, v]) => [k, v]));
      writeFileSync(join(snapDir, `${fw}.json`), JSON.stringify({ ready: dump(ready), run: dump(run), clear5: dump(clear5), totals: { ready: ready.total, run: run.total, clear5: clear5.total } }));
    }
  } finally { await browser.close(); }
}

for (const fw of fws) {
  if (fpN) await firstPaint(fw);
  if (memN) await memory(fw);
  if (snapDir) await snapshots(fw);
}
```

- [ ] **Step 3: Run it against the base and keep the numbers**

```sh
node bench/krausest/heap.mjs --fw frameact,solid --mem 3
node bench/krausest/heap.mjs --fw frameact,solid --snap bench/krausest/.snaps
node bench/krausest/heap.mjs --fw frameact,solid,vanillajs --fp 7 --trace
```

Expected (± noise): `frameact 21_ready UA-memory 0.8 | usedJSHeapSize 0.987`, `22_run 3.1 | 2.26`, `25_run-clear5 1.1 | 1.32`; solid `0.6 | 0.845`, `2.7 | 1.906`, `0.8 | 1.042`. Snapshots: `frameact ready total self size 1711 kB`, `run 1k − ready 11292 kB`, `clear×5 − ready 437 kB` with the row `6  64.4  array ` and the retainer line `… .xr -> object:WeakMap … .table -> array:#…(65556B)`; the per-row block lists `1000 105.5 108 Bt` (the effect node; the minified name varies), `1006 89.0 91 array `, `1002 15.7 16 Set`, `6020 199.9 205 native PropertyArray`, `3002 168.0 172 native DOMTokenList`. First paint: frameact ≈ 99 (js fetch ≈ 57), solid ≈ 60 (≈ 19). `bench/krausest/.snaps` is scratch output, not under the git-ignored `.upstream/`: add the line `bench/krausest/.snaps` to the repository `.gitignore` next to `bench/krausest/.upstream` and never commit it.

- [ ] **Step 4: README paragraph**

In `bench/krausest/README.md`, after the "## Запуск" code block (after the line `node bench/krausest/run.mjs --headless …` list ends, before the paragraph that starts `не трогайте мышь`), add:

```markdown
Диагностика памяти и first paint тем же способом, что у апстрима, но с несколькими замерами, таймингами ресурса и снимками кучи по конструкторам: `node bench/krausest/heap.mjs --fw frameact,solid --fp 7 --trace | --mem 3 | --snap <dir>` (нужен поднятый сервер апстрима: `(cd bench/krausest/.upstream/server && PORT=8080 node_modules/.bin/tsx index.ts &)`; описание флагов — в шапке скрипта).
```

- [ ] **Step 5: Commit**

```sh
git add bench/krausest/heap.mjs bench/krausest/README.md .gitignore
git commit -m "bench(krausest): heap.mjs — memory / first-paint diagnostics (upstream's procedures + heap snapshots by constructor)"
```

---

### Task 2: controlled inputs leave the always-bundled runtime

**Files:**
- Modify: `src/dom/attributes.ts` (lines 9, 15), `src/dom/controlled.ts` (lines 429–456, 557–562), `src/dom/directives.ts` (line 36), `src/dom/index.ts` (line 24), `src/vite/index.ts` (lines 59, 83, 121)
- Tests: `test/vite/plugin.test.ts` (append), `test/dom/directives.test.ts` (append), `test/dom/controlled.test.ts`, `test/dom/spread.test.ts`, `test/store/controlled.test.ts` (register explicitly)

**Interfaces:**
- `registerControlledDirectives(): void` (exists in `controlled.ts`, idempotent) becomes a public export of `frameact/dom`; the Vite plugin injects `import { registerControlledDirectives as _registerControlled } from "frameact/dom"; _registerControlled();` at the top of every module whose source matches `/\buse:(?:value|checked)\s*=/`. Hand-written `setAttribute(el, 'use:value', …)` / spreads outside compiled JSX call it once themselves; without it `runDirective` reports (DEV) which call is missing and does nothing.
- `controlled.ts` has no top-level side effect any more: the `onClearDelegated` hook is registered by the first `installListeners`.

- [ ] **Step 1: Write the failing tests**

Append to `test/vite/plugin.test.ts`:

```ts

it('registers the built-in controlled-input directives in modules whose JSX uses use:value / use:checked, before the module body', async () => {
  const withInput = await compile('const a = <input use:value={s} />;\nconst b = <input type="checkbox" use:checked={c} />;', '/app/x.jsx', false);
  const m = withInput.code.match(/^import \{ registerControlledDirectives as (\w+) \} from "frameact\/dom";\n\1\(\);$/m);
  expect(m).not.toBeNull();
  // the call precedes the first directive write of the module body (the compiler's hoisted imports and template declarations may come before it)
  expect(withInput.code.indexOf(`${m![1]}();`)).toBeLessThan(withInput.code.indexOf('_$setAttribute('));
  expect(withInput.code.match(/registerControlledDirectives/g)!.length).toBe(1);
  // a module without controlled inputs (even one mentioning value= or a user directive) is left alone
  const without = await compile('const a = <input value="x" use:focus={f} onInput={h} />;', '/app/y.jsx', false);
  expect(without.code).not.toContain('registerControlledDirectives');
});
```

Append to `test/dom/directives.test.ts`:

```ts

it('use:value / use:checked before registration: a dev error that names registerControlledDirectives, nothing runs', async () => {
  vi.resetModules(); // a fresh registry: earlier tests in this file registered built-ins
  const { runDirective: runFresh } = await import('../../src/dom/directives');
  const el = document.createElement('input');
  runFresh(el, 'checked', true);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0][0])).toContain("registerControlledDirectives() from 'frameact/dom'");
  expect(String(errors.mock.calls[0][0])).toContain('use:checked');
  runFresh(el, 'tooltip', 1); // an unknown user directive keeps its own message
  expect(String(errors.mock.calls[1][0])).toContain("defineDirective('tooltip', fn)");
});
```

- [ ] **Step 2: Run them to verify they fail**

`npx vitest run test/vite/plugin.test.ts test/dom/directives.test.ts` → the two new tests fail (no injected import; the old "unknown directive" message).

- [ ] **Step 3: `src/dom/attributes.ts`** — delete these two lines (the import at line 9 and the call at line 15, with its trailing blank line):

```ts
import { registerControlledDirectives } from './controlled';
```

```ts
registerControlledDirectives(); // the built-in use:value / use:checked

```

- [ ] **Step 4: `src/dom/controlled.ts`** — replace

```ts
function installListeners(doc: Document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  delegateEvents(['input'], doc);
```

with

```ts
let clearHooked = false;

function installListeners(doc: Document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  if (!clearHooked) {
    // Registered on first use, not at module load: this module has no top-level side effect, so an app
    // without controlled inputs does not bundle it (see registerControlledDirectives).
    clearHooked = true;
    onClearDelegated(uninstallListeners);
  }
  delegateEvents(['input'], doc);
```

replace the top-level hook

```ts
onClearDelegated((doc) => {
  if (!installed.has(doc)) return;
```

… `});` (the whole call, lines 444–456) with the function

```ts
function uninstallListeners(doc: Document): void {
  if (!installed.has(doc)) return;
  installed.delete(doc);
  const { removeEventListener: remove } = getNatives();
  remove.call(doc, 'input', swallowWhileForcing, true);
  remove.call(doc, 'compositionend', swallowWhileForcing, true);
  remove.call(doc, 'input', onInput);
  remove.call(doc, 'change', onChange);
  remove.call(doc, 'compositionstart', onCompositionStart);
  remove.call(doc, 'compositionend', onCompositionEnd);
  remove.call(doc, 'focusout', onFocusOut);
  remove.call(doc, 'selectionchange', onSelectionChange);
}
```

and replace the doc comment of `registerControlledDirectives` with

```ts
/**
 * Registers the built-in `use:value` / `use:checked`. Not called by the runtime itself: the Vite plugin
 * injects the call into every module whose JSX uses `use:value` / `use:checked`, so an app without
 * controlled inputs does not bundle this module. Hand-written `setAttribute(el, 'use:value', …)` /
 * spreads outside compiled JSX call it once themselves. Idempotent.
 */
```

- [ ] **Step 5: `src/dom/directives.ts`** — in `runDirective`, replace

```ts
    if (DEV) console.error(`[frameact] unknown directive use:${name} — register it with defineDirective('${name}', fn)`);
```

with

```ts
    if (DEV) {
      console.error(
        RESERVED.has(name)
          ? `[frameact] use:${name} is not registered: call registerControlledDirectives() from 'frameact/dom' once (the Vite plugin does it for modules whose JSX uses use:${name})`
          : `[frameact] unknown directive use:${name} — register it with defineDirective('${name}', fn)`,
      );
    }
```

- [ ] **Step 6: `src/dom/index.ts`** — replace

```ts
export { forceControlledValue, isForcingControlledValue } from './controlled';
```

with

```ts
export { forceControlledValue, isForcingControlledValue, registerControlledDirectives } from './controlled';
```

- [ ] **Step 7: `src/vite/index.ts`** — after the `STRING_HANDLER` constant add

```ts
/** A module whose JSX binds a controlled input gets the built-in directives registered (see registerControlled). */
const CONTROLLED_DIRECTIVE = /\buse:(?:value|checked)\s*=/;
```

before `/** Rollup position (1-based line, 0-based column) of a character index. */` add

```ts
/**
 * Babel plugin: prepend `import { registerControlledDirectives } from 'frameact/dom'; registerControlledDirectives();`
 * to a module whose source uses `use:value` / `use:checked`. The runtime no longer registers the built-in
 * controlled-input directives at load (an app without inputs does not bundle them); the call runs before the
 * module body, so the first `setAttribute(el, 'use:value', …)` the compiled JSX makes finds them.
 */
function registerControlled({ types: t }: { types: any }) {
  return {
    name: 'frameact-register-controlled',
    visitor: {
      Program(path: any, state: any) {
        const code: string = state.file.code;
        if (!CONTROLLED_DIRECTIVE.test(code)) return;
        const local = path.scope.generateUidIdentifier('registerControlled');
        path.unshiftContainer('body', [
          t.importDeclaration([t.importSpecifier(local, t.identifier('registerControlledDirectives'))], t.stringLiteral('frameact/dom')),
          t.expressionStatement(t.callExpression(local, [])),
        ]);
      },
    },
  };
}

```

and in `transform` replace `plugins: [[solid, compilerOptions(dev)]],` with `plugins: [[solid, compilerOptions(dev)], registerControlled],`.

- [ ] **Step 8: the tests that call `setAttribute(el, 'use:value', …)` directly register the built-ins themselves**

`test/dom/controlled.test.ts`: it already imports `registerControlledDirectives` (line 5, `import { isForcingControlledValue, registerControlledDirectives } from '../../src/dom/controlled';`); add right after the last import line (after `import { container, useDomHarness } from '../helpers/dom';`):

```ts
registerControlledDirectives(); // the runtime no longer registers use:value / use:checked at load (the Vite plugin injects this call)
```

`test/dom/spread.test.ts` and `test/store/controlled.test.ts`: after their last import line add

```ts
import { registerControlledDirectives } from '../../src/dom/controlled';

registerControlledDirectives(); // the runtime no longer registers use:value / use:checked at load (the Vite plugin injects this call)
```

(`test/stricterdom/attribution.test.tsx` uses `use:value` in JSX compiled by the plugin under vitest: the injection covers it; `test/dom/attributes.test.ts` uses a user directive only.)

- [ ] **Step 9: Tests, lint, typecheck, chrome lane**

`pnpm check` → 1028 passed, no lint output. `pnpm test:chrome` → `9/9 scenarios passed` (its `main.tsx` has `use:value` scenarios: the dev build goes through the plugin).

- [ ] **Step 10: Measure**

```sh
node bench/krausest/run.mjs --frameworks frameact --check        # rebuilds .upstream/frameworks/keyed/frameact/dist/main.js from the worktree (the server keeps serving it)
node -e 'const z=require("zlib"),b=require("fs").readFileSync("bench/krausest/.upstream/frameworks/keyed/frameact/dist/main.js");console.log(b.length,z.brotliCompressSync(b).length)'
```

Expected: `40959 13235` (was `46012 14750`). The `--check` run itself passes upstream's smoketest / isKeyed / CSP (the app has no inputs: nothing to register). Heap snapshot (`--snap`) unchanged within ±5 kB (nothing per row changes); first paint ≈ −5 ms (`--fp 7`: fetch ≈ 51 ms).

- [ ] **Step 11: Commit**

```sh
git add src/dom/attributes.ts src/dom/controlled.ts src/dom/directives.ts src/dom/index.ts src/vite/index.ts test/vite/plugin.test.ts test/dom/directives.test.ts test/dom/controlled.test.ts test/dom/spread.test.ts test/store/controlled.test.ts
git commit -m "perf(dom): controlled inputs are bundled only where used — the Vite plugin registers use:value/use:checked per module, attributes.ts no longer does"
```

---

### Task 3: the class channel — symbol-keyed state, strings for ≤ 1 token, no `classList` read without a change

**Files:**
- Modify: `src/dom/classes.ts` (lines 7, 20–70)
- Test: `test/dom/classes.test.ts` (append)

**Interfaces:**
- `className(node, value, _prev?)`, `classList(node, value)`, `classTokens(value, out)`, `toggleClassToken`, `add/remove/toggleExtraClass`: signatures and the token-diff contract unchanged. Internally a channel's state is two symbol properties on the element (`CLASS_RAW`/`CLASS_TOKENS`, `CLASS_LIST_RAW`/`CLASS_LIST_TOKENS`, module-private symbols — invisible to `Object.keys`, spreads and content names) instead of a `WeakMap<Element, Applied>`; `tokens` is `''`, one token (a string) or a `Set` of ≥ 2; `node.classList` is read only when a token is added or removed.

- [ ] **Step 1: Write the failing tests**

Append to `test/dom/classes.test.ts`:

```ts

it('token sets of every size diff correctly: 2+ → 1 → 0 → 1 → 2+ (string and Set representations)', () => {
  const el = document.createElement('div');
  el.classList.add('extra');
  const add = vi.spyOn(el.classList, 'add');
  const remove = vi.spyOn(el.classList, 'remove');
  className(el, 'a b');
  expect(classes(el)).toEqual(new Set(['extra', 'a', 'b']));
  className(el, 'a'); // 2 → 1: only b removed
  expect(classes(el)).toEqual(new Set(['extra', 'a']));
  expect(remove).toHaveBeenCalledTimes(1);
  className(el, ''); // 1 → 0
  expect(classes(el)).toEqual(new Set(['extra']));
  className(el, 'c'); // 0 → 1
  className(el, ['c', { d: true }]); // 1 → 2: c kept, d added
  expect(classes(el)).toEqual(new Set(['extra', 'c', 'd']));
  expect(add).toHaveBeenCalledTimes(4); // a, b, c, d — never a token already there
  className(el, 'd'); // 2 → 1 by a different token
  expect(classes(el)).toEqual(new Set(['extra', 'd']));
});

it("'' → '' never reads classList (no DOMTokenList is allocated for a row whose class stays empty); the state is not an enumerable property", () => {
  const el = document.createElement('div');
  const getter = vi.spyOn(Element.prototype, 'classList', 'get');
  className(el, '');
  className(el, '');
  className(el, null);
  expect(getter).not.toHaveBeenCalled();
  className(el, 'x');
  expect(getter).toHaveBeenCalledTimes(1);
  expect(Object.keys(el)).toEqual([]); // symbol-keyed: invisible to spreads and Object.keys
  getter.mockRestore();
});
```

- [ ] **Step 2: Run them** — `npx vitest run test/dom/classes.test.ts`: the first passes on the base (the Set diff is correct today), the second fails (`classList` is read on every call).

- [ ] **Step 3: `src/dom/classes.ts`** — line 7: replace `lives on the element (WeakMap)` with `lives on the element (two symbol properties)`. Then replace everything from `interface Applied {` (line 20) through the end of `applyTokens` (line 70, `}`) with:

```ts
/**
 * The tokens a channel applied: `''` (none), one token (a string: the common case — `class={sel ? 'danger' : ''}`
 * on every row of a list — costs no Set) or a Set of two or more.
 */
type Tokens = string | Set<string>;

/**
 * A channel's state lives on the element under two symbol keys (the raw value last applied and its
 * tokens) — not in a WeakMap: a WeakMap's backing table grows with every element ever bound and never
 * shrinks (after five create/clear cycles of 1000 rows a 64 kB table stayed behind), and a symbol
 * property costs a slot in the wrapper's property array that `tagSlot` has already allocated. Symbols
 * cannot be clobbered by content (named properties shadow string names only).
 */
const CLASS_RAW = Symbol('frameact.class');
const CLASS_TOKENS = Symbol('frameact.class.tokens');
const CLASS_LIST_RAW = Symbol('frameact.classList');
const CLASS_LIST_TOKENS = Symbol('frameact.classList.tokens');
type Channel = Element & { [CLASS_RAW]?: unknown; [CLASS_TOKENS]?: Tokens; [CLASS_LIST_RAW]?: unknown; [CLASS_LIST_TOKENS]?: Tokens };

const WHITESPACE = /[ \t\n\f\r]/;
const SPLIT = /[ \t\n\f\r]+/;

function addTokens(str: string, out: Set<string>): void {
  if (!str) return;
  if (!WHITESPACE.test(str)) {
    out.add(str);
    return;
  }
  for (const token of str.split(SPLIT)) if (token) out.add(token);
}

/** Collect the tokens of a class value: string | number | { token: truthy } | nested arrays; booleans/null ignored. */
export function classTokens(value: unknown, out: Set<string>): void {
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'string') return addTokens(value, out);
  if (typeof value === 'number') return addTokens(String(value), out);
  if (Array.isArray(value)) {
    for (const item of value) classTokens(item, out);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) if (key && key !== 'undefined' && key !== 'null' && record[key]) addTokens(key, out);
  }
}

/** The canonical `Tokens` of a value: a string for zero or one token, a Set only for two or more. */
function tokensOf(value: unknown): Tokens {
  if (typeof value === 'string' && !WHITESPACE.test(value)) return value;
  if (value == null || typeof value === 'boolean') return '';
  const set = new Set<string>();
  classTokens(value, set);
  if (set.size > 1) return set;
  for (const token of set) return token;
  return '';
}

function hasToken(tokens: Tokens, token: string): boolean {
  return typeof tokens === 'string' ? tokens === token : tokens.has(token);
}

/**
 * Diff `prev` → `next` on the element's token list. `node.classList` is read only when a token is
 * actually added or removed: reading it makes the engine allocate a DOMTokenList (and the element's
 * rare data) per element, which a list of rows whose class is mostly `''` never needs.
 */
function applyTokens(node: Element, RAW: typeof CLASS_RAW | typeof CLASS_LIST_RAW, TOKENS: typeof CLASS_TOKENS | typeof CLASS_LIST_TOKENS, value: unknown): void {
  const el = node as Channel;
  const prev = el[TOKENS];
  // Same primitive as last time (merged effects call className unconditionally): nothing to do.
  if (prev !== undefined && el[RAW] === value && (typeof value !== 'object' || value === null)) return;
  const next = tokensOf(value);
  if (prev === undefined || typeof prev === 'string') {
    if (prev && !hasToken(next, prev)) node.classList.remove(prev);
  } else {
    for (const token of prev) if (!hasToken(next, token)) node.classList.remove(token);
  }
  if (typeof next === 'string') {
    if (next && (prev === undefined || !hasToken(prev, next))) node.classList.add(next);
  } else {
    for (const token of next) if (prev === undefined || !hasToken(prev, token)) node.classList.add(token);
  }
  el[RAW] = value;
  el[TOKENS] = next;
}
```

and the two callers:

```ts
export function className(node: Element, value: unknown, _prev?: unknown): void {
  applyTokens(node, CLASS_RAW, CLASS_TOKENS, value);
}

/** `classList={{ token: boolean }}` — same diff, its own channel. */
export function classList(node: Element, value: unknown): void {
  applyTokens(node, CLASS_LIST_RAW, CLASS_LIST_TOKENS, value);
}
```

(the doc comment above `className` stays.) The resulting file is exactly `src/dom/classes.ts` of scratch commit `91d4169`.

- [ ] **Step 4: Tests, lint, typecheck, chrome lane** — `pnpm check` → 1030 passed; `pnpm test:chrome` → 9/9.

- [ ] **Step 5: Measure**

```sh
node bench/krausest/run.mjs --frameworks frameact --check
node bench/krausest/heap.mjs --fw frameact --snap bench/krausest/.snaps
```

Expected: `run 1k − ready` 11 297 → **≈ 11 100 kB** (the `Set` and `array ` rows are gone: −107 B/row; `native DOMTokenList` 3002 → 2002 per 1 000 rows, `native NodeRareData` −32 B/row); `clear×5 − ready` 440 → **≈ 375 kB**, no `array` of 65 556 B in "largest JS-heap objects" any more. brotli 13 235 → ≈ 13 260 (+22 B for the symbols).

- [ ] **Step 6: Commit**

```sh
git add src/dom/classes.ts test/dom/classes.test.ts
git commit -m "perf(dom): class channel state on the element (symbols, string for 0/1 tokens, classList read only on a change) — no WeakMap table or Set per row"
```

---

### Task 4: node constructors assign their fields syntactically (V8 in-object sizing)

**Files:**
- Modify: `src/core/core.ts` (lines 612–711: `initScope`, `ScopeNode`, `initComputationNode`, `ComputeNode`, exports), `src/core/effects.ts` (import; after `Effect.prototype = computationPrototype;`), `src/core/selector.ts` (import; after `const SelectorProto = …`)

**Interfaces:**
- `initComputationNode(node, initialValue, compute, options, owned)` keeps its signature (it is now a thin arrow over the constructor); new `@internal` export `computationConstructor: Function` (the Computation constructor itself). Node field order and hidden classes are unchanged (same first-assignment order: the nine scope fields, then — after the append — `_flags … _changed`).

- [ ] **Step 1: Guard** — existing suites (`test/core/**`, `test/effects/**`, `test/dom/**`) cover every behaviour; the change is structural. No new test: the measurement is the heap snapshot (Step 4).

- [ ] **Step 2: `src/core/core.ts`** — replace the block from the comment `/**\n * Patch P3a (frameact): every node initialises its full field set in one fixed order, …` (line 612) down to and including the line `computationPrototype.call = read;` (line 703) with:

```ts
/**
 * Patch P3a (frameact): every node initialises its full field set in one fixed order, so nodes of
 * one kind share one hidden class (the vendored version left some fields on the prototype and
 * added others later — signals, `dirty` signals, computeds and effects all ended up with
 * different shapes, making read/write/notify polymorphic). Scope fields come first.
 *
 * Memory pass (frameact): the assignments are written out as `this.x = …` statements INSIDE the
 * constructors, not in a helper, and a constructor that extends another node kind (Effect, Selector)
 * has that constructor as its own prototype. V8 sizes a constructor's in-object area from the
 * syntactic `this.x =` count summed over the constructor's own prototype chain; fields assigned by a
 * helper are not counted, and the overflow lands in an out-of-object PropertyArray (a second
 * allocation per node, slower field access). Measured in Chrome: an effect node was 108 B in-object
 * + a 56 B PropertyArray; now 140 B in one object.
 */
const ScopeNode = function Scope(this: Scope) {
  this[SCOPE] = null;
  this._state = STATE_CLEAN;
  this._lastChild = null;
  this._prevSibling = null;
  this._nextSibling = null;
  this._context = defaultContext;
  this._handlers = null;
  this._disposal = null;
  this._compute = null;
  this._mapMemo = undefined; // one hidden class for every ScopeNode (map scopes included)
  if (currentScope) currentScope.append(this);
};

const ScopeProto = ScopeNode.prototype;

ScopeProto.append = function (this: Scope, child: Scope) {
  child[SCOPE] = this;

  const last = this._lastChild;
  child._prevSibling = last;
  if (last !== null) last._nextSibling = child;
  this._lastChild = child;

  child._context =
    child._context === defaultContext ? this._context : { ...this._context, ...child._context };

  if (this._handlers) {
    child._handlers = !child._handlers ? this._handlers : [...child._handlers, ...this._handlers];
  }
};

ScopeProto.dispose = function (this: Scope) {
  dispose.call(this);
};

export function createScope(): Scope {
  return new (ScopeNode as any)();
}

/**
 * The computation constructor: the complete field set (scope fields first), as before through
 * `initComputationNode`. `owned`: append to the current scope. Effects and selector nodes have their
 * own constructors (sharing the Computation prototype chain): they call this one with `.call(this, …)`
 * and set it as their constructor's prototype (`Object.setPrototypeOf(Effect, ComputeNode)`), so V8
 * counts these assignments towards their in-object size too (see above).
 */
const ComputeNode = function Computation(
  this: Computation,
  initialValue: any,
  compute: any,
  options: ComputedSignalOptions<any, any> | undefined,
  owned = true,
) {
  if (DEV && compute) assertApplyOwner();
  this[SCOPE] = null;
  this._state = compute ? STATE_DIRTY : STATE_CLEAN;
  this._lastChild = null;
  this._prevSibling = null;
  this._nextSibling = null;
  this._context = defaultContext;
  this._handlers = null;
  this._disposal = null;
  this._compute = compute || null;
  if (owned && currentScope) currentScope.append(this);
  this._flags = 0;
  this._effect = false;
  this._writtenAt = 0;
  this._deps = null;
  this._depsTail = null;
  this._subs = null;
  this._subsTail = null;
  this._value = initialValue;
  this._changed = (options && options.dirty) || isNotEqual;
  if (DEV) this.id = options?.id ?? (compute ? 'computed' : 'signal');
};

/**
 * @internal Initialise `node` with the complete computation field set, as the Computation
 * constructor does (it IS the constructor, called as a function). Effects and selector nodes call it
 * first; their constructors must also have `computationConstructor` as prototype (in-object sizing).
 */
export const initComputationNode: (
  this: void,
  node: Computation,
  initialValue: any,
  compute: any,
  options: ComputedSignalOptions<any, any> | undefined,
  owned: boolean,
) => void = (node, initialValue, compute, options, owned) => (ComputeNode as any).call(node, initialValue, compute, options, owned);

/** @internal the constructor function node kinds extend (prototype of their constructor, not of their instances) */
export const computationConstructor: Function = ComputeNode;

/** @internal the prototype every computation kind (signals, computeds, effects, selector nodes) shares */
export const computationPrototype: Computation = ComputeNode.prototype;
Object.setPrototypeOf(computationPrototype, ScopeProto);
computationPrototype.call = read;
```

(`createComputation` below it is unchanged: `new (ComputeNode as any)(initialValue, compute, options)` — `owned` defaults to `true`.)

- [ ] **Step 3: `src/core/effects.ts` and `src/core/selector.ts`**

`effects.ts`: add `  computationConstructor,` to the import list from `./core` (alphabetically, before `computationPrototype,`), and after the line `Effect.prototype = computationPrototype;` add

```ts
Object.setPrototypeOf(Effect, computationConstructor); // V8 counts the base fields towards the in-object size (core.ts)
```

`selector.ts`: change the import to `import { computationConstructor, computationPrototype, initComputationNode, onDispose, read, write } from './core';` and after `const SelectorProto = (Selector.prototype = Object.create(computationPrototype));` add

```ts
Object.setPrototypeOf(Selector, computationConstructor); // V8 counts the base fields towards the in-object size (core.ts)
```

- [ ] **Step 4: Tests, lint, typecheck, reactivity checks**

`pnpm check` → 1030 passed. `node bench/reactivity/run.mjs --check` → passes (adapter tests incl. exact pull counts, typecheck, prod build, frameact smoke of all 5 suites).

- [ ] **Step 5: Measure**

`node bench/krausest/run.mjs --frameworks frameact --check && node bench/krausest/heap.mjs --fw frameact --snap bench/krausest/.snaps`. Expected per 1 000 rows: the effect-node row goes `1000 105.5 108 <name>` → `1000 136.7 140 <name>`, the selector `56` → `96`, the index node `52` → `84`, and `native PropertyArray` drops from ≈ 6 000 to ≈ 3 000 objects (the three node kinds no longer overflow; the remaining three per row are the `<tr>`'s `SLOT`/class slots and the two `<a>`'s `_$$click`): total `run 1k − ready` ≈ −70 kB against Task 3's number (scratch: 11 207 → 11 136 kB with Task 3's first half applied). Bundle +33 B brotli. Spot check `node bench/reactivity/run.mjs -- --framework frameact,alien --suite kairo,s`: s/createComputations* may improve by a few % (in-object field stores), the rest within noise.

Optional confirmation in Node (not committed; proves the sizing rule on this V8):

```sh
node --allow-natives-syntax -e '
const dp = new Function("o", "%DebugPrint(o)");
function Base() { this.a=1;this.b=2;this.c=3;this.d=4;this.e=5;this.f=6;this.g=7;this.h=8;this.i=9;this.j=10;this.k=11;this.l=12;this.m=13;this.n=14;this.o=15;this.p=16;this.q=17;this.r=18; }
function Sub() { Base.call(this); this.A=0;this.B=0;this.C=0;this.D=0;this.E=0;this.F=0;this.G=0;this.H=0;this.I=0;this.J=0;this.K=0;this.L=0;this.M=0;this.N=0; }
Object.setPrototypeOf(Sub, Base);
const keep = []; for (let i = 0; i < 2000; i++) keep.push(new Sub()); dp(keep[1999]);' 2>&1 | grep -E "inobject properties|properties:"
```

→ `inobject properties: 32` and `properties: … <FixedArray[0]>`; without the `setPrototypeOf` line: `inobject properties: 22` and `PropertyArray[12]`.

- [ ] **Step 6: Commit**

```sh
git add src/core/core.ts src/core/effects.ts src/core/selector.ts
git commit -m "perf(core): node constructors assign every field syntactically and chain to the Computation constructor — V8 keeps all fields in-object (no PropertyArray per effect/selector/index node)"
```

---

### Task 5: heavy-animation gating is installed on first use; `frame.ts`/`effects.ts` stop importing `heavyAnimation.ts`; no per-effect `_scope`

**Files:**
- Modify: `src/core/frame.ts`, `src/core/effects.ts`, `src/scheduler/heavyAnimation.ts`, `src/store/gate.ts`, `src/index.ts`, `src/dom/scope.ts` (comment)
- Tests: `test/effects/frame.test.ts`, `test/effects/gating.test.ts` (imports, two field names, one reorder), new `test/vite/treeshake.test.ts` + `test/vite/fixtures/treeshake/{plain,inputs,animation}.jsx`

**Interfaces:**
- `frame.ts` `drainHooks` grows to `{ isGating, openSample, closeSample, blockingScopeFor(node, cache), park }` with inert defaults; new `@internal` `requeueParked(entry)`. `releaseInFrame` unchanged. `idle`, `createIdleEffect`, `gateOnHeavyAnimation`, `deferUntilIdle` move to `heavyAnimation.ts` (same names; `src/index.ts` re-exports them from there; `frameact/dom`'s `HeavyAnimationScope` component untouched).
- `heavyAnimation.ts`: new `@internal` `installGating()` (idempotent; called by every `begin()` and by `store/gate.ts` at load) and `effectScopeOf(node)` (moved from `effects.ts`; now `getContext(HEAVY_SCOPE_KEY, node) ?? rootScope`); `HeavyAnimationScope._parked`/`_releaseArmed` renamed `parked`/`releaseArmed` (`@internal`); `rootScope`, `getIsHeavyAnimating`, `getIsBlockingAnimating` are `/*#__PURE__*/` initialisers so the module has no top-level side effect.
- `EffectNode` loses `_scope`. Semantics: the scope an effect "snapshotted" was `getContext(KEY, this)` read in its constructor right after the append; `_context` of a node is assigned at append and never replaced afterwards (`setContext` gives the *owner* a new record), so reading it later yields the same scope; a disposed node reads `defaultContext` → root (a disposed effect never runs, so nothing observable). Before the first `begin()` no scope animates or blocks, so the inert defaults (never gating; no sampling) are exact; the store gate installs the sampling at load because `firstAnimatingScopeSampled` is its consumer.

- [ ] **Step 1: Write the failing tree-shaking test**

Create `test/vite/fixtures/treeshake/plain.jsx`:

```jsx
import { createSignal } from 'frameact';
import { For, render } from 'frameact/dom';

const [rows, setRows] = createSignal([{ id: 1 }, { id: 2 }]);
const [selected, setSelected] = createSignal(1);

render(
  () => (
    <ul onClick={() => setRows(rows().toReversed())}>
      <For each={rows()}>{(row) => <li class={selected() === row.id ? 'on' : ''} onClick={() => setSelected(row.id)}>{row.id}</li>}</For>
    </ul>
  ),
  document.body,
);
```

`test/vite/fixtures/treeshake/inputs.jsx`:

```jsx
import { createSignal } from 'frameact';
import { render } from 'frameact/dom';

const [text, setText] = createSignal('');

render(() => <input use:value={text} onInput={(e) => setText(e.currentTarget.value)} />, document.body);
```

`test/vite/fixtures/treeshake/animation.jsx`:

```jsx
import { beginHeavyAnimation, createSignal } from 'frameact';
import { render } from 'frameact/dom';

const [n, setN] = createSignal(0);

render(
  () => (
    <button
      onClick={() => {
        beginHeavyAnimation(100, true);
        setN(n() + 1);
      }}
    >
      {n()}
    </button>
  ),
  document.body,
);
```

`test/vite/treeshake.test.ts`:

```ts
// Tree-shaking guard: a production build of an app bundles the controlled-input machinery and the
// heavy-animation gate only when the app uses them (the runtime registers neither at load).
import { resolve } from 'node:path';
import { build, type Rollup } from 'vite';
import frameact from '../../src/vite/index';

// vitest runs from the repository root (vitest.config.ts); import.meta.url is rewritten under vitest, so paths are cwd-based.
const src = (file: string) => resolve('src', file);
const fixture = (name: string) => resolve('test/vite/fixtures/treeshake', name);

/** Production IIFE bundle of one fixture (unminified: the assertions are on identifiers and string literals). */
async function bundle(name: string): Promise<string> {
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [frameact({ dev: false })],
    resolve: {
      alias: [
        { find: 'frameact/dom', replacement: src('dom/index.ts') },
        { find: 'frameact/jsx-runtime', replacement: src('jsx-runtime.ts') },
        { find: /^frameact$/, replacement: src('index.ts') },
      ],
    },
    build: {
      write: false,
      minify: false,
      target: 'esnext',
      rollupOptions: { input: fixture(name), output: { format: 'iife' } },
    },
  })) as Rollup.RollupOutput;
  return result.output[0].code;
}

it('an app without controlled inputs or heavy animations bundles neither; one that uses them does', async () => {
  const plain = await bundle('plain.jsx');
  expect(plain).toContain('template(');
  expect(plain).not.toContain('compositionend'); // dom/controlled.ts
  expect(plain).not.toContain('registerControlledDirectives');
  expect(plain).not.toContain('isBlockingAnimating'); // scheduler/heavyAnimation.ts
  expect(plain).not.toContain('requestIdleCallback'); // scheduler onIdle (only onFullyIdle uses it)
  expect(plain).not.toContain('[frameact] use:'); // DEV strings are dead in prod

  const inputs = await bundle('inputs.jsx');
  expect(inputs).toContain('compositionend');
  expect(inputs).toContain('registerControlledDirectives');
  expect(inputs).not.toContain('isBlockingAnimating');

  const animation = await bundle('animation.jsx');
  expect(animation).toContain('isBlockingAnimating');
  expect(animation).not.toContain('compositionend');
}, 30_000);
```

`npx vitest run test/vite/treeshake.test.ts` → fails on `not.toContain('isBlockingAnimating')` for `plain` (the controlled-input assertions already pass after Task 2).

- [ ] **Step 2: `src/core/frame.ts`**

Replace the import block (lines 1–19) with:

```ts
import { DEV } from '../env';
import { STATE_DISPOSED } from './core';
import {
  createEffect,
  markDrainGuarded,
  markStoreGated,
  markWritesDom,
  NOT_APPLIED,
  setApplyCleanupDisposer,
  type EffectNode,
  type EffectOptions,
  type Schedule,
} from './effects';
import { getPhase, requestForcedReflow, requestMeasure, requestMutation } from '../scheduler/fasterdom';
import type { HeavyAnimationScope } from '../scheduler/heavyAnimation';
import { describeNode, effectPath, reportDevHookError } from './debug';
```

Replace the `drainHooks` declaration (from `/** @internal Task 10 installs gating here. …` through its closing `};`) with:

```ts
/**
 * @internal Heavy-animation gating and store-gate sampling, installed by scheduler/heavyAnimation.ts
 * (`installGating`) the first time a scope begins an animation, and by the store gate when it loads.
 * Until then no scope can block or animate, so the defaults — never gating, no sampling — behave
 * identically, and an app that never starts a heavy animation does not bundle the gate (nor the
 * scopes): frame.ts no longer imports heavyAnimation.ts at runtime.
 */
export const drainHooks: {
  /** true while some scope blocks: the drain then asks blockingScopeFor / park per entry */
  isGating: () => boolean;
  /** store-gate sampling (heavyAnimation.ts openGateSample): returns the previous sample for closeSample */
  openSample: () => number;
  closeSample: (prev: number) => void;
  /** the scope that blocks the effect's scope chain, or null */
  blockingScopeFor: (node: EffectNode, cache: Map<HeavyAnimationScope, HeavyAnimationScope | null>) => HeavyAnimationScope | null;
  park: (blocker: HeavyAnimationScope, entry: FrameEntry) => void;
} = {
  isGating: () => false,
  openSample: () => 0,
  closeSample: () => {},
  blockingScopeFor: () => null,
  park: () => {},
};
```

In `drain`: `const gating = isAnyScopeBlocking();` → `const gating = drainHooks.isGating();`; `const prevSample = openGateSample(); // …` → `const prevSample = drainHooks.openSample(); // the store gate decides once per drain (heavyAnimation.ts)`; `drainHooks.blockingScopeFor(node._scope, (blockCache ??= new Map()))` → `drainHooks.blockingScopeFor(node, (blockCache ??= new Map()))`; in the `finally`, `closeGateSample(prevSample);` → `drainHooks.closeSample(prevSample);`.

Delete everything from the line `// ---- heavy-animation gating ----------------------------------------------` to the end of the file **except** `releaseInFrame` (keep its doc comment and body as they are), and append after `releaseInFrame`:

```ts

/**
 * @internal The gate's release of one parked entry: a measure entry goes straight into the measure queue
 * (the caller drains it inside its measure task: a requestMeasure issued from within the measure phase
 * would slip to the frame after), the others through their normal queues, which run later in this frame.
 */
export function requeueParked(e: FrameEntry) {
  if (e.node !== null && e.node._state === STATE_DISPOSED) return;
  if (e.phase === 'measure') queues.measure.push(e);
  else enqueue(e.phase, e.run, e.node);
}
```

and replace the deleted section's header with the one-line comment `// ---- heavy-animation gating: implemented in scheduler/heavyAnimation.ts over these two seams ----` placed right before `releaseInFrame`'s doc comment. (The resulting file is `src/core/frame.ts` of scratch commit `dd1b85b`.)

- [ ] **Step 3: `src/core/effects.ts`** — delete the import `import { currentHeavyAnimationScope, type HeavyAnimationScope } from '../scheduler/heavyAnimation';`; delete `  _scope: HeavyAnimationScope;` from `EffectNode`; delete the constructor line `  this._scope = currentHeavyAnimationScope(this); // after the append: reads the owner's context`; delete the function

```ts
/** @internal the heavy-animation scope snapped when the effect was created. */
export function effectScopeOf(node: EffectNode): HeavyAnimationScope {
  return node._scope;
}

```

- [ ] **Step 4: `src/scheduler/heavyAnimation.ts`**

Replace the imports (lines 3–6) with:

```ts
import { getContext, getScope, peek, setContext } from '../core/core';
import {
  createEffect, isDomWritingSchedule, isDrainGuardedSchedule, markDrainGuarded, markStoreGated, markWritesDom,
  type EffectNode, type EffectOptions, type Schedule,
} from '../core/effects';
import { drainHooks, releaseInFrame, requeueParked, type FrameEntry } from '../core/frame';
import { computed, signal } from '../core/signals';
import type { Computation, Scope } from '../core/types';
import { onIdle } from './schedulers';
```

In the interface and `createScopeInternal`: `_parked` → `parked`, `_releaseArmed` → `releaseArmed` (four occurrences: two field declarations with their `@internal` comments, two initialisers). In `begin`, make the first statement `installGating(); // the frame drains gate only once some scope can animate (idempotent)` (before `counter++;`). Replace

```ts
export const rootScope: HeavyAnimationScope = createScopeInternal(null);
```

with

```ts
// Pure at module level: an app that never imports a heavy-animation API (nor the store) does not bundle this module.
export const rootScope: HeavyAnimationScope = /*#__PURE__*/ createScopeInternal(null);
```

and

```ts
export const getIsHeavyAnimating = rootScope.isAnimating;
export const getIsBlockingAnimating = rootScope.isBlockingAnimating;
```

with

```ts
export const getIsHeavyAnimating: OnceSignal = /*#__PURE__*/ (() => rootScope.isAnimating)();
export const getIsBlockingAnimating: OnceSignal = /*#__PURE__*/ (() => rootScope.isBlockingAnimating)();
```

Append at the end of the file:

```ts

/**
 * @internal The heavy-animation scope of an effect: the one provided by its owner when it was created.
 * Read from the node's own context record (set when it was appended to its owner and never replaced:
 * `provideHeavyAnimationScope` gives the owner a NEW record), so this is the scope the effect saw at
 * creation — no per-effect field. A disposed node reads the default record: the root scope.
 */
export function effectScopeOf(node: Computation): HeavyAnimationScope {
  return getContext<HeavyAnimationScope>(HEAVY_SCOPE_KEY, node) ?? rootScope;
}

// ---- the frame-drain gate (core/frame.ts drainHooks) ----------------------------------------
// Both hooks run inside the drain's per-entry try/catch, where a throw drops the entry and leaves
// its effect DIRTY forever. They must therefore never throw: failures degrade to "not gated".

function blockingScopeFor(
  node: EffectNode,
  cache: Map<HeavyAnimationScope, HeavyAnimationScope | null>,
): HeavyAnimationScope | null {
  // Sampled once per drain per scope: an applier that begins an animation mid-drain
  // does not split the frame it is part of.
  try {
    const path: HeavyAnimationScope[] = [];
    let result: HeavyAnimationScope | null = null;
    for (let s: HeavyAnimationScope | null | undefined = effectScopeOf(node); s; s = s.parent) {
      const cached = cache.get(s);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      path.push(s);
      if (s.isBlockingAnimating.peek()) {
        result = s;
        break;
      }
    }
    for (const p of path) cache.set(p, result);
    return result;
  } catch (error) {
    console.error('[frameact] heavy-animation gate check failed; running ungated', error);
    return null;
  }
}

function releaseParked(scope: HeavyAnimationScope) {
  scope.releaseArmed = false;
  const parked = scope.parked as FrameEntry[];
  scope.parked = [];
  // Release inside a measure task so that both measure and mutate work land in the SAME next frame,
  // in phase order (releaseInFrame): measure entries are drained right there, the others go through
  // their normal queues, which run later in this frame.
  releaseInFrame(() => {
    for (const e of parked) requeueParked(e);
  });
}

function park(scope: HeavyAnimationScope, entry: FrameEntry) {
  try {
    if (!Array.isArray(scope.parked)) scope.parked = [];
    if (!scope.isBlockingAnimating.peek()) {
      // The scope ended after this drain sampled it (an earlier applier or a deferred cleanup called
      // end()): its `once` has already fired, so arming a new one would strand the entry until the
      // scope animates again. Release now; the work still lands in the next frame.
      scope.parked.push(entry);
      releaseParked(scope);
      return;
    }
    if (!scope.releaseArmed) {
      scope.releaseArmed = true;
      try {
        scope.isBlockingAnimating.once(() => {
          try {
            releaseParked(scope);
          } catch (error) {
            console.error('[frameact] releasing parked frame effects failed', error);
          }
        });
      } catch (error) {
        scope.releaseArmed = false;
        throw error;
      }
    }
    scope.parked.push(entry);
  } catch (error) {
    // Could not park (entry is not in `parked` unless the release itself failed): run it now rather
    // than leave its effect dirty forever.
    console.error('[frameact] parking a frame effect failed; running it ungated', error);
    entry.run();
  }
}

let gatingInstalled = false;

/**
 * @internal Install the gate into the frame drains. Called by the first `begin()` of any scope — before
 * that no scope can block, so the drains' defaults (never gating) are exact — and by the store gate when
 * it loads (its sampling must bracket every drain from then on). Idempotent.
 */
export function installGating() {
  if (gatingInstalled) return;
  gatingInstalled = true;
  drainHooks.isGating = isAnyScopeBlocking;
  drainHooks.openSample = openGateSample;
  drainHooks.closeSample = closeGateSample;
  drainHooks.blockingScopeFor = blockingScopeFor;
  drainHooks.park = park;
}

// ---- schedulers that wait for animations (were in core/frame.ts) ----------------------------

/** Runs when the browser is idle and nothing in the node's scope chain is animating. */
export const idle: Schedule = (run, node) => onFullyIdle(run, effectScopeOf(node));

export function createIdleEffect<T>(
  compute: (prev: T | undefined) => T,
  apply: (value: T, prev: T | undefined) => void | (() => void),
  options?: EffectOptions,
) {
  createEffect(compute, apply, idle, { name: 'idle', ...options, immediateApply: false });
}

/**
 * Wrap a scheduler so the run also waits for heavy animations in the node's scope chain
 * (non-blocking by default; frame queues already wait for blocking ones).
 */
export function gateOnHeavyAnimation(schedule: Schedule, options: { blocking?: boolean } = {}): Schedule {
  const blocking = options.blocking ?? false;
  const gated: Schedule = (run, node) => {
    const animating = firstAnimatingScope(effectScopeOf(node), blocking);
    if (animating === null) schedule(run, node);
    else (blocking ? animating.isBlockingAnimating : animating.isAnimating).once(() => gated(run, node));
  };
  if (isDomWritingSchedule(schedule)) markWritesDom(gated);
  if (isDrainGuardedSchedule(schedule)) markDrainGuarded(gated);
  markStoreGated(gated); // an explicit opt-in into waiting for animations: store-caused runs park here too
  return gated;
}

/**
 * Defer creating a heavy subtree until `scope` is idle: returns `placeholder` until then,
 * then a memoized `fn()`. Scopes gate *updates*, not creation — this is the creation gate.
 */
export function deferUntilIdle<T>(scope: HeavyAnimationScope, fn: () => T, placeholder: T): () => T {
  const ready = signal(false);
  createEffect(() => undefined, () => { ready.set(true); }, (run) => onFullyIdle(run, scope), { name: 'deferUntilIdle' });
  return computed(() => (ready() ? fn() : placeholder));
}
```

(The import cycle check: `heavyAnimation.ts` → `frame.ts` → `effects.ts` → `schedulers.ts`; nothing imports `heavyAnimation.ts` at runtime except `index.ts`, `store/gate.ts`, `dom/scope.ts`. No cycle.)

- [ ] **Step 5: `src/store/gate.ts`, `src/index.ts`, `src/dom/scope.ts`**

`gate.ts` imports:

```ts
import { isParked, parkEffect, rebookParked, setStoreGate, type EffectNode } from '../core/effects';
import { effectScopeOf, firstAnimatingScopeSampled, installGating, isAnyScopeAnimating, type HeavyAnimationScope } from '../scheduler/heavyAnimation';
```

and before `setStoreGate((node) => {` add

```ts
installGating(); // the store gate samples animations per drain: the drains must open a sample from now on

```

`index.ts`: the `./core/frame` export becomes `export {\n  createMeasureEffect, createMutationEffect, createRenderEffect, frameMeasure, frameMutation, frameForcedReflow,\n} from './core/frame';` and the `./scheduler/heavyAnimation` export gains the line `  createIdleEffect, idle, gateOnHeavyAnimation, deferUntilIdle,` after `  provideHeavyAnimationScope, currentHeavyAnimationScope, onHeavyAnimation, onFullyIdle,`.

`dom/scope.ts` comment (line 13): `as its \`node._scope\`` → `as their scope (effectScopeOf)`.

- [ ] **Step 6: Tests that reach into the internals**

`test/effects/frame.test.ts`: the first import drops `gateOnHeavyAnimation` from `'../../src/core/frame'` and adds `import { gateOnHeavyAnimation } from '../../src/scheduler/heavyAnimation';` as the second line. In the test `'an error thrown inside the drain loop is isolated per entry; …'`, the gate must be installed before `original` is taken — replace

```ts
  const original = drainHooks.blockingScopeFor;
  let calls = 0;
  drainHooks.blockingScopeFor = (scope, cache) => {
    if (calls++ === 0) throw new Error('hook boom');
    return original(scope, cache);
  };
  // The gate hook is only consulted while some scope blocks: block an unrelated scope.
  const endUnrelated = createHeavyAnimationScope(null).begin(Infinity, true);
  try {
```

with

```ts
  // The gate hook is only consulted while some scope blocks: block an unrelated scope (this also
  // installs the gate into the drains, so `original` below is the real hook).
  const endUnrelated = createHeavyAnimationScope(null).begin(Infinity, true);
  const original = drainHooks.blockingScopeFor;
  let calls = 0;
  drainHooks.blockingScopeFor = (node, cache) => {
    if (calls++ === 0) throw new Error('hook boom');
    return original(node, cache);
  };
  try {
```

`test/effects/gating.test.ts`: first line becomes `import { createMeasureEffect, createMutationEffect } from '../../src/core/frame';` followed by `import { createIdleEffect, gateOnHeavyAnimation, deferUntilIdle } from '../../src/scheduler/heavyAnimation';`; every `._releaseArmed` → `.releaseArmed`, every `._parked` → `.parked` (7 places).

- [ ] **Step 7: Tests, lint, typecheck, chrome lane, reactivity checks**

`pnpm check` → 1031 passed (the gating suite exercises park/release/measure-before-mutate/ended-mid-drain/throwing-once with the hooks now installed by `begin`). `pnpm test:chrome` → 9/9. `node bench/reactivity/run.mjs --check` → passes.

- [ ] **Step 8: Measure**

`node bench/krausest/run.mjs --frameworks frameact --check`, then the brotli one-liner of Task 2: expected `39259 12587` (scratch: from `41615 13394`). Region list of an unminified build no longer contains `scheduler/heavyAnimation.ts`; `frame.ts` shrinks from 6 202 to 4 889 B unminified. `--snap`: effect node 140 → 136 B; `ready` −10 kB. `--fp 7`: fetch ≈ 49 ms.

- [ ] **Step 9: Commit**

```sh
git add src/core/frame.ts src/core/effects.ts src/scheduler/heavyAnimation.ts src/store/gate.ts src/index.ts src/dom/scope.ts test/effects/frame.test.ts test/effects/gating.test.ts test/vite/treeshake.test.ts test/vite/fixtures/treeshake/plain.jsx test/vite/fixtures/treeshake/inputs.jsx test/vite/fixtures/treeshake/animation.jsx
git commit -m "perf(scheduler): heavy-animation gating installs itself on the first begin() (or with the store gate); frame/effects no longer import heavyAnimation, effects carry no _scope — apps without heavy animations do not bundle the gate"
```

---

### Task 6 (optional — keep only if the krausest CPU spot check is flat): built-in schedules queue the node, not a per-effect `run` closure; `_writesDom` becomes a flag

**Files:**
- Modify: `src/core/core.ts` (flags), `src/core/effects.ts`, `src/core/frame.ts`, `src/scheduler/schedulers.ts`, `src/scheduler/heavyAnimation.ts` (one line)
- Test: `test/effects/basic.test.ts` (append)

**Interfaces:**
- `Schedule` is unchanged for users: a custom schedule still receives a plain `run: () => void` that is stable per effect (created on the first booking, kept in `_run`). The built-in schedules (`tickEnd`, `frameMeasure`/`frameMutation`/`frameForcedReflow`, and `gateOnHeavyAnimation` wrappers of them) are "node-aware" (`markNodeSchedule`): `bookRun` passes the shared marker `RUN_NODE` and they queue the node itself; `schedulers.ts` gets `onTickEndNode(node)` and a `setTickNodeRunner(fn)` hook (effects.ts installs `runEffect`), so the scheduler module still knows nothing about effects. New flags `F_WRITES_DOM = 4096` (replaces the `_writesDom` field) and `F_NODE_RUN = 8192`, both persistent across `update()`.
- Cost/benefit: −42 kB per 1 000 rows (one closure + its context per effect), one allocation less per effect creation; +147 B brotli. The core-perf plan measured scheduling at ns level: the extra `nodeSchedules.has()` is at construction, the `F_NODE_RUN` test in `bookRun` is a bit test.

- [ ] **Step 1: Write the failing test** — append to `test/effects/basic.test.ts` (and change its first import to `import { createEffect, getRunningEffect, NOT_APPLIED, type EffectNode } from '../../src/core/effects';`):

```ts

it('a custom Schedule gets one stable `run` per effect, created on its first booking; built-in queues never create it', async () => {
  const $a = signal(0);
  const runs: Array<() => void> = [];
  const applied: number[] = [];
  let custom: EffectNode | null = null;
  let builtin: EffectNode | null = null;
  root(() => {
    createEffect(() => { custom = getRunningEffect(); return $a(); }, (v) => { applied.push(v); }, (run) => { runs.push(run); queueMicrotask(run); });
    createEffect(() => { builtin = getRunningEffect(); return $a(); }, () => {});
  });
  await flushMicrotasks();
  expect(applied).toEqual([0]);
  $a.set(1);
  await flushMicrotasks();
  expect(applied).toEqual([0, 1]);
  expect(runs.length).toBe(2);
  expect(runs[0]).toBe(runs[1]);
  expect(custom!._run).toBe(runs[0]);
  expect(builtin!._run).toBeNull(); // tickEnd queues the node itself
});
```

- [ ] **Step 2: `src/core/core.ts`** — the flag list ends

```ts
  /** F_STORE_GATED: the effect's schedule is a frame queue or a gateOnHeavyAnimation wrapper — its store-caused runs wait for heavy animations (set once, in the constructor). */
  F_STORE_GATED = 2048,
  /** F_WRITES_DOM: the effect's apply writes the live DOM — its apply-cleanup on dispose is deferred to the mutate phase (set once, in the constructor; was a boolean field). */
  F_WRITES_DOM = 4096,
  /** F_NODE_RUN: the effect's schedule is node-aware (the built-in queues): it is booked with the node itself and no per-effect `run` closure is ever created (effects.ts). */
  F_NODE_RUN = 8192;
```

and in `update()` both persistent masks gain the two flags: `node._flags = (node._flags & (F_INIT | F_ERRORED | F_LIVE_PIN | F_STORE_GATED | F_WRITES_DOM | F_NODE_RUN)) | F_COMPUTING;` and, in the `finally`, `node._flags &= F_INIT | F_THREW | F_ERRORED | F_LIVE | F_LIVE_PIN | F_STORE_GATED | F_WRITES_DOM | F_NODE_RUN;`.

- [ ] **Step 3: `src/scheduler/schedulers.ts`** — replace `const tickQueue: (NoneToVoidFunction | undefined)[] = [];` with

```ts
const tickQueue: (NoneToVoidFunction | object | undefined)[] = [];
/** Runs a queued node (effects.ts installs it): the core books its effects as nodes, not closures. */
let tickNodeRunner: (node: object) => void = () => {};
/** @internal effects.ts */
export function setTickNodeRunner(fn: (node: object) => void) {
  tickNodeRunner = fn;
}
/** Runs one queued node; a throw is reported, never allowed to drop the rest of its batch. */
function safeRunNode(node: object) {
  try {
    tickNodeRunner(node);
  } catch (error) {
    console.error('[frameact] scheduled callback failed', error);
  }
}
```

after `onTickEnd` add

```ts

/** @internal effects.ts (tickEnd): queue an effect node; the drain runs it through the installed node runner. */
export function onTickEndNode(node: object) {
  tickQueue[tickLen++] = node;
  if (!tickBooked && tickDrainDepth === 0) {
    tickBooked = true;
    Promise.resolve().then(flushTickEndMicrotask);
  }
}
```

and in `flushTickEnd` replace `        safeExec(callback);` with

```ts
        if (typeof callback === 'function') safeExec(callback as NoneToVoidFunction);
        else safeRunNode(callback);
```

- [ ] **Step 4: `src/core/effects.ts`**

Imports from `./core`: add `  F_NODE_RUN,` (after `F_LIVE_PIN,`) and `  F_WRITES_DOM,` (after `F_THREW,`); the schedulers import becomes `import { getTickDrainEpoch, isTickDraining, onTickEnd, onTickEndNode, setTickNodeRunner } from '../scheduler/schedulers';`. In `EffectNode`: `  _run: () => void;` → `  /** @internal the \`run\` handed to a custom Schedule, created on the first booking (\`runOf\`); never for node-aware schedules (F_NODE_RUN) */\n  _run: (() => void) | null;`; delete `  /** @internal its apply writes the live DOM: apply-cleanups on dispose are deferred to the mutate phase */\n  _writesDom: boolean;`. Before `const drainGuardedSchedules = new WeakSet<Schedule>();` insert:

```ts
/**
 * Node-aware schedules (the built-in queues: tickEnd, the frame queues, gateOnHeavyAnimation wrappers of
 * them) are booked with `RUN_NODE` as `run` and queue the node itself; a custom Schedule gets a real
 * per-effect closure, created on its first booking and kept (`runOf`). One closure and its context less
 * per effect on the default paths.
 */
const nodeSchedules = new WeakSet<Schedule>();

/** @internal frame.ts / tickEnd: mark a schedule that runs the node it is given, never `run`. */
export function markNodeSchedule(schedule: Schedule) {
  nodeSchedules.add(schedule);
}

/** @internal */
export function isNodeSchedule(schedule: Schedule) {
  return nodeSchedules.has(schedule);
}

/** @internal the `run` a node-aware schedule receives: a marker, never called by them. */
export const RUN_NODE: () => void = () => {
  if (DEV) throw new Error('[frameact] internal: a node-aware schedule must run the node it was given, not `run`');
};

/** @internal the effect's `run` for schedules that need a plain function (parking, custom schedules); created once. */
export function runOf(node: EffectNode): () => void {
  return (node._run ??= () => runEffect(node));
}

/** @internal frame.ts drains run queued nodes through this. */
export function runEffectNode(node: EffectNode) {
  runEffect(node);
}

```

In `tickEnd`: the loop-guard macrotask body `      node._selfDirty = 0;\n      run();` → `      node._selfDirty = 0;\n      if (run === RUN_NODE) runEffect(node);\n      else run();`, and the final `  onTickEnd(run);` → `  // Booked by bookRun (node-aware): the node goes into the queue; through a custom wrapper: its \`run\`.\n  if (run === RUN_NODE) onTickEndNode(node);\n  else onTickEnd(run);`; after `markDrainGuarded(tickEnd);` add `markNodeSchedule(tickEnd);` and `setTickNodeRunner(runEffectNode as (node: object) => void);`. In the `Effect` constructor replace

```ts
  this._bailed = null;
  const node = this;
  this._run = () => runEffect(node);
  this._name = options?.name;
  this._selfDirty = 0;
  this._writesDom = options?.writesDom ?? domWritingSchedules.has(schedule);
  this._tickEpoch = 0;
```

with

```ts
  this._bailed = null;
  this._run = null;
  this._name = options?.name;
  this._selfDirty = 0;
  this._tickEpoch = 0;
```

and after `  if (storeGatedSchedules.has(schedule)) this._flags |= F_STORE_GATED;` add

```ts
  if (options?.writesDom ?? domWritingSchedules.has(schedule)) this._flags |= F_WRITES_DOM;
  if (nodeSchedules.has(schedule)) this._flags |= F_NODE_RUN;
```

In `bookRun`: `    node._schedule(node._run, node);` → `    node._schedule(node._flags & F_NODE_RUN ? RUN_NODE : runOf(node), node);`.

- [ ] **Step 5: `src/core/frame.ts`** — imports: `import { STATE_DISPOSED } from './core';` → `import { F_WRITES_DOM, STATE_DISPOSED } from './core';`; the `./effects` list gains `  markNodeSchedule,` (after `markDrainGuarded,`), `  RUN_NODE,`, `  runEffectNode,`, `  runOf,` (after `NOT_APPLIED,`). The P3b comment: `(its \`_run\` is the run)` → `(booked with RUN_NODE, or with its own \`run\`)`. `enqueue`: `run === node._run ? node : { run, node, phase }` → `run === RUN_NODE || run === node._run ? node : { run, node, phase }`. In `drain`: `drainHooks.park(blocker, isNode ? { run: node._run, node, phase } : (item as FrameEntry));` → `drainHooks.park(blocker, isNode ? { run: runOf(node), node, phase } : (item as FrameEntry));` and `        if (isNode) node!._run();` → `        if (isNode) runEffectNode(node!);`. After `markWritesDom(frameMutation);` add

```ts
// Booked with the node itself: no per-effect `run` closure (effects.ts RUN_NODE).
markNodeSchedule(frameMeasure);
markNodeSchedule(frameMutation);
markNodeSchedule(frameForcedReflow);
```

In the apply-cleanup disposer: `if (node._writesDom && getPhase() !== 'mutate')` → `if (node._flags & F_WRITES_DOM && getPhase() !== 'mutate')`.

- [ ] **Step 6: `src/scheduler/heavyAnimation.ts`** — the effects import gains `isNodeSchedule, markNodeSchedule,` (alphabetical: `createEffect, isDomWritingSchedule, isDrainGuardedSchedule, isNodeSchedule, markDrainGuarded, markNodeSchedule, markStoreGated, markWritesDom,`), and in `gateOnHeavyAnimation` after `if (isDrainGuardedSchedule(schedule)) markDrainGuarded(gated);` add `  if (isNodeSchedule(schedule)) markNodeSchedule(gated); // it hands \`run\` through untouched`.

- [ ] **Step 7: Tests, lint, typecheck, chrome lane, reactivity** — `pnpm check` → 1032 passed; `pnpm test:chrome` → 9/9; `node bench/reactivity/run.mjs --check` → passes; `node bench/reactivity/run.mjs -- --framework frameact,alien --suite kairo,s` within noise of `results/latest.md` (the default `tickEnd` path now books nodes: one allocation less per effect *creation*, no change per run).

- [ ] **Step 8: Measure and decide**

`--snap`: `run 1k − ready` −42 kB vs Task 5 (scratch 11 006 → 10 964 kB), the `closure ` row 5 012 → 4 012 per 1 000 rows, effect node 136 → 132 B. Bundle 39 725 B / 12 734 B brotli (+147 B). CPU: upstream's runner on the base and on this build (Task 1's variant directory, `--count 7 --benchmark 01_run1k 02_replace1k 05_swap1k 07_create10k 09_clear1k_x8`): keep the task if every median is within ±3 % of the base; otherwise drop the commit (`git reset --hard HEAD~1`) and note it under "Not done".

- [ ] **Step 9: Commit**

```sh
git add src/core/core.ts src/core/effects.ts src/core/frame.ts src/scheduler/schedulers.ts src/scheduler/heavyAnimation.ts test/effects/basic.test.ts
git commit -m "perf(core): built-in schedules queue the effect node itself (no per-effect run closure); _writesDom becomes a flag"
```

---

### Task 7: re-run krausest, refresh results and README

**Files:**
- Modify: `bench/krausest/results/raw/*.json`, `bench/krausest/results/latest.md`, `bench/krausest/results/machine.json`, `bench/krausest/results/correctness.json`, `bench/krausest/README.md`

- [ ] **Step 1: Stop the hand-started server, remove the variant directories, run the benchmark on an idle machine**

```sh
pkill -f "tsx index.ts"; rm -rf bench/krausest/.upstream/frameworks/keyed/frameact-* bench/krausest/.snaps
uptime      # 1-minute load < 8, no browser/IDE churn; ~40 min, Chrome windows will open
pnpm bench:krausest
```

(All seven frameworks, so the geomeans stay comparable with the previous snapshot; `--frameworks frameact,solid,svelte,vanillajs` is the fallback if time is short — then say so in the README.) If an iteration times out (`protocolTimeout`), re-run that benchmark alone with `--keep` as the README describes.

- [ ] **Step 2: Update `bench/krausest/README.md`**

- Line 67 (`- Размер бандла: 45 КБ несжатый / 14.6 КБ brotli (Solid: 11.5 / 4.5 КБ).`) → the new sizes from `results/latest.md` (expected ≈ 39.7 КБ / 12.4 КБ; 12.3 without Task 6).
- The "## Результаты" section: new date, `uptime` lines, the geomean table, the CPU table, the memory line, the "frameact ÷ Solid" line — all from the new `latest.md` (keep the structure; `report.mjs` prints every number).
- "## Наблюдения": rewrite the **Память** bullet with the findings of this plan (per-row objects, in-object sizing, class channel, WeakMap table) and the **Размер** bullet (what is bundled lazily now, what is left: manual order, map variants, core), and add one bullet on first paint: upstream's server compresses on the fly at quality 11, ≈ 1 ms per uncompressed kB, FP − responseEnd is the same ≈ 32 ms as Solid's — the mount is synchronous.

- [ ] **Step 3: Commit**

```sh
git add bench/krausest/results bench/krausest/README.md
git commit -m "bench(krausest): snapshot after the memory/bundle pass"
```

---

## Risks and what guards them

- **Task 2 — an app that writes `use:value` outside compiled JSX** (`setAttribute(el, 'use:value', v)` by hand, `spread(el, { 'use:value': v })`, a `.jsx` file compiled by something other than `frameact/vite`): the directive is not registered and the write is a DEV error naming `registerControlledDirectives()`; in prod it is silently skipped (as any unknown directive was). Guarded by the new `directives.test.ts` case; documented in the function's doc comment. The injection keys on the *source* text `use:value=`/`use:checked=` (also inside strings or comments — a harmless extra registration).
- **Task 2 — module evaluation order**: the injected call sits after the compiler's hoisted imports and `_tmpl$` declarations and before the first statement of the module body, so a module that renders at top level (`render(…)` in `main.jsx`) finds the directives registered. Guarded by the plugin test's index assertion. Across modules: imports are evaluated before the importer's body, and only the importing module's own JSX uses the directives.
- **Task 3 — symbol properties on elements**: a `<form>` (or any element) with content-named controls shadows *string* names only; symbol keys are unaffected (the same reasoning as `SLOT` in `reconcile.ts`). A non-extensible element would throw on the write — exactly as `tagSlot` already does. `Object.keys(el)` stays empty (test). The channel contract (`class` and `classList` independent; `class:x` untracked; imperative classes survive) is unchanged: the existing `classes.test.ts` suite covers it and the new test adds the 0/1/2+ transitions.
- **Task 4 — hidden classes**: the first-assignment order of every field is unchanged, so every node kind keeps one hidden class and the core-perf pass's monomorphic reads hold (`test/core/**` pull counts; the reactivity bench's s/createComputations* as the canary). `Object.setPrototypeOf(Effect, ComputeNode)` changes only the constructor function's own prototype (static inheritance), nothing on instances.
- **Task 5 — gating installed lazily**: before the first `begin()` the drains' defaults are exact (no scope can block; the store gate's sampling only matters while a scope animates, and `store/gate.ts` installs it at load anyway). An animation begun mid-drain *before* any other animation ever began: previously `openGateSample` had opened a sample for that drain and the scope's `beganAt` was after it (not counted in that drain); now the sample hooks were installed by `gate.ts` at load (store users) — identical; without the store nobody samples. `effectScopeOf` reads the same context record the constructor read. The gating suite (`test/effects/gating.test.ts`, 12 cases incl. "ends mid-drain", "release lands measure before mutate", "throwing once") runs with the hooks installed through `begin`. `rootScope` as a `/*#__PURE__*/` call: evaluated on first use of any export that references it — all public entry points do (`beginHeavyAnimation`, `currentHeavyAnimationScope`, …).
- **Task 6 — custom schedules**: still receive a plain, per-effect, stable `run` (test). A custom schedule that *wraps* a built-in queue (`(run, node) => frameMutation(run, node)`) passes the lazily created `run`, and `enqueue` still recognises `run === node._run` (no `FrameEntry` allocation per booking, as before). Node-aware wrappers created by `gateOnHeavyAnimation` are marked so they pass `RUN_NODE` through. The `tickEnd` loop-guard macrotask and parking (`runOf`) keep a real function where one is called. `RUN_NODE` throws in DEV if a node-aware schedule ever calls it.

## Not done, and why (so it is not re-tried blind)

- `For order="manual"` split (≈ 1.5 kB brotli): `order` is a runtime prop; shaking it needs an API change (a `ForManual` component or an explicit `import 'frameact/dom/manual-order'`), which is a spec decision — open question below.
- `map.ts` (3 map variants, 3.2 kB brotli in isolation): runtime-dispatched on `keyed`; de-duplicating the three update loops is a refactor of transactional code with no measured hot spot.
- The store-walk branches in `notify()`/`write()` behind a hook (≈ 0.5 kB brotli): the hottest function of the core, measured at ≤ 2 % in the core-perf pass; not worth a second notify.
- Prod error strings (11 messages ≈ 250 B brotli): the only diagnostics a prod build has.
- Index node per row when the mapper ignores `index` (84 B + a 48 B bound function per row): the design deliberately passes the accessor always (`(item, ...rest)` and default-parameter mappers); a lazy index node would still need a closure per row. Left.
- `_tickEpoch/_tickRuns` + `_drainEpoch/_drainRuns` merged into one pair (−8 B/effect): a custom schedule that alternates an effect between `tickEnd` and a frame queue would reset the shared counter on each switch — an (absurd) semantic corner; not worth it.
- Chrome's `measureUserAgentSpecificMemory` "run memory" gap to Solid is now mostly Blink layout memory of the same DOM, outside frameact's control; the ready gap (0.7 vs 0.6 MB) is the remaining 28 kB of code.

## Open questions

1. `For order="manual"` out of the default bundle: `ForManual` (new export, `For order` removed) vs. an explicit side-effect import that registers the manual diff (keeps the prop; a missing import would fall back to the ordinary diff — a silent behaviour change, so it would need a DEV error) vs. leave it (1.5 kB). Spec §3.3 decision.
2. Task 6's +147 B brotli for −42 B/row: worth it? The plan says keep if CPU is flat; the final call is the implementer's with the numbers in hand.
3. Should `bench/krausest/heap.mjs` become part of `pnpm bench:krausest` (append the snapshot deltas to `latest.md`)? Not in this plan; it is a diagnostic.

## Prototype CPU / first paint (scratch s6 vs base, same run — filled in by the investigation)

Upstream's `benchmarkRunner` (`--count 7`, visible window, upstream's CPU throttling for 05 and 09), medians of `total` / `script` / `paint` in ms; the base ran at load average 7.8–8.1, s6 at 5.7, so the totals carry a few % of load noise in s6's favour — the `script` columns (JS time only) are the ones to read:

| benchmark | base total / script / paint | s6 total / script / paint |
| --- | ---: | ---: |
| 01_run1k (create 1k) | 39.2 / 5.3 / 28.3 | 36.0 / 4.5 / 27.5 |
| 02_replace1k | 38.5 / 8.5 / 28.2 | 38.4 / 7.6 / 27.4 |
| 05_swap1k (×4 throttled) | 25.1 / 3.7 / 19.9 | 21.8 / 3.4 / 18.4 |
| 07_create10k | 367.5 / 42.7 / 318.0 | 346.7 / 37.7 / 302.6 |
| 09_clear1k_x8 (×4 throttled) | 17.9 / 13.5 / 1.9 | 15.6 / 12.9 / 1.3 |

No regression anywhere; script time is 8–15 % lower on create/replace (fewer allocations per row: no Set, no PropertyArrays, no `_run` closure, no `_scope` lookup) — consistent across the five benchmarks, so Task 6 passes its "CPU flat" gate.

First paint, same run, medians of 7 (`heap.mjs --fp 7 --trace`): **frameact s6 88.1 ms** (js fetch 47.7, FP − responseEnd 32.5, evaluate 2.3) vs **base 94.6** (fetch 52.6, FP − responseEnd 34.6, evaluate 2.6) vs **solid 57.7** (fetch 18.9, FP − responseEnd 31.6, evaluate 1.4): −6.5 ms, of which −5 ms is the fetch of 6.3 kB less (the server's on-the-fly brotli), the rest evaluate. The remaining 30 ms to Solid are 28 kB of code served through the same compressor — inherent to the size of the runtime (core 30 kB unminified alone), not to the frame architecture.

js-reactivity-benchmark (kairo + s suites, frameact next to `alien`, same run; `bench/reactivity/run.mjs -- --framework frameact,alien --suite kairo,s`): family geomeans relative to alien-signals, base **kairo 1.59× / s 1.62×** → s6 **1.51× / 1.53×** (back-to-back runs, minimum of 3 samples each; s/createComputations1to1 17.1 → 15.8 ms, 1to2 14.3 → 12.9 ms — the in-object node layout of Task 4 — the rest within the ±0.1 run-to-run noise). Both runs' checks (adapter tests with exact pull counts, typecheck, prod build, smoke of all 5 suites) passed.

## Self-review (done while writing the plan)

- Spec coverage: §3.3 controlled inputs ("директива `use:value` …") — behaviour untouched once registered, the plugin owns the registration (§3.6 is the plugin's contract: `compilerOptions` unchanged, one extra Babel plugin); §3.3 class token diff — contract unchanged, representation only; §3.2 effects/schedulers — node fields and `Schedule` contract for users unchanged; §3.2 heavy-animation scopes — the gate moves module, semantics kept (Risks); §3.5 store gate — `installGating()` at `gate.ts` load keeps the per-drain sampling exactly where it was.
- Placeholder scan: one, by design — the CPU / first-paint block above, filled from the measurement run.
- Type consistency: `computationConstructor: Function` (oxlint clean in scratch), `initComputationNode`'s arrow keeps the five-argument signature used by `effects.ts` and `selector.ts`; `drainHooks.blockingScopeFor(node: EffectNode, …)` — `frame.test.ts`'s stub passes its arguments through untyped; `EffectNode._run` is `(() => void) | null` and every reader goes through `runOf`/`RUN_NODE`; `tickQueue` holds `object` for nodes and the drain narrows with `typeof === 'function'`.
- Every code block is the text of the scratch worktree (`git diff 91f93ac 9b9948e` in `.worktrees/mem-scratch`, plus its uncommitted `bench/krausest/heap.mjs`). `pnpm check` there: 73 files, 1032 tests, no lint output; `pnpm test:chrome`: 9/9.
