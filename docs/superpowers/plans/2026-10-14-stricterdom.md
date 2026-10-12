# frameact stricterdom + DEV attribution — Implementation Plan (plan 4 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `frameact/stricterdom` — the DEV guard that turns the phase discipline into a checked invariant at the DOM-API level (a port of teact's `stricterdom.ts` + `layoutCauses.ts` with the telegram-tt exceptions), every violation attributed to its effect as `Message > MessageMeta > span.style:color [mutate]` — plus the DEV profiler (run counters, "why did this run", slow-run / slow-drain warnings), the production contract of `flushSync()`, and a headless-Chrome test lane for what jsdom cannot do.

**Architecture:** The core gains a tiny DEV attribution layer (`src/core/debug.ts`: owner-chain names; `notify()` stamps which signal scheduled an effect; three observer hooks — around-apply, per-run, per-drain). `src/stricterdom/stricterdom.ts` patches the layout-forcing getters/methods of the prototypes (`onMeasure` → violation when the scheduler's phase is not `measure`) and observes `document.body` with a `MutationObserver` — but **never waits for the observer callback**: the records are taken (`takeRecords`) at every phase change and right before and after every effect apply outside the mutate phase, so a violation is judged in the phase it happened in (no false positives inside `flushSync`) and is reported while `currentEffect` names the culprit — and only the culprit. `forceMutation`/`suppressStrict`/`setHandler` keep teact's contract; `forceMeasure` opens its window in the mutate phase and is a plain call anywhere else; the existing `strictHooks.forceMutation` seam of `render()`/`Portal` is pointed at the real implementation by `enableStrict()`. `runlog.ts` consumes the hooks. `fasterdom.ts` counts the depth of the running phase segment, and `flushSync()` throws inside one (and is allowed anywhere else, in production too). Everything is behind `DEV`: in a production build the module is thin wrappers.

**Tech Stack:** TypeScript 7 (strict), pnpm, Vite 8 + vitest 5 + jsdom 30, oxlint; Google Chrome for the optional `pnpm test:chrome` lane. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-11-frameact-design.md` — §3.4 (`stricterdom`, authoritative; rewritten by Task 6 to the design below), §3.1 (`flushSync`, rewritten by Task 5), §3.3 (`selectionStart/End` in layoutCauses, the strict seam of `render`/`Portal`), §4 (files), §5 (stricterdom tests). Brief: `.superpowers/plan4-context.md`; audit (telegram-tt usage of the API): `.superpowers/client-readiness-audit.md` §1.2, §5 (main checkout `/Users/denisurevic/Documents/frameact`). Sources: teact `src/lib/fasterdom/stricterdom.ts` + `layoutCauses.ts` (`/Users/denisurevic/Documents/teact`, MIT), telegram-tt's variant for the exceptions (`/Users/denisurevic/Documents/frameact/.cache/telegram-tt/src/lib/fasterdom/stricterdom.ts`, **GPL-3.0 — read for behaviour, do not copy**; the exceptions are a few lines re-expressed in this plan).

## Global Constraints

- Package name `frameact`, `"type": "module"`, Node ≥ 22.12, pnpm. Worktree `/Users/denisurevic/Documents/frameact/.worktrees/stricterdom`, branch `feat/stricterdom` (base commit **063af48** = `feat/store` with plan 3's final fix round: store prototype-pollution hardening, document natives (M1), the store-gate release through a measure task (R1, `releaseInFrame` in `src/core/frame.ts`), store descriptors/`keys`/`values`/`entries` (P1), batched array writes (P2), store leaves released with their last reader via `createLeafNode` + the core's `unlinkDeps` hook (P3), the gate chain cache (P4)); never touch `docs/assets/*`.
- Toolchain already installed (do not change versions): `typescript@^7.0.2`, `vite@^8.3.4`, `vitest@^5.0.3`, `jsdom@^30.1.2`, `oxlint@^1.87.0`, `@solidjs/babel-plugin@2.0.0-rc.14` (exact). **No new dependencies in this plan.**
- `pnpm check` (= `pnpm lint && pnpm typecheck && pnpm test`) must be clean — 0 errors, **0 warnings** — after every task. `pnpm lint` exits 0 even with warnings and prints them as `warning …` lines: **read its output** (it must print nothing but the command lines). A lint *error* (e.g. `eslint(no-unassigned-vars)`) fails `pnpm check` before vitest runs — a `grep` for `Tests` then prints nothing; look at the tail of the output.
- oxlint: `no-underscore-dangle` is **on** outside `src/core/**`, `test/core/**`, `test/effects/**` — `src/stricterdom/**` and `test/stricterdom/**` never touch `node._name`/`_dirtyDep`/… as identifiers (the core exports `getRunningEffect`, `getEffectDebugInfo`, `setRunObserver`, `setApplyHook`, `setDrainObserver`, `getDrainingPhase`, `effectPath`, `describeNode`; `id` and the `SCOPE` symbol have no underscore). Also on: `unicorn/consistent-function-scoping` (hoist helpers that capture nothing to module scope — `.mjs` under `test/` included), `unicorn/no-array-reverse` and `unicorn/no-array-sort` (`toReversed`/`toSorted` are unavailable with lib ES2022: write the loop), `no-shadow`, `no-unused-vars` (prefix unused params with `_`), `eslint(no-unassigned-vars)` (a `let box!: T` assigned only through a JSX `ref={box}` is an error — use `ref={(el) => { box = el; }}`). `test/chrome/vite.config.ts` is inside tsconfig's `include`: its `.ts`-extension import of the plugin (which keeps Vite's config loader from warning, as in the root `vitest.config.ts`) carries a `// @ts-expect-error TS5097` line.
- Dev-only code is guarded by `DEV` from `src/env.ts`; never bare `__DEV__`. Every public function of `frameact/stricterdom` starts with `if (!DEV) return cb()` / `return` so that a production build keeps only thin wrappers; the DEV fields added to effect nodes are initialised only under `if (DEV)` (one hidden class per mode).
- Core API exactly as exported by `src/index.ts` and the core files: `createEffect(compute, apply, schedule?, options?)` with the first apply **scheduled** for tickEnd effects and **synchronous** for mutation/render effects; apply halves run with no owner; `createComponent(Comp, props, name)` always creates an owner scope and labels it `name` in DEV; effects carry `id = options.name ?? 'effect'` in DEV; the compiler's `sourceNames` labels are `div.class`, `span.children`, `span.style:color`, `use:value`.
- Phase discipline (what stricterdom checks): no live-DOM writes outside the mutate phase except through `forceMutation`/the seam; no layout reads in the mutate phase except through `forceMeasure`. The runtime itself must pass under `enableStrict()` (Task 3's app suite is the gate).
- Error resilience: a throwing `setHandler` handler propagates to the caller of a layout read (a test may want that) but is caught and logged in the observer/drain paths; the record drains called from the phase listener and the apply hook catch everything (a throw there would skip a fasterdom segment's tasks or leave `currentEffect` swapped); the run/drain observers run inside the drain's per-entry `try/catch`; nothing in stricterdom throws into a notify walk. DOM reads in stricterdom go through `getNatives()` / `Element.prototype` (`document.contains`, `document.body` and a form's properties can be shadowed by content-named elements — M1).
- Tests: vitest + jsdom; files that need frames use `useDomHarness()` (`test/helpers/dom.ts`); never `expect` inside a scheduler task or an effect apply (log into arrays, assert after `flushSync()`/`await frame()`); DEV-error assertions use `vi.spyOn(console, …)` released by the harness's `vi.restoreAllMocks()` or by `mockRestore()`; **no time-based guards** (the slow-run tests mock `performance.now`); every test that calls `enableStrict()` calls `disableStrict()` in `afterEach` (the patches are module-global), disposes its roots and runs `flushSync()` there; under strict, a test's own `container()` append is a measure-phase write — wrap it in `suppressStrict(container)`; a compiled `.tsx` test file registers its delegated events once at load and the harness clears delegation after every test, so `beforeEach` calls `delegateEvents([...])` again.
- Commits: stage **explicit paths only** (never `git add -A` / `git add .`); message ends with the implementer's own trailer `Co-Authored-By: <your model name> <noreply@anthropic.com>` (substitute your model's name, e.g. `Claude Sonnet 4.5`).
- Third-party code keeps an `// Adapted from <repo> (<license>, © <holder>)` header and is listed in `THIRD_PARTY_LICENSES.md` (Task 2 adds the two stricterdom files under the teact entry).

## Scope decisions

Facts established while writing this plan. **Every code block below was applied from this document and run in a scratch worktree** (first on fa66103 in `.worktrees/stricterdom-scratch`; re-verified after the pre-flight fixes in `.worktrees/pf4`, detached at **063af48**, tasks applied in order by a script that reads the blocks of this file; `pnpm check` green after every task: 956 → **962 → 976 → 980 → 985 → 989 → 992** tests, oxlint 0 warnings, tsc 0 errors; `pnpm test:chrome` 9/9 with Google Chrome at `/Applications/Google Chrome.app`).

1. **Records are judged at phase changes and after applies, not in the observer callback.** teact checks `MutationRecord`s when the observer fires (a microtask) against the phase at that moment. frameact runs whole passes synchronously in `flushSync()` (tests, the iOS/VT contract of Task 5): the callback would arrive after the pass with phase `measure` and flag every legitimate mutate-phase write. So stricterdom subscribes to `onPhaseChange` (already exported by `fasterdom.ts` for this purpose) and drains `observer.takeRecords()` at every change, checking them against the phase that **ended**; the callback itself handles only records produced outside any pass (event handlers), with the current phase. Bonus: the core calls an **apply hook** (`setApplyHook`, DEV) right before every apply (`currentEffect` is still the enclosing effect or null) and at its end (`currentEffect` is the effect), and stricterdom drains at both points when the phase is not `mutate` — a tickEnd/measure effect writing the DOM is attributed to its path synchronously (the observer callback would never know the effect), and a write that was already pending when the apply started (an event handler that wrote a signal and then the DOM: in a browser the tickEnd drain runs *before* the observer callback; a raw measure task before a measure effect) is not pinned on it. Writes from a *compute* half are attributed to the context around the run (follow-up 1).
2. **The phase is the scheduler's.** teact keeps `phase` inside stricterdom and fasterdom calls `setPhase`. frameact's phase lives in `fasterdom.ts` (production code needs it: `applyCleanupDisposer`, the measure-dirtied warning); stricterdom reads `getPhase()` and `forceMeasure` overrides it **locally** (`forcedPhase`) for the layout check, draining records before (legitimate, discarded) and after its callback (a write inside the window is a violation).
3. **`suppressStrict` is a counter**, not teact's unpatch/repatch: re-entrant, cheap; records produced inside the window are discarded (`takeRecords`) when the outermost call ends, and records pending *before* it are drained first (an earlier violation is still reported).
4. **`forceMutation(cb, nodes, allowAnyPhase?)` has telegram-tt's third argument**; the seam `strictHooks.forceMutation(cb, target)` used by `render()`/`Portal` sanctions without a phase precondition (a `render()` into a detached-then-attached NodeView adapter may legitimately run from either phase). The sanction covers records whose target is one of `nodes`; a nested sanction of the same node (a Portal inside a Portal, both into `<body>`) does not end the outer one (only the nodes a call added are removed when it ends). `forceMutation` inside the mutate phase without `allowAnyPhase` throws as in teact. **`forceMeasure` never throws** (controller decision): in the mutate phase it switches the phase to `measure` locally for its callback; in any other context it is a plain `cb()` — layout reads are allowed there anyway, and kit helpers call it from both contexts. Production: plain calls.
5. **Error shape.** Violations are `StrictViolationError extends Error` with `kind: 'measure' | 'mutation'`, `detail` (the getter/method/attribute name or `childList` — the field is not called `cause` because `Error.cause` exists and TS7 demands `override`), `phase`, `path` (or null outside effects), `target` (mutations). Messages: `` [frameact/stricterdom] Unexpected measurement `offsetHeight` in Message > MessageMeta > span.style:color [mutate] `` and `` [frameact/stricterdom] Unexpected mutation `class` of <button id="send"> outside an effect [measure] ``. The default handler is `(e) => console.error(e)` evaluated at call time (so a `vi.spyOn(console, 'error')` installed later still sees it).
6. **Exceptions:** detached targets (`document.contains`), nodes whitelisted by `forceMutation`, anything under `[data-stricterdom-ignore]` (`IGNORE_SUBTREE_ATTR`), `data-*` attributes, `details[open]`, and `childList` on an editable host. telegram-tt tests `target.contentEditable` — a string that is `"inherit"` for every element, i.e. always truthy, so tt never reports a `childList` violation at all; frameact uses `isContentEditable` (when it is a boolean) with a `closest('[contenteditable]:not([contenteditable="false"])')` fallback for jsdom, which has neither property. `characterData` is not observed (teact parity: `insert` writes text through `.data`).
7. **What jsdom cannot patch** (`Object.getOwnPropertyDescriptor(...).get` is missing or the method is `undefined`): `innerText`, `scrollingElement`, `elementFromPoint`, `scrollIntoViewIfNeeded`, `VisualViewport`, `MouseEvent.layerX/Y`, `Range.getBoundingClientRect`. teact assumes they exist (its method wrapper would throw on `undefined.apply`); the port skips what is absent. The Chrome lane (Task 6) covers them.
8. **Attribution lives in the core** (`src/core/debug.ts`), not only in stricterdom: `frame.ts`'s "measure effect dirtied during the mutate phase" warning uses the same `effectPath` and now names the signal that caused it. `ownerPath` walks `[SCOPE]` collecting `id`s, skipping the generic defaults (`effect`, `computed`, `signal`, `component`) and collapsing consecutive duplicates (`insert` nests a second effect under the same label for function values); facade names (`measure`, `mutation`, `idle`) stay — `Panel > mutation` is informative.
9. **"Why did this run."** `notify()` stamps two module variables right before it calls the effect scheduler — `notifyDep` (the dep whose link reached the effect: a signal or a memo) and `notifyRoot` (the written node at the root of the walk) — and the scheduler hook copies them onto the effect (`_dirtyDep`/`_dirtyRoot`, DEV-only fields). Store leaves get DEV ids `store.<key>` (`store.$TRACK` for the shape signal, `store.$VALUES` for the values signal; assigned right after `createLeafNode`), so the log reads `← signal "store.title" via memo "chatTitle" in ChatList`. The stamps on the effect are cleared when its run ends (an effect must not keep a store leaf alive after P3 released it). Cost: one `if (DEV)` per effect schedule; nothing on the read path.
10. **Run counting.** `_runs` counts the creation run (1 after `createEffect`) and every scheduled run that reached `runEffect`'s compute (parked and bailed runs do not count). The run observer (`setRunObserver`) sees only scheduled runs with their duration (`performance.now()` twice per run, only while an observer is installed); the drain observer (`setDrainObserver`) sees each frame drain's phase, duration and run count. `enableStrict()` installs both (counters + slow warnings); `enableRunLog()` installs them too and additionally logs. `SLOW_RUN_MS = 7` for both the per-run and the per-drain warning. The "slowest" a drain warning names is taken only from runs inside that drain (`getDrainingPhase()`; a tickEnd run just before it is not part of it); the path of an effect is computed once (`WeakMap`: an owner chain never changes).
11. **`flushSync` contract (R3 of the audit).** `fasterdom.ts` keeps `passDepth`, incremented around each phase segment (the rAF segment and the three microtask segments, and the segments `flushSync` itself runs). `flushSync()` throws when `passDepth > 0` — inside a frame effect's compute/apply, a raw frame task, a `forceMeasure` callback, or a nested `flushSync` (the old reentrancy error, same wording prefix `is not reentrant`) — and is otherwise allowed, in production too: an event handler, a store action, a tickEnd effect (a microtask between two rAF segments is *not* inside a segment; a `flushSync` there drains the rAF's still-pending mutations along with its own, FIFO, and the rAF's mutate segment then finds an empty queue). `src/core/flush.ts` (the public `flushSync`) checks `isInFramePass()` first, so inside a pass it throws before it would run pending tickEnd effects mid-pass; outside a pass it is unchanged (`flushTickEnd` is re-entrant, `flushFrame` carries the guard).
12. **Chrome lane.** `test/chrome/{index.html,main.tsx,vite.config.ts,run.mjs}`, `pnpm test:chrome` (not part of `pnpm check`: it needs Chrome; 9 scenarios — the 9th is the browser's microtask order: a handler's DOM write pending when the tickEnd effect applies). `run.mjs` builds through the Vite JS API with a dev build (`mode: 'development'`, `define: process.env.NODE_ENV = "development"` so `DEV` is true and `sourceNames` are on), serves with `vite preview` on port 4178, runs Chrome `--headless=new --dump-dom --virtual-time-budget=10000 --user-data-dir=<tmp, removed afterwards>` and parses the JSON the page put in `data-result` (HTML-unescaped). Under `--dump-dom` Chrome may never paint, so `requestAnimationFrame` may never fire; fasterdom then runs the pass from its 35 ms fallback, and the page's `nextFrame()` helper waits for whichever comes first. Measured: the box of scenario 1 is 48 px + 1 px padding from the measure effect + 1 px from the probe = 50 px.
13. **Licensing.** Port from teact (MIT) with the `Adapted from teact` header; telegram-tt is GPL-3.0 — its three additions (`data-stricterdom-ignore`, `details[open]`, `allowAnyPhase`) are behaviour, re-implemented here from the description; nothing is copied from tt.
14. **Production deadness is tested**, not assumed: `test/stricterdom/production.test.ts` builds an app that calls the whole surface with `vite build` in `production` and `development` mode and checks that the detectors, the observer, the profiler and the core's attribution fields are absent from the first and present in the second.
15. **Not in this plan:** a DEV check "DOM write during a *compute*" (the phase model cannot tell compute from apply inside the mutate drain), observing `characterData`, a `setErrorReporter` for the whole core, benchmarks (plan 5), the client kit (plan 6: it imports the signatures in the Interfaces blocks below).

## File Structure (end state of this plan)

```
package.json / tsconfig.json / vitest.config.ts   + "./stricterdom" export, path, alias (Task 2); "test:chrome" script (Task 6)
.gitignore                                       + test/chrome/dist/ (Task 6)
THIRD_PARTY_LICENSES.md                          teact entry + src/stricterdom/{stricterdom,layoutCauses}.ts (Task 2)
src/core/debug.ts        ownerPath, effectPath, describeNode (Task 1)
src/core/core.ts         notifyDep/notifyRoot, stampNotify before effectScheduler (Task 1)
src/core/effects.ts      _dirtyDep/_dirtyRoot/_runs (DEV), getEffectDebugInfo, setRunObserver, setApplyHook, run timing (Task 1)
src/core/frame.ts        measure-dirtied warning with path + source, setDrainObserver, getDrainingPhase, drain timing (Task 1)
src/core/flush.ts        doc: the production contract; in-pass check before the tickEnd flush (Task 5)
src/store/store.ts       DEV ids on leaf/shape/values signals (Task 1)
src/scheduler/fasterdom.ts   passDepth around segments, isInFramePass, flushSync guard (Task 5)
src/stricterdom/layoutCauses.ts   the table (+ selectionStart/End) (Task 2)
src/stricterdom/stricterdom.ts    StrictViolationError, enable/disable, forceMeasure/forceMutation/suppressStrict/setHandler, detectors, observer (Task 2); profiling switch (Task 4)
src/stricterdom/runlog.ts         run stats, run log, slow run/drain warnings (Task 4)
src/stricterdom/index.ts          the frameact/stricterdom surface (Tasks 2, 4)
test/core/debug.test.ts (1); test/effects/frame.test.ts (+2: Tasks 1, 5); test/scheduler/fasterdom.test.ts (+2: Task 5)
test/stricterdom/stricterdom.test.ts (2), attribution.test.tsx (3), runlog.test.ts (4), index.test.ts + production.test.ts (6)
test/chrome/index.html, main.tsx, vite.config.ts, run.mjs (6)
README.md, README.ru.md, README.zh-CN.md   flushSync bullet (5); feature bullet, status, comparison row, a stricterdom section, roadmap row 4, Development (6)
docs/superpowers/specs/2026-10-11-frameact-design.md   §3.1 flushSync (5); §3.4 rewritten, §4 files, §5 tests + Chrome lane (6)
```

---

### Task 1: Core DEV attribution primitives — `ownerPath`/`effectPath`/`describeNode`, notify stamps, run/drain/apply hooks, store leaf ids

**Files:**
- Create: `src/core/debug.ts`, `test/core/debug.test.ts`
- Modify: `src/core/core.ts` (exports after `effectDisposeHook`; `notify()`), `src/core/effects.ts` (`EffectNode`, `Effect` constructor, `createEffect`, `runEffect`, `applyEffect`, the scheduler hook), `src/core/frame.ts` (`enqueue` warning, `drain`), `src/store/store.ts` (`trackKey`, `trackSelf`, `trackVals`), `test/effects/frame.test.ts` (append one test)

**Interfaces:**
- Consumes: `SCOPE` (`src/core/symbols.ts`); `Computation`, `Scope` (`src/core/types.ts`); `currentEffect`, `getRunningEffect()` (`src/core/effects.ts`); `DEV`.
- Produces (all DEV; `src/core/debug.ts`): `ownerPath(scope: Scope | null): string[]`, `effectPath(node: Scope): string`, `describeNode(node: Computation | null): string`. (`src/core/effects.ts`): `interface EffectDebugInfo { dep: Computation | null; root: Computation | null; runs: number }`, `getEffectDebugInfo(node: EffectNode): EffectDebugInfo | null` (null in prod; `dep`/`root` describe the *pending* run and are cleared when it ends, so a released store leaf is not kept alive), `type RunObserver = (node: EffectNode, ms: number) => void`, `setRunObserver(fn: RunObserver | null): void`, `setApplyHook(fn: ((node: EffectNode) => void) | null): void` — the hook runs twice around every apply: right before it (`getRunningEffect()` is still the enclosing effect or null) and at its end (`getRunningEffect()` is that effect); it must not throw. (`src/core/frame.ts`): `type DrainObserver = (phase: FramePhase, ms: number, runs: number) => void`, `setDrainObserver(fn: DrainObserver | null): void`, `getDrainingPhase(): FramePhase | null` (the phase whose drain is running; always null in prod). (`src/core/core.ts`): `export let notifyDep: Computation | null`, `notifyRoot: Computation | null` (live bindings, read by effects.ts only). Store leaves (made by `createLeafNode`, base 063af48) carry `id: 'store.<key>'` / `'store.$TRACK'` (shape) / `'store.$VALUES'` (values) in DEV. The measure-dirtied warning text becomes `` [frameact] measure effect <path> [mutate] was dirtied during the mutate phase by <describeNode(root)> — it will run next frame. Write that signal from a measure effect or event handler instead. ``

- [ ] **Step 1: Create `src/core/debug.ts`**

```ts
// DEV attribution helpers (spec §3.4): the names along an owner chain and the description of a
// node. The core keeps these here (they read `id` and the owner link) so that frame.ts and
// stricterdom share one format: `Message > MessageMeta > span.style:color`.
import { SCOPE } from './symbols';
import type { Computation, Scope } from './types';

/** Default ids the core gives unnamed nodes: they say nothing about the program and are left out. */
const GENERIC_IDS = new Set(['effect', 'computed', 'signal', 'component']);

/**
 * Names from the root owner down to `scope` itself: component names (the third argument of
 * `createComponent`, set by the compiler's `sourceNames`) and effect names (the compiler's binding
 * labels such as `div.class`, or a facade's `measure`/`mutation`/`idle`). Consecutive duplicates are
 * collapsed (an `insert` nests a second effect under the same label for function values).
 */
export function ownerPath(scope: Scope | null): string[] {
  const upward: string[] = []; // collected from the effect up to the root
  for (let s: Scope | null | undefined = scope; s != null; s = s[SCOPE]) {
    const id = (s as Computation).id;
    if (id === undefined || GENERIC_IDS.has(id)) continue;
    if (upward.length === 0 || upward[upward.length - 1] !== id) upward.push(id);
  }
  const names: string[] = [];
  for (let i = upward.length - 1; i >= 0; i--) names.push(upward[i]); // (no toReversed in lib ES2022)
  return names;
}

/** `Message > MessageMeta > span.style:color`; an unnamed effect with no named owner is `effect`. */
export function effectPath(node: Scope): string {
  const path = ownerPath(node);
  return path.length === 0 ? 'effect' : path.join(' > ');
}

/** `signal "count"`, `memo "fullName" in Message`, `effect "div.class" in Message`; null → `an unknown source`. */
export function describeNode(node: Computation | null): string {
  if (node === null) return 'an unknown source';
  // (a slim signal node has no _compute / owner fields at all: `typeof`, not `!== null`)
  const kind = node._effect === true ? 'effect' : typeof node._compute === 'function' ? 'memo' : 'signal';
  const owner = kind === 'signal' ? [] : ownerPath(node[SCOPE]);
  return `${kind} "${node.id ?? kind}"${owner.length ? ` in ${owner.join(' > ')}` : ''}`;
}
```

- [ ] **Step 2: `src/core/core.ts` — the notify stamps (four edits)**

Edit 1 — after the two hook variables (`let effectScheduler … ; let effectDisposeHook … ;`), replace
```ts
let effectScheduler: (node: Computation) => void = () => {};
let effectDisposeHook: (node: Computation) => void = () => {};
```
with
```ts
let effectScheduler: (node: Computation) => void = () => {};
let effectDisposeHook: (node: Computation) => void = () => {};

/**
 * DEV ("why did this run", spec §3.4): set right before `effectScheduler` is called — the dep whose
 * link reached the effect (a signal or a memo) and the root of the walk (the node that was written).
 * Live bindings: effects.ts reads them inside its scheduler hook. Null outside a walk / in prod.
 */
export let notifyDep: Computation | null = null;
export let notifyRoot: Computation | null = null;
```

Edit 2 — the head of `notify()`: replace
```ts
function notify(node: Computation, state: number, latch: boolean, via: Link | null) {
  const base = notifyTop;
  let l: Link | null = null, // the link `node` was reached through (null: the root, via `via`)
    lc = 0; // the cycle `l`'s level was entered at
```
with
```ts
/** DEV: record the dep that reached the effect being scheduled and the walk's root (see notifyDep). */
function stampNotify(l: Link | null, via: Link | null, rootDep: Computation | null) {
  notifyDep = l !== null ? l.dep : via !== null ? via.dep : null;
  notifyRoot = rootDep;
}

function notify(node: Computation, state: number, latch: boolean, via: Link | null) {
  const base = notifyTop;
  const rootDep = DEV && via !== null ? via.dep : null; // the written node (DEV attribution)
  let l: Link | null = null, // the link `node` was reached through (null: the root, via `via`)
    lc = 0; // the cycle `l`'s level was entered at
```

Edit 3 — the plain-walk branch: replace
```ts
            node._state = state;
            if (flags & (F_UNSURE | F_STORE | F_PARKED)) node._flags = flags & ~(F_UNSURE | F_STORE | F_PARKED);
            if (node._effect && (prev === STATE_CLEAN || flags & F_PARKED)) effectScheduler(node);
            subs = node._subs;
          } else if (flags & (F_UNSURE | F_STORE)) {
            node._flags = flags & ~(F_UNSURE | F_STORE | F_PARKED);
            if (flags & F_PARKED) effectScheduler(node);
            subs = node._subs;
          }
```
with
```ts
            node._state = state;
            if (flags & (F_UNSURE | F_STORE | F_PARKED)) node._flags = flags & ~(F_UNSURE | F_STORE | F_PARKED);
            if (node._effect && (prev === STATE_CLEAN || flags & F_PARKED)) {
              if (DEV) stampNotify(l, via, rootDep);
              effectScheduler(node);
            }
            subs = node._subs;
          } else if (flags & (F_UNSURE | F_STORE)) {
            node._flags = flags & ~(F_UNSURE | F_STORE | F_PARKED);
            if (flags & F_PARKED) {
              if (DEV) stampNotify(l, via, rootDep);
              effectScheduler(node);
            }
            subs = node._subs;
          }
```

Edit 4 — the store-walk CLEAN → dirty branch: replace
```ts
            node._state = state;
            node._flags = (flags & ~F_UNSURE) | F_STORE;
            if (node._effect) effectScheduler(node);
            subs = node._subs;
```
with
```ts
            node._state = state;
            node._flags = (flags & ~F_UNSURE) | F_STORE;
            if (node._effect) {
              if (DEV) stampNotify(l, via, rootDep);
              effectScheduler(node);
            }
            subs = node._subs;
```

- [ ] **Step 3: `src/core/effects.ts` — DEV fields, hooks, timing (seven edits)**

Edit 1 — the import list from `./core`: add `notifyDep,` and `notifyRoot,` between `isFunction,` and `setEffectDisposeHook,` (alphabetical, as the list is):
```ts
  isFunction,
  notifyDep,
  notifyRoot,
  setEffectDisposeHook,
```

Edit 2 — the end of `interface EffectNode`: replace
```ts
  /** @internal frame drain loop guard: runs within `_drainEpoch` */
  _drainRuns: number;
}
```
with
```ts
  /** @internal frame drain loop guard: runs within `_drainEpoch` */
  _drainRuns: number;
  /** @internal DEV only ("why did this run"): the dep whose change scheduled the pending run (a signal or memo); cleared when the run ends */
  _dirtyDep: Computation | null;
  /** @internal DEV only: the node written at the root of that notify walk; cleared when the run ends */
  _dirtyRoot: Computation | null;
  /** @internal DEV only: runs of this effect — the creation run and every scheduled run that reached its compute */
  _runs: number;
}

/** DEV: what dirtied an effect's pending run (null once it ran: a released store leaf is not kept alive), and how often it ran. */
export interface EffectDebugInfo {
  /** The signal/memo whose link reached the effect. */
  dep: Computation | null;
  /** The node written at the root of the walk (the signal or store leaf that changed). */
  root: Computation | null;
  runs: number;
}

/** DEV: null outside DEV. */
export function getEffectDebugInfo(node: EffectNode): EffectDebugInfo | null {
  if (!DEV) return null;
  return { dep: node._dirtyDep, root: node._dirtyRoot, runs: node._runs };
}

/** DEV: called after every completed run of an effect with the time it took (stricterdom's run log). */
export type RunObserver = (node: EffectNode, ms: number) => void;
let runObserver: RunObserver | null = null;
/** @internal stricterdom: observe effect runs (DEV only; a no-op in prod). */
export function setRunObserver(fn: RunObserver | null) {
  if (DEV) runObserver = fn;
}

/**
 * DEV: called twice around every apply — right before it, while `currentEffect` is still the
 * enclosing effect (or null), and at its end, while `currentEffect` is the effect. stricterdom drains
 * mutation records at both points, so a write is attributed to the effect whose apply made it, never
 * to the next apply that happens to drain it. Must not throw (it runs where `currentEffect` is swapped).
 */
let applyHook: ((node: EffectNode) => void) | null = null;
/** @internal stricterdom (DEV only; a no-op in prod). */
export function setApplyHook(fn: ((node: EffectNode) => void) | null) {
  if (DEV) applyHook = fn;
}
```

Edit 3 — in `createEffect`, replace
```ts
  // First compute: synchronous, tracked, under the owner that created the effect.
  if (!computeNode(node)) return;
  if (options?.immediateApply) applyEffect(node);
```
with
```ts
  // First compute: synchronous, tracked, under the owner that created the effect.
  if (!computeNode(node)) return;
  if (DEV) node._runs = 1; // the creation run (not reported to the run observer: nothing dirtied it)
  if (options?.immediateApply) applyEffect(node);
```

Edit 4 — in the `Effect` constructor, replace
```ts
  this._drainEpoch = 0;
  this._drainRuns = 0;
  if (storeGatedSchedules.has(schedule)) this._flags |= F_STORE_GATED;
}
```
with
```ts
  this._drainEpoch = 0;
  this._drainRuns = 0;
  if (DEV) {
    this._dirtyDep = null;
    this._dirtyRoot = null;
    this._runs = 0;
  }
  if (storeGatedSchedules.has(schedule)) this._flags |= F_STORE_GATED;
}
```

Edit 5 — in `runEffect`, the compute/apply block: replace
```ts
  try {
    if (!computeNode(node)) return;
    if (node._applied === NOT_APPLIED || node._value !== node._applied) applyEffect(node);
  } finally {
    // Reset the self-dirty counter only when the whole run (compute AND apply) ended without
    // re-dirtying the node.
    if (node._state === STATE_CLEAN) node._selfDirty = 0;
    // Children that bailed onto us are re-scheduled however this run ended (success or error).
    releaseBailed(node);
  }
}
```
with
```ts
  const t0 = DEV && runObserver !== null ? performance.now() : 0;
  try {
    if (!computeNode(node)) return;
    if (node._applied === NOT_APPLIED || node._value !== node._applied) applyEffect(node);
  } finally {
    // Reset the self-dirty counter only when the whole run (compute AND apply) ended without
    // re-dirtying the node.
    if (node._state === STATE_CLEAN) node._selfDirty = 0;
    // Children that bailed onto us are re-scheduled however this run ended (success or error).
    releaseBailed(node);
    if (DEV) {
      node._runs++;
      if (runObserver !== null) runObserver(node, performance.now() - t0);
      node._dirtyDep = null; // (a store leaf released meanwhile must not stay reachable from here)
      node._dirtyRoot = null;
    }
  }
}
```

Edit 6a — the head of `applyEffect`: replace
```ts
  const outer = currentEffect;
  currentEffect = node;
  const outerInApply = DEV ? setInEffectApply(true) : false;
```
with
```ts
  const outer = currentEffect;
  if (DEV && applyHook !== null) applyHook(node); // records made before this apply belong to the context around it
  currentEffect = node;
  const outerInApply = DEV ? setInEffectApply(true) : false;
```

Edit 6b — the end of `applyEffect`: replace
```ts
  } finally {
    if (DEV) setInEffectApply(outerInApply);
    currentEffect = outer;
  }
}
```
with
```ts
  } finally {
    if (DEV) {
      setInEffectApply(outerInApply);
      if (applyHook !== null) applyHook(node); // still attributed to this effect
    }
    currentEffect = outer;
  }
}
```

Edit 7 — the scheduler hook: replace
```ts
setEffectScheduler((raw) => {
  const node = raw as EffectNode;
```
with
```ts
setEffectScheduler((raw) => {
  const node = raw as EffectNode;
  if (DEV) {
    node._dirtyDep = notifyDep;
    node._dirtyRoot = notifyRoot;
  }
```

- [ ] **Step 4: `src/core/frame.ts` — the warning with a path, the drain observer, the draining phase (four edits)**

Edit 1 — imports: after `import { computed, signal } from './signals';` add
```ts
import { describeNode, effectPath } from './debug';
```

Edit 2 — in `enqueue`, replace the `console.warn(` call's template string
```ts
      `[frameact] measure effect${node?._name ? ` "${node._name}"` : ''} was dirtied during the mutate phase — it will run next frame. Write that signal from a measure effect or event handler instead.`,
```
with
```ts
      `[frameact] measure effect ${effectPath(node)} [mutate] was dirtied during the mutate phase by ${describeNode(node._dirtyRoot)} — it will run next frame. Write that signal from a measure effect or event handler instead.`,
```
and right after `enqueue`'s closing brace (before the two lines `/** @internal */` / `export function isArmed(phase: FramePhase) {`) add
```ts
/** DEV: called after every frame drain with its phase, duration and the number of effect runs (stricterdom's slow-phase warning). */
export type DrainObserver = (phase: FramePhase, ms: number, runs: number) => void;
let drainObserver: DrainObserver | null = null;
/** @internal stricterdom (DEV only; a no-op in prod). */
export function setDrainObserver(fn: DrainObserver | null) {
  if (DEV) drainObserver = fn;
}
/** DEV: the phase whose drain is running, or null (tickEnd and idle runs happen outside any drain). */
let drainingPhase: FramePhase | null = null;
/** @internal stricterdom's run log: which drain an effect run belongs to (always null in prod). */
export function getDrainingPhase(): FramePhase | null {
  return drainingPhase;
}
```

Edit 3 — in `drain`, replace
```ts
  const prevSample = openGateSample(); // the store gate decides once per drain (heavyAnimation.ts)
  try {
```
with
```ts
  const prevSample = openGateSample(); // the store gate decides once per drain (heavyAnimation.ts)
  const t0 = DEV && drainObserver !== null ? performance.now() : 0;
  const outerDraining = DEV ? drainingPhase : null;
  if (DEV) drainingPhase = phase;
  let runs = 0;
  try {
```

Edit 4 — still in `drain`, replace
```ts
        if (isNode) node!._run();
        else (item as FrameEntry).run();
      } catch (error) {
        console.error(`[frameact] ${phase} drain: entry failed`, error);
      }
    }
  } finally {
    closeGateSample(prevSample);
    queues[phase] = [];
    armed[phase] = false;
  }
```
with
```ts
        if (DEV) runs++;
        if (isNode) node!._run();
        else (item as FrameEntry).run();
      } catch (error) {
        console.error(`[frameact] ${phase} drain: entry failed`, error);
      }
    }
  } finally {
    closeGateSample(prevSample);
    queues[phase] = [];
    armed[phase] = false;
    if (DEV) {
      drainingPhase = outerDraining;
      if (drainObserver !== null) drainObserver(phase, performance.now() - t0, runs);
    }
  }
```

- [ ] **Step 5: `src/store/store.ts` — DEV ids for leaves (three edits)**

Base 063af48 creates leaves with `createLeafNode(value, owner, key)` (they are dropped when their last reader goes, P3); a DEV signal node always has an `id` field, so assigning it after creation keeps the hidden class. In `trackKey`, replace
```ts
    s = sigs[key] = createLeafNode(value, node, key);
    node.nsigs++;
    if (DEV) storeStats.leafSignals++;
```
with
```ts
    s = sigs[key] = createLeafNode(value, node, key);
    node.nsigs++;
    if (DEV) {
      storeStats.leafSignals++;
      s.id = `store.${String(key)}`; // "why did this run" names the key (spec §3.4)
    }
```
In `trackSelf`, replace
```ts
    s = node.self = createLeafNode(0, node, SELF);
    if (DEV) storeStats.leafSignals++;
```
with
```ts
    s = node.self = createLeafNode(0, node, SELF);
    if (DEV) {
      storeStats.leafSignals++;
      s.id = 'store.$TRACK';
    }
```
In `trackVals`, replace
```ts
    s = node.vals = createLeafNode(0, node, VALS);
    if (DEV) storeStats.leafSignals++;
```
with
```ts
    s = node.vals = createLeafNode(0, node, VALS);
    if (DEV) {
      storeStats.leafSignals++;
      s.id = 'store.$VALUES';
    }
```

- [ ] **Step 6: Write the failing tests**

`test/core/debug.test.ts`:
```ts
import { createMemo, createMutationEffect, createRoot, createSignal, flushSync } from '../../src/index';
import { createComponent, effect } from '../../src/dom/component';
import { createStore } from '../../src/store/index';
import { describeNode, effectPath, ownerPath } from '../../src/core/debug';
import { getEffectDebugInfo, getRunningEffect, setRunObserver, type EffectNode } from '../../src/core/effects';
import { installFakeRaf } from '../helpers/raf';

let raf: ReturnType<typeof installFakeRaf>;
const disposers: (() => void)[] = [];
beforeEach(() => {
  raf = installFakeRaf();
});
afterEach(() => {
  setRunObserver(null);
  for (const d of disposers.splice(0)) d();
  flushSync(); // deferred apply-cleanups of disposed effects; nothing leaks into the next test
  raf.uninstall();
});

/** A root that is disposed after the test. */
function testRoot(fn: () => void) {
  createRoot((dispose) => {
    disposers.push(dispose);
    fn();
  });
}

/** The effect node of the binding running right now (captured from inside its compute or apply). */
function captureEffect(): EffectNode {
  const node = getRunningEffect();
  if (node === null) throw new Error('no running effect');
  return node;
}

it('effectPath walks the component names down to the binding label and skips generic ids', () => {
  let node!: EffectNode;
  testRoot(() => {
    createComponent(
      () =>
        createComponent(
          () => {
            createMemo(() => 1)(); // a generic "computed" between the owners
            effect(() => 1, () => { node = captureEffect(); }, { name: 'span.style:color' });
            return null;
          },
          {},
          'MessageMeta',
        ),
      {},
      'Message',
    );
  });
  expect(ownerPath(node)).toEqual(['Message', 'MessageMeta', 'span.style:color']);
  expect(effectPath(node)).toBe('Message > MessageMeta > span.style:color');
});

it('consecutive duplicate labels collapse (insert nests a second effect under the same label); a facade name stands alone', () => {
  let inner!: EffectNode;
  let bare!: EffectNode;
  testRoot(() => {
    createComponent(
      () => {
        // insert's shape: the nested effect is created inside the outer COMPUTE (owned by it)
        effect(
          () => {
            effect(() => 1, () => { inner = captureEffect(); }, { name: 'span.children' });
            return 1;
          },
          () => {},
          { name: 'span.children' },
        );
        return null;
      },
      {},
      'Message',
    );
    createMutationEffect(() => 1, () => { bare = captureEffect(); });
  });
  expect(effectPath(inner)).toBe('Message > span.children');
  expect(effectPath(bare)).toBe('mutation');
  expect(describeNode(null)).toBe('an unknown source');
});

it('records which signal dirtied an effect (the walk root) and the memo it came through (the dep); counts runs', () => {
  const [count, setCount] = createSignal(0, { id: 'count' });
  let node!: EffectNode;
  testRoot(() => {
    createComponent(
      () => {
        const doubled = createMemo(() => count() * 2, { id: 'doubled' });
        createMutationEffect(() => doubled(), () => { node = captureEffect(); }, { name: 'div.children' });
        return null;
      },
      {},
      'Counter',
    );
  });
  expect(getEffectDebugInfo(node)).toEqual({ dep: null, root: null, runs: 1 });
  setCount(1);
  const info = getEffectDebugInfo(node)!;
  expect(describeNode(info.root)).toBe('signal "count"');
  expect(describeNode(info.dep)).toBe('memo "doubled" in Counter');
  flushSync();
  // cleared once the run is done (a store leaf released meanwhile is not kept alive by the effect)
  expect(getEffectDebugInfo(node)).toEqual({ dep: null, root: null, runs: 2 });
});

it('a store leaf names its key', () => {
  const [state, setState] = createStore({ title: 'a' });
  let node!: EffectNode;
  testRoot(() => {
    createMutationEffect(() => state.title, () => { node = captureEffect(); });
  });
  setState('title', 'b');
  const info = getEffectDebugInfo(node)!;
  expect(describeNode(info.root)).toBe('signal "store.title"');
  expect(info.dep).toBe(info.root);
});

it('the run observer sees every scheduled run with a duration (not the creation run)', () => {
  const [n, setN] = createSignal(0);
  const seen: string[] = [];
  setRunObserver((node, ms) => { seen.push(`${effectPath(node)}:${typeof ms}`); });
  testRoot(() => {
    createMutationEffect(() => n(), () => {}, { name: 'div.title' });
  });
  expect(seen).toEqual([]);
  setN(1);
  flushSync();
  expect(seen).toEqual(['div.title:number']);
});
```

Append to `test/effects/frame.test.ts`:
```ts

it('the measure-dirtied warning names the effect path, the phase and the signal that dirtied it', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const $x = signal(0, { id: 'scrollTop' });
  root(() => {
    createMeasureEffect(() => $x(), () => {}, { name: 'MessageList > measure' });
  });
  await frame(raf); // first measure apply
  const $t = signal(0);
  root(() => createMutationEffect(() => $t(), (v) => { if (v) $x.set(9); }));
  $t.set(1);
  await frame(raf);
  expect(warn).toHaveBeenCalledWith(
    '[frameact] measure effect MessageList > measure [mutate] was dirtied during the mutate phase by signal "scrollTop" — it will run next frame. Write that signal from a measure effect or event handler instead.',
  );
  warn.mockRestore();
});
```

- [ ] **Step 7: Run the new tests, then the full check**

Run: `pnpm vitest run test/core/debug.test.ts test/effects/frame.test.ts`
Expected: `Tests  28 passed (28)` (5 new in debug, 23 in frame). If Steps 1–5 were skipped the debug file fails to import (`debug.ts` missing) — that is the red state.

Run: `pnpm check`
Expected: lint prints nothing but the command lines; tsc 0 errors; `Tests  962 passed (962)` (956 before this task).

- [ ] **Step 8: Commit**

```bash
git add src/core/debug.ts src/core/core.ts src/core/effects.ts src/core/frame.ts src/store/store.ts test/core/debug.test.ts test/effects/frame.test.ts
git commit -m "feat(core): DEV attribution primitives — ownerPath/effectPath/describeNode, notify stamps (why did this run), run/drain/apply hooks, store leaf ids

Co-Authored-By: <your model name> <noreply@anthropic.com>"
```

---

### Task 2: `frameact/stricterdom` — the port (layout detectors, the observer, phase integration, the escapes), wiring, licenses

**Files:**
- Create: `src/stricterdom/layoutCauses.ts`, `src/stricterdom/stricterdom.ts`, `src/stricterdom/index.ts`, `test/stricterdom/stricterdom.test.ts`
- Modify: `package.json` (`exports`), `tsconfig.json` (`paths`), `vitest.config.ts` (`alias`), `THIRD_PARTY_LICENSES.md` (teact entry)

**Interfaces:**
- Consumes: `getPhase`, `onPhaseChange`, `Phase` (`src/scheduler/fasterdom.ts`); `getRunningEffect`, `setApplyHook` (Task 1); `effectPath` (Task 1); `strictHooks` (`src/dom/strict.ts`: `{ forceMutation<T>(cb: () => T, target: Node): T }`); `getNatives` (`src/dom/natives.ts`: `body`, `contains`, `nodeType`, `nodeName`, `localName`, `parentNode` — document clobbering, M1 of base 063af48); `DEV`.
- Produces — the public surface of `frameact/stricterdom` (plan 6 imports these):
  - `enableStrict(): void` — DEV only (production: returns); throws without a `document.body`; idempotent.
  - `disableStrict(): void`; `isStrictEnabled(): boolean`.
  - `forceMeasure<T>(cb: () => T): T` — DEV, in the mutate phase: `cb` runs as a measure window (the layout check is off inside it; a DOM write inside it is a violation). Anywhere else (and with strict off) a plain `cb()` — it never throws: kit helpers call it from both contexts. Production: `cb()`.
  - `forceMutation<T>(cb: () => T, nodes: Node | Node[], allowAnyPhase?: boolean): T` — DEV: throws `[frameact/stricterdom] forceMutation(): the current phase is 'mutate' already` in the mutate phase unless `allowAnyPhase`; records whose `target` is one of `nodes` are not violations (attached descendants of `nodes` are not covered); nested sanctions of the same node keep the outer one in force. Production: `cb()`.
  - `suppressStrict<T>(cb: () => T): T` — both checks off inside, re-entrant.
  - `setHandler(handler?: StrictErrorHandler): void` — `type StrictErrorHandler = (error: StrictViolationError) => void`; no argument restores `console.error`.
  - `class StrictViolationError extends Error { readonly kind: 'measure' | 'mutation'; readonly detail: string; readonly phase: Phase; readonly path: string | null; readonly target: Node | null }` (`name === 'StrictViolationError'`); `type StrictViolationKind = 'measure' | 'mutation'`.
  - `IGNORE_SUBTREE_ATTR = 'data-stricterdom-ignore'`; `LAYOUT_CAUSES: Readonly<Record<string, LayoutCauses>>`, `interface LayoutCauses { props?: readonly string[]; methods?: readonly string[] }`.
  - While strict is on, `strictHooks.forceMutation` sanctions writes to `target` in any phase; `disableStrict()` restores the plain call.

- [ ] **Step 1: Create `src/stricterdom/layoutCauses.ts`**

```ts
// Adapted from teact (MIT, © 2022 Alexander Zinchuk) — https://github.com/Ajaxy/teact src/lib/fasterdom/layoutCauses.ts
// The list of layout-forcing getters and methods: https://gist.github.com/paulirish/5d52fb081b3570c81e3a
// frameact adds `selectionStart`/`selectionEnd` (spec §3.3: the caret is read at event time, in the measure phase).

export interface LayoutCauses {
  props?: readonly string[];
  methods?: readonly string[];
}

/** Keys are global names (`globalThis[name]`): a constructor (its prototype is patched) or the `window` object itself. */
export const LAYOUT_CAUSES: Readonly<Record<string, LayoutCauses>> = {
  Element: {
    props: [
      'clientLeft', 'clientTop', 'clientWidth', 'clientHeight',
      'scrollWidth', 'scrollHeight', 'scrollLeft', 'scrollTop',
    ],
    methods: [
      'getClientRects', 'getBoundingClientRect',
      'scrollBy', 'scrollTo', 'scrollIntoView', 'scrollIntoViewIfNeeded',
    ],
  },
  HTMLElement: {
    props: [
      'offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight', 'offsetParent',
      'innerText',
    ],
    methods: ['focus'],
  },
  window: {
    props: [
      'scrollX', 'scrollY',
      'innerHeight', 'innerWidth',
    ],
    methods: ['getComputedStyle'],
  },
  VisualViewport: {
    props: [
      'height', 'width', 'offsetTop', 'offsetLeft',
    ],
  },
  Document: {
    props: ['scrollingElement'],
    methods: ['elementFromPoint'],
  },
  HTMLInputElement: {
    props: ['selectionStart', 'selectionEnd'],
    methods: ['select'],
  },
  HTMLTextAreaElement: {
    props: ['selectionStart', 'selectionEnd'],
  },
  MouseEvent: {
    props: ['layerX', 'layerY', 'offsetX', 'offsetY'],
  },
  Range: {
    methods: ['getClientRects', 'getBoundingClientRect'],
  },
};
```

- [ ] **Step 2: Create `src/stricterdom/stricterdom.ts`**

```ts
// Adapted from teact (MIT, © 2022 Alexander Zinchuk) — https://github.com/Ajaxy/teact src/lib/fasterdom/stricterdom.ts
// frameact: the phase comes from the scheduler (`getPhase`), mutation records are drained at every
// phase change and around every effect apply (so a violation is reported in the phase it happened
// in and attributed to the effect that was running), `suppressStrict` is a counter instead of an
// unpatch/repatch, and the error carries the attribution path (spec §3.4).
import { DEV } from '../env';
import { getPhase, onPhaseChange, type Phase } from '../scheduler/fasterdom';
import { getRunningEffect, setApplyHook } from '../core/effects';
import { effectPath } from '../core/debug';
import { getNatives } from '../dom/natives';
import { strictHooks } from '../dom/strict';
import { LAYOUT_CAUSES } from './layoutCauses';

export type StrictViolationKind = 'measure' | 'mutation';

/** What stricterdom reports: a layout read outside the measure phase, or a live-DOM write outside the mutate phase. */
export class StrictViolationError extends Error {
  override readonly name: string = 'StrictViolationError';
  constructor(
    /** `measure`: a layout-forcing getter/method was called; `mutation`: a MutationObserver record. */
    readonly kind: StrictViolationKind,
    /** The getter/method name (`offsetHeight`), the attribute name (`class`) or `childList`. (`cause` is taken by `Error`.) */
    readonly detail: string,
    /** The phase the violation happened in. */
    readonly phase: Phase,
    /** `Message > MessageMeta > span.style:color` — the effect that was running, or null. */
    readonly path: string | null,
    /** The mutated node (mutation violations), or null. */
    readonly target: Node | null,
  ) {
    super(
      kind === 'measure'
        ? `[frameact/stricterdom] Unexpected measurement \`${detail}\` ${path === null ? 'outside an effect' : `in ${path}`} [${phase}]`
        : `[frameact/stricterdom] Unexpected mutation \`${detail}\` of ${describeTarget(target)} ${path === null ? 'outside an effect' : `in ${path}`} [${phase}]`,
    );
  }
}

export type StrictErrorHandler = (error: StrictViolationError) => void;

/** `<div class="x">` for the error message (through the prototype natives: a form's controls may shadow its properties). */
function describeTarget(node: Node | null): string {
  if (node === null) return '<unknown>';
  const { nodeType, nodeName, localName } = getNatives();
  if (nodeType.call(node) !== 1) return `#${nodeName.call(node).toLowerCase()}`;
  const getAttribute = Element.prototype.getAttribute;
  let out = `<${localName.call(node as Element)}`;
  const id = getAttribute.call(node as Element, 'id');
  if (id) out += ` id="${id}"`;
  const cls = getAttribute.call(node as Element, 'class');
  if (cls) out += ` class="${cls}"`;
  return `${out}>`;
}

/** Elements under an ancestor with this attribute may be mutated in any phase (a contentEditable composer, third-party widgets). */
export const IGNORE_SUBTREE_ATTR = 'data-stricterdom-ignore';

const DEFAULT_ERROR_HANDLER: StrictErrorHandler = (error) => {
  console.error(error);
};
let onError: StrictErrorHandler = DEFAULT_ERROR_HANDLER;

let isStrict = false;
/** `forceMeasure` overrides the scheduler's phase for the layout-read check while its callback runs. */
let forcedPhase: Phase | null = null;
/** `suppressStrict` nesting depth: > 0 silences both checks. */
let suppressed = 0;
let observer: MutationObserver | undefined;
let unsubscribePhase: (() => void) | undefined;
/** The phase the pending mutation records were produced in (mirrors the scheduler; updated by the phase listener). */
let recordsPhase: Phase = 'measure';
const forcedMutationAllowedFor = new Set<Node>();
/** Undo functions of the installed layout patches (run by `disableStrict`). */
const restores: (() => void)[] = [];

function effectivePhase(): Phase {
  return forcedPhase ?? getPhase();
}

/** The attribution path of the running effect, or null outside effects. */
function runningPath(): string | null {
  const node = getRunningEffect();
  return node === null ? null : effectPath(node);
}

/** The seam used by `render()`/`Portal`: the writes to `nodes` inside `cb` are sanctioned whatever the phase. */
function allowMutation<T>(nodes: Node | Node[], cb: () => T): T {
  if (!isStrict) return cb();
  drainRecords(); // earlier records are judged on their own, not under this whitelist
  // Only the nodes added here are removed at the end: a nested sanction of the same node (a Portal
  // inside a Portal, both mounting into <body>) must not end the outer one.
  const added: Node[] = [];
  for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
    if (forcedMutationAllowedFor.has(node)) continue;
    forcedMutationAllowedFor.add(node);
    added.push(node);
  }
  try {
    return cb();
  } finally {
    drainRecords(); // the callback's records are checked now, with the whitelist in force
    for (const node of added) forcedMutationAllowedFor.delete(node);
  }
}

/**
 * Install the DEV phase checks: layout-forcing getters/methods throw/report outside the measure
 * phase, live-DOM mutations are reported outside the mutate phase. A no-op in production builds
 * (`DEV` is false: the whole module tree-shakes to thin wrappers) and when already enabled.
 */
export function enableStrict(): void {
  if (!DEV || isStrict) return;
  if (typeof document === 'undefined' || !getNatives().body.call(document)) {
    throw new Error('[frameact/stricterdom] enableStrict() needs a document with a <body>');
  }
  isStrict = true;
  setupLayoutDetectors();
  setupMutationObserver();
  recordsPhase = getPhase();
  unsubscribePhase = onPhaseChange((next) => {
    // Records produced since the last change belong to the phase that just ended.
    drainRecordsAs(recordsPhase);
    recordsPhase = next;
  });
  // Around an apply outside the mutate phase: before it, pending records belong to the context
  // around the apply; after it, to the effect (the asynchronous observer callback would know neither).
  setApplyHook(() => {
    if (effectivePhase() !== 'mutate') drainRecords();
  });
  strictHooks.forceMutation = (cb, target) => allowMutation(target, cb);
}

export function disableStrict(): void {
  if (!DEV || !isStrict) return;
  drainRecords();
  strictHooks.forceMutation = (cb) => cb();
  setApplyHook(null);
  unsubscribePhase?.();
  unsubscribePhase = undefined;
  clearMutationObserver();
  clearLayoutDetectors();
  forcedMutationAllowedFor.clear();
  isStrict = false; // (forcedPhase / suppressed are balanced by the try/finally of the windows still open)
}

export function isStrictEnabled(): boolean {
  return isStrict;
}

/**
 * Read layout from the mutate phase (the scroll-anchor pattern: snapshot before writing): inside the
 * mutate phase, `cb` runs as a measure window (layout reads allowed, a DOM write is a violation).
 * Anywhere else it is a plain `cb()` — layout reads are allowed there anyway, and helpers that use it
 * are called from both contexts. Production: `cb()`.
 */
export function forceMeasure<T>(cb: () => T): T {
  if (!DEV || !isStrict || effectivePhase() !== 'mutate') return cb();
  drainRecords(); // records of the mutate phase so far: legitimate, cleared
  forcedPhase = 'measure';
  try {
    return cb();
  } finally {
    forcedPhase = null;
    drainRecordsAs('measure'); // a write inside the measure window is a violation
  }
}

/**
 * Write to `nodes` from the measure phase: a mount into an attached container, an imperative widget.
 * Sanctioned are the records whose target is one of `nodes` (their child lists, their attributes);
 * writes to other attached nodes, their attached descendants included, are still violations. DEV: a
 * precondition error when called in the mutate phase unless `allowAnyPhase` (a helper used from both
 * contexts). Production: `cb()`.
 */
export function forceMutation<T>(cb: () => T, nodes: Node | Node[], allowAnyPhase?: boolean): T {
  if (!DEV) return cb();
  if (!allowAnyPhase && effectivePhase() !== 'measure') {
    throw new Error("[frameact/stricterdom] forceMutation(): the current phase is 'mutate' already");
  }
  return allowMutation(nodes, cb);
}

/** Run `cb` with both checks off (third-party code that reads and writes as it likes). Re-entrant. */
export function suppressStrict<T>(cb: () => T): T {
  if (!DEV || !isStrict) return cb();
  drainRecords(); // violations before the suppressed window are still reported
  suppressed++;
  try {
    return cb();
  } finally {
    if (--suppressed === 0) observer?.takeRecords(); // the window's records are discarded
  }
}

/** Replace the default `console.error` handler; `setHandler()` restores it. */
export function setHandler(handler?: StrictErrorHandler): void {
  onError = handler ?? DEFAULT_ERROR_HANDLER;
}

// ---- layout detectors ---------------------------------------------------------

function setupLayoutDetectors() {
  for (const name of Object.keys(LAYOUT_CAUSES)) {
    const entity = (globalThis as Record<string, unknown>)[name];
    if (!entity) continue;
    const target = (typeof entity === 'object' ? entity : (entity as { prototype: object }).prototype) as Record<string, unknown>;
    const causes = LAYOUT_CAUSES[name];
    for (const prop of causes.props ?? []) {
      const nativeGetter = Object.getOwnPropertyDescriptor(target, prop)?.get;
      if (!nativeGetter) continue; // not implemented here (jsdom lacks some)
      // Only `get` is replaced: an existing setter (scrollTop, innerText) stays.
      Object.defineProperty(target, prop, {
        get() {
          onMeasure(prop);
          return nativeGetter.call(this);
        },
      });
      restores.push(() => Object.defineProperty(target, prop, { get: nativeGetter }));
    }
    for (const method of causes.methods ?? []) {
      const nativeMethod = target[method];
      if (typeof nativeMethod !== 'function') continue;
      target[method] = function (this: unknown, ...args: unknown[]) {
        onMeasure(method);
        return (nativeMethod as (...a: unknown[]) => unknown).apply(this, args);
      };
      restores.push(() => {
        target[method] = nativeMethod;
      });
    }
  }
}

function clearLayoutDetectors() {
  for (const restore of restores.splice(0)) restore();
}

function onMeasure(name: string) {
  if (suppressed > 0) return;
  const phase = effectivePhase();
  if (phase === 'measure') return;
  // Called synchronously from the patched getter: a throwing handler reaches the caller.
  onError(new StrictViolationError('measure', name, phase, runningPath(), null));
}

// ---- mutation observer --------------------------------------------------------

function setupMutationObserver() {
  observer = new MutationObserver((records) => {
    checkRecords(records, effectivePhase());
  });
  observer.observe(getNatives().body.call(document)!, { childList: true, attributes: true, subtree: true, characterData: false });
}

function clearMutationObserver() {
  observer?.disconnect(); // pending records are discarded with it
  observer = undefined;
}

/** Check the pending records against the current phase (synchronous: attributed to the running effect). */
function drainRecords() {
  drainRecordsAs(effectivePhase());
}

function drainRecordsAs(phase: Phase) {
  if (observer === undefined) return;
  try {
    const records = observer.takeRecords();
    if (records.length) checkRecords(records, phase);
  } catch (error) {
    // Called from a phase listener and around applies: nothing here may throw into fasterdom or the core.
    console.error('[frameact/stricterdom] checking mutation records failed', error);
  }
}

function isEditable(el: HTMLElement, closest: Element['closest']): boolean {
  const flag = (el as { isContentEditable?: boolean }).isContentEditable;
  if (typeof flag === 'boolean') return flag;
  return closest.call(el, '[contenteditable]:not([contenteditable="false"])') !== null; // jsdom has no isContentEditable
}

function checkRecords(records: MutationRecord[], phase: Phase) {
  if (phase === 'mutate' || suppressed > 0) return;
  const path = runningPath();
  // Prototype natives: content-named elements may shadow `document.contains` or a form's `closest` (natives.ts).
  const { contains, nodeType, parentNode } = getNatives();
  const closest = Element.prototype.closest;
  for (const { target, type, attributeName } of records) {
    if (!contains.call(document, target)) continue; // detached meanwhile (a subtree removed in the same pass)
    if (forcedMutationAllowedFor.has(target)) continue;
    const element = (nodeType.call(target) === 1 ? target : parentNode.call(target)) as Element | null;
    if (element !== null && nodeType.call(element) === 1 && closest.call(element, `[${IGNORE_SUBTREE_ATTR}]`)) continue;
    if (type === 'childList' && target instanceof HTMLElement && isEditable(target, closest)) continue; // the engine edits a composer
    if (attributeName?.startsWith('data-')) continue; // data-* is state for CSS and scripts, not layout
    if (attributeName === 'open' && target instanceof HTMLDetailsElement) continue; // toggled by the user agent
    const detail = type === 'attributes' ? attributeName! : type;
    try {
      onError(new StrictViolationError('mutation', detail, phase, path, target));
    } catch (error) {
      // A throwing handler must not break a drain or the observer callback.
      console.error(error);
    }
  }
}
```

- [ ] **Step 3: Create `src/stricterdom/index.ts`**

```ts
// frameact/stricterdom — DEV phase checks at the DOM-API level with effect attribution (spec §3.4).
// Every function is a thin wrapper in production (`DEV` false): the detectors, the observer and
// the layout-cause table are dead code there.
export {
  enableStrict, disableStrict, isStrictEnabled, forceMeasure, forceMutation, suppressStrict, setHandler,
  StrictViolationError, IGNORE_SUBTREE_ATTR, type StrictErrorHandler, type StrictViolationKind,
} from './stricterdom';
export { LAYOUT_CAUSES, type LayoutCauses } from './layoutCauses';
```

- [ ] **Step 4: Wire the entry**

`package.json` — in `"exports"`, after the `"./store"` line add
```json
    "./stricterdom": "./src/stricterdom/index.ts",
```
`tsconfig.json` — in `"paths"`, after the `"frameact/store"` line add
```json
      "frameact/stricterdom": ["./src/stricterdom/index.ts"],
```
`vitest.config.ts` — in `resolve.alias`, after the `frameact/store` entry add
```ts
      { find: 'frameact/stricterdom', replacement: src('stricterdom/index.ts') },
```
`THIRD_PARTY_LICENSES.md` — replace the teact file list
```markdown
`src/scheduler/schedulers.ts`, `src/scheduler/fasterdom.ts`, `src/scheduler/heavyAnimation.ts`,
`src/dom/classes.ts`, `src/dom/styles.ts`, `src/dom/directives.ts`, `src/dom/list.ts`
```
with
```markdown
`src/scheduler/schedulers.ts`, `src/scheduler/fasterdom.ts`, `src/scheduler/heavyAnimation.ts`,
`src/dom/classes.ts`, `src/dom/styles.ts`, `src/dom/directives.ts`, `src/dom/list.ts`,
`src/stricterdom/stricterdom.ts`, `src/stricterdom/layoutCauses.ts`
```

- [ ] **Step 5: Write the failing test `test/stricterdom/stricterdom.test.ts`**

```ts
import { createEffect, createMutationEffect, createRoot, createSignal, flushSync, requestMeasure, requestMutation } from '../../src/index';
import { flushSync as flushFrame } from '../../src/scheduler/fasterdom';
import { createComponent } from '../../src/dom/component';
import { render } from '../../src/dom/render';
import { Portal } from '../../src/dom/flow';
import { strictHooks } from '../../src/dom/strict';
import {
  disableStrict, enableStrict, forceMeasure, forceMutation, IGNORE_SUBTREE_ATTR, isStrictEnabled, setHandler,
  StrictViolationError, suppressStrict,
} from '../../src/stricterdom/stricterdom';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();
// captured before any enableStrict(): jsdom's methods are JS, so "native code" cannot be checked
const NATIVE_GBCR = Element.prototype.getBoundingClientRect;

let violations: StrictViolationError[];
const disposers: (() => void)[] = [];
beforeEach(() => {
  violations = [];
  enableStrict();
  setHandler((error) => { violations.push(error); });
});
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  flushSync();
  setHandler();
  disableStrict();
});

/** An attached container, appended under suppressStrict: the append itself would be a violation (phase: measure). */
function attached(): HTMLDivElement {
  return suppressStrict(container);
}

/** A root disposed after the test. */
function testRoot(fn: () => void) {
  createRoot((dispose) => {
    disposers.push(dispose);
    fn();
  });
}

const summary = (v: StrictViolationError) => `${v.kind}:${v.detail}:${v.phase}:${v.path ?? '-'}`;

/** What `<img name="…">` does to `document` in a browser (jsdom has no named properties): an own shadow of a builtin. */
function shadow(name: string) {
  Object.defineProperty(document, name, { value: Document.prototype.createElement.call(document, 'img'), configurable: true });
}

it('enableStrict patches the layout getters/methods on the prototypes; disableStrict restores the natives', () => {
  const patched = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get!;
  const patchedMethod = Element.prototype.getBoundingClientRect;
  expect(isStrictEnabled()).toBe(true);
  // a setter next to a patched getter survives (scrollTop is read-write)
  expect(typeof Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!.set).toBe('function');
  disableStrict();
  expect(isStrictEnabled()).toBe(false);
  expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get).not.toBe(patched);
  expect(Element.prototype.getBoundingClientRect).not.toBe(patchedMethod);
  expect(Element.prototype.getBoundingClientRect).toBe(NATIVE_GBCR);
  enableStrict(); // idempotent with the afterEach
  enableStrict();
});

it('a layout read in the measure phase (idle, event handlers) is fine; in a mutation apply it is a violation with the effect path', () => {
  const el = attached();
  void el.offsetHeight;
  void el.getBoundingClientRect();
  expect(violations).toEqual([]);
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createComponent(
      () => {
        createMutationEffect(() => n(), (v) => { if (v) void el.offsetHeight; }, { name: 'div.style:height' });
        return null;
      },
      {},
      'Panel',
    );
  });
  setN(1);
  flushSync();
  expect(violations.map(summary)).toEqual(['measure:offsetHeight:mutate:Panel > div.style:height']);
  expect(violations[0].message).toBe(
    '[frameact/stricterdom] Unexpected measurement `offsetHeight` in Panel > div.style:height [mutate]',
  );
  expect(violations[0]).toBeInstanceOf(Error);
  expect(violations[0].name).toBe('StrictViolationError');
});

it('selectionStart, focus() and getComputedStyle in the mutate phase are violations; a raw requestMutation task has no path', () => {
  const input = document.createElement('input');
  suppressStrict(() => document.body.appendChild(input));
  requestMutation(() => {
    void input.selectionStart;
    input.focus();
    void getComputedStyle(input);
  });
  flushSync();
  expect(violations.map(summary)).toEqual([
    'measure:selectionStart:mutate:-', 'measure:focus:mutate:-', 'measure:getComputedStyle:mutate:-',
  ]);
  expect(violations[0].message).toBe('[frameact/stricterdom] Unexpected measurement `selectionStart` outside an effect [mutate]');
});

it('a live-DOM write outside the mutate phase is reported through the observer with the target; writes in the mutate phase are not', async () => {
  const el = attached();
  el.setAttribute('class', 'x'); // event-handler time: phase is measure
  await flushMicrotasks();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  expect(violations[0].target).toBe(el);
  expect(violations[0].message).toBe('[frameact/stricterdom] Unexpected mutation `class` of <div class="x"> outside an effect [measure]');
  violations.length = 0;
  requestMutation(() => {
    el.setAttribute('class', 'y');
    el.appendChild(document.createElement('span'));
  });
  await frame(); // a real frame pass: records are drained at the mutate → measure change
  await flushMicrotasks();
  expect(violations).toEqual([]);
});

it('a mutation effect writing in flushSync is not a false positive (records are judged at the phase change, not when the observer fires)', async () => {
  const el = document.createElement('div'); // detached at creation, as the runtime builds subtrees
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createMutationEffect(() => n(), (v) => { el.setAttribute('data-n', String(v)); el.className = `n${v}`; });
  });
  forceMutation(() => document.body.appendChild(el), document.body); // the mount
  setN(1);
  flushSync();
  await flushMicrotasks();
  expect(violations).toEqual([]);
  // ...while a measure task writing in the same flushSync is caught, as 'measure'
  requestMeasure(() => { el.className = 'bad'; });
  flushSync();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
});

it('detached subtrees may be built in any phase; the exceptions: data-*, data-stricterdom-ignore subtrees, details[open], childList inside contentEditable', async () => {
  const el = attached();
  const detached = document.createElement('div');
  detached.className = 'a';
  detached.appendChild(document.createElement('b'));
  el.setAttribute('data-state', 'open');
  const ignored = document.createElement('div');
  ignored.setAttribute(IGNORE_SUBTREE_ATTR, '');
  el.appendChild(ignored); // (this append is itself a violation on `el`: see below)
  await flushMicrotasks();
  violations.length = 0;
  ignored.appendChild(document.createElement('p'));
  ignored.firstElementChild!.className = 'editor';
  const details = document.createElement('details');
  el.appendChild(details);
  await flushMicrotasks();
  violations.length = 0;
  details.open = true;
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', '');
  el.appendChild(editor);
  await flushMicrotasks();
  violations.length = 0;
  editor.appendChild(document.createTextNode('typed')); // the engine's edit
  editor.setAttribute('class', 'focused'); // an attribute write is still a violation
  await flushMicrotasks();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
});

it('forceMutation sanctions writes to the given nodes in the measure phase; it refuses the mutate phase unless allowAnyPhase', () => {
  const el = attached();
  const other = attached();
  forceMutation(() => {
    el.className = 'mounted';
    other.className = 'collateral';
  }, el);
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  expect(violations[0].target).toBe(other);
  violations.length = 0;
  forceMutation(() => { el.className = 'x'; other.className = 'y'; }, [el, other]);
  expect(violations).toEqual([]);
  // a nested sanction of the same node (a Portal inside a Portal, both into <body>) keeps the outer one in force
  forceMutation(() => {
    forceMutation(() => { el.className = 'inner'; }, el);
    el.className = 'outer, after the inner one';
  }, el);
  expect(violations).toEqual([]);
  let refused: unknown;
  let allowed = false;
  requestMutation(() => {
    try { forceMutation(() => {}, el); } catch (error) { refused = error; }
    forceMutation(() => { allowed = true; }, el, true);
  });
  flushSync();
  expect(String(refused)).toContain("the current phase is 'mutate' already");
  expect(allowed).toBe(true);
});

it('forceMeasure opens a layout-read window inside the mutate phase; a write inside it is a violation; elsewhere it is a plain call', () => {
  const el = attached();
  let read = -1;
  requestMutation(() => {
    read = forceMeasure(() => el.offsetHeight);
    el.className = 'legit'; // after the window: mutate again
    forceMeasure(() => { el.className = 'inside'; });
  });
  flushSync();
  expect(read).toBe(0);
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  // outside the mutate phase (event handlers, measure tasks — kit helpers run in both): no error, no window
  violations.length = 0;
  expect(forceMeasure(() => el.offsetWidth)).toBe(0);
  let inMeasureTask = -1;
  requestMeasure(() => { inMeasureTask = forceMeasure(() => el.clientWidth); });
  flushSync();
  expect(inMeasureTask).toBe(0);
  expect(violations).toEqual([]);
});

it('suppressStrict silences both checks for its callback (re-entrant); violations before it are still reported', async () => {
  const el = attached();
  el.className = 'before';
  requestMutation(() => {
    suppressStrict(() => {
      void el.offsetHeight;
      suppressStrict(() => { void el.getBoundingClientRect(); });
      void el.offsetWidth;
    });
    void el.clientWidth; // outside again
  });
  const result = suppressStrict(() => {
    el.className = 'suppressed';
    return 42;
  });
  flushSync();
  await flushMicrotasks();
  expect(result).toBe(42);
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-', 'measure:clientWidth:mutate:-']);
  // strict switched off and on inside a window: the window still closes cleanly, later windows still suppress
  suppressStrict(() => disableStrict());
  enableStrict();
  suppressStrict(() => { el.className = 'quiet'; });
  await flushMicrotasks();
  expect(violations).toHaveLength(2);
});

it('setHandler() without a handler restores console.error; a throwing handler reaches the caller of a layout read', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  setHandler();
  const el = attached();
  requestMutation(() => { void el.offsetHeight; });
  flushSync();
  expect(err).toHaveBeenCalledTimes(1);
  expect(err.mock.calls[0][0]).toBeInstanceOf(StrictViolationError);
  setHandler((error) => { throw error; });
  let thrown: unknown;
  requestMutation(() => {
    try { void el.offsetHeight; } catch (error) { thrown = error; }
  });
  flushSync();
  expect(thrown).toBeInstanceOf(StrictViolationError);
});

it('render() into an attached container and Portal go through the seam: no violation; the seam is restored by disableStrict', async () => {
  const el = attached();
  const [n, setN] = createSignal(0);
  const dispose = render(() => {
    const span = document.createElement('span');
    createMutationEffect(() => n(), (v) => { span.textContent = String(v); });
    return [span, createComponent(Portal, { get children() { return document.createElement('i'); } })];
  }, el);
  disposers.push(dispose);
  await flushMicrotasks();
  expect(el.innerHTML).toBe('<span>0</span>');
  expect(document.body.querySelector('i')).not.toBeNull();
  setN(1);
  flushSync();
  await flushMicrotasks();
  expect(violations).toEqual([]);
  dispose();
  flushSync();
  await flushMicrotasks();
  expect(el.innerHTML).toBe('');
  expect(violations).toEqual([]);
  disableStrict();
  expect(strictHooks.forceMutation(() => 'plain', el)).toBe('plain');
});

it('a tickEnd effect writing the live DOM is reported synchronously after its apply, attributed to it', () => {
  const el = attached();
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createComponent(
      () => {
        createEffect(() => n(), (v) => { el.title = `t${v}`; }, undefined, { name: 'logic' });
        return null;
      },
      {},
      'Sidebar',
    );
  });
  flushSync(); // the first (scheduled) apply of a tickEnd effect
  expect(violations.map(summary)).toEqual(['mutation:title:measure:Sidebar > logic']);
  expect(violations[0].message).toBe('[frameact/stricterdom] Unexpected mutation `title` of <div> in Sidebar > logic [measure]');
  violations.length = 0;
  setN(1);
  flushSync();
  expect(violations.map(summary)).toEqual(['mutation:title:measure:Sidebar > logic']);
});

it('a write pending when an apply starts is not attributed to that effect (a handler writes a signal, then the DOM)', () => {
  const el = attached();
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createComponent(
      () => {
        createEffect(() => n(), () => {}, undefined, { name: 'logic' });
        return null;
      },
      {},
      'Sidebar',
    );
  });
  flushSync();
  setN(1);
  el.className = 'pressed';
  // the tickEnd drain runs before the observer callback (Chrome's microtask order; flushSync reproduces it here)
  flushSync();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  // ...and a raw measure task's write is not attributed to the measure effect that applies after it
  violations.length = 0;
  requestMeasure(() => { el.title = 'raw'; });
  testRoot(() => {
    createComponent(
      () => {
        createEffect(() => n(), () => {}, (run) => requestMeasure(run), { name: 'measured' });
        return null;
      },
      {},
      'Panel',
    );
  });
  flushFrame();
  expect(violations.map(summary)).toEqual(['mutation:title:measure:-']);
});

it('document clobbering (content-named `contains` / `body` on document) does not break the checks', async () => {
  const el = attached();
  shadow('contains');
  shadow('body');
  try {
    el.className = 'x';
    await flushMicrotasks();
    expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
    disableStrict();
    enableStrict(); // finds the real <body> through the natives
    el.className = 'y';
    await flushMicrotasks();
    expect(violations.map(summary)).toEqual(['mutation:class:measure:-', 'mutation:class:measure:-']);
  } finally {
    delete (document as { contains?: unknown }).contains;
    delete (document as { body?: unknown }).body;
  }
});
```

- [ ] **Step 6: Run the tests, then the full check**

Run: `pnpm vitest run test/stricterdom/stricterdom.test.ts`
Expected: `Tests  14 passed (14)`. Two failures that mean a transcription slip: a `childList` violation `of <body>` in almost every test → a `container()` was not wrapped in `suppressStrict`; `expected "error" to be called 1 times, but got 0` → the default handler captured `console.error` at module load instead of calling it at report time.

Run: `pnpm check`
Expected: lint silent; tsc 0 errors (a `TS4115 … must have an 'override' modifier` means a field was named `cause`); `Tests  976 passed (976)`.

- [ ] **Step 7: Commit**

```bash
git add src/stricterdom/layoutCauses.ts src/stricterdom/stricterdom.ts src/stricterdom/index.ts test/stricterdom/stricterdom.test.ts package.json tsconfig.json vitest.config.ts THIRD_PARTY_LICENSES.md
git commit -m "feat(stricterdom): port stricterdom + layoutCauses — phase checks from the scheduler's phase, records drained at phase changes and after applies, attribution path in the error

Co-Authored-By: <your model name> <noreply@anthropic.com>"
```

---

### Task 3: Attribution through the compiler's `sourceNames`; the runtime's own phase discipline under strict

**Files:**
- Create: `test/stricterdom/attribution.test.tsx`

**Interfaces:**
- Consumes: `frameact/stricterdom` (Task 2), `frameact/dom` (`render`, `For`, `Show`, `Switch`/`Match`, `Dynamic`, `Portal`, `delegateEvents`), `frameact` (`createMeasureEffect`, `createMutationEffect`, `beginHeavyAnimation`, `onCleanup`), `useDomHarness`/`container`, `flushMicrotasks`. The file is compiled by `frameact/vite` (vitest config) with `sourceNames` on.
- Produces: no code; this suite is the **gate** that the runtime (insert, reconcile, class/style/attr writers, `use:value`, flow components incl. a Portal inside a Portal, deferred apply-cleanups, parking release) writes the live DOM only in the mutate phase. A violation here is a runtime bug, not a test to loosen.

- [ ] **Step 1: Write the suite `test/stricterdom/attribution.test.tsx`**

```tsx
import { beginHeavyAnimation, createMeasureEffect, createMutationEffect, createSignal, flushSync, onCleanup } from 'frameact';
import { delegateEvents, Dynamic, For, Portal, render, Show, Switch, Match } from 'frameact/dom';
import { disableStrict, enableStrict, setHandler, suppressStrict, type StrictViolationError } from 'frameact/stricterdom';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

let violations: StrictViolationError[];
const disposers: (() => void)[] = [];
beforeEach(() => {
  violations = [];
  // The compiled module registers its delegated events once, at load; the harness clears delegation after every test.
  delegateEvents(['click', 'input']);
  enableStrict();
  setHandler((error) => { violations.push(error); });
});
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  flushSync();
  await flushMicrotasks();
  setHandler();
  disableStrict();
});

const summary = (v: StrictViolationError) => `${v.kind}:${v.detail}:${v.phase}:${v.path ?? '-'}`;

/** `render()` into an attached container (the container's own append is a test-time write). */
function mount(code: () => unknown) {
  const el = suppressStrict(container);
  disposers.push(render(code, el));
  return el;
}

function type(input: HTMLInputElement, value: string, caret = value.length) {
  input.value = value;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

// ---- attribution through the compiler's sourceNames -------------------------------------------

function MessageMeta(props: { t: () => string }) {
  return <span class="meta" style={{ color: props.t() }}>{props.t()}</span>;
}

function Message(props: { color: () => string }) {
  return (
    <div class="message">
      <span>text</span>
      <MessageMeta t={props.color} />
    </div>
  );
}

it('a layout read inside a compiled binding is attributed `Component > Child > element.binding [mutate]`', () => {
  const [tint, setTint] = createSignal('red');
  let meta!: HTMLElement;
  const el = mount(() => <Message color={() => (tint() === 'red' ? 'red' : `rgb(${meta.offsetWidth},0,0)`)} />);
  meta = el.querySelector('.meta')!;
  expect(violations).toEqual([]);
  setTint('measured');
  flushSync();
  // the style effect and the insert effect of MessageMeta both read the prop (compiler order: children first)
  expect(violations.map(summary)).toEqual([
    'measure:offsetWidth:mutate:Message > MessageMeta > span.children',
    'measure:offsetWidth:mutate:Message > MessageMeta > span.style:color',
  ]);
  expect(violations[1].message).toBe(
    '[frameact/stricterdom] Unexpected measurement `offsetWidth` in Message > MessageMeta > span.style:color [mutate]',
  );
});

it('an event handler that writes the DOM directly is reported as a mutation outside an effect; writing a signal instead is fine', async () => {
  const [on, setOn] = createSignal(false);
  const el = mount(() => (
    <div>
      <button id="direct" onClick={(e) => { e.currentTarget.classList.add('clicked'); }} />
      <button id="signal" class={{ on: on() }} onClick={() => setOn(true)} />
    </div>
  ));
  (el.querySelector('#direct') as HTMLButtonElement).click();
  await flushMicrotasks();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  expect(violations[0].message).toBe('[frameact/stricterdom] Unexpected mutation `class` of <button id="direct" class="clicked"> outside an effect [measure]');
  violations.length = 0;
  (el.querySelector('#signal') as HTMLButtonElement).click();
  await frame();
  expect(el.querySelector('#signal')!.className).toBe('on');
  expect(violations).toEqual([]);
});

// ---- the runtime's own phase discipline (spec §5: "render into an attached container gives no error") ----

interface Item { id: number; label: string }

function App(props: { items: () => Item[]; mode: () => 'list' | 'grid' | 'none'; text: () => string; setText: (s: string) => void }) {
  const [portalOpen, setPortalOpen] = createSignal(true);
  const text = props.text; // a plain identifier: `use:value={text}` compiles to the static (accessor) form
  let box!: HTMLDivElement;
  const [h, setH] = createSignal(0);
  onCleanup(() => setPortalOpen(false));
  const view = (
    <div ref={(el) => { box = el; }} class="app" classList={{ grid: props.mode() === 'grid' }} data-count={props.items().length}>
      <input use:value={text} onInput={(e) => props.setText(e.currentTarget.value.trimStart().toUpperCase())} />
      <Switch fallback={<p>none</p>}>
        <Match when={props.mode() === 'list'}>
          <ul>
            <For each={props.items()}>{(item) => <li class={{ odd: item.id % 2 === 1 }}>{item.label}</li>}</For>
          </ul>
        </Match>
        <Match when={props.mode() === 'grid'}>
          <For each={props.items()} order="manual" orderKey={(item) => item.id}>
            {(item, i) => <div style={{ transform: `translateY(${i() * 10}px)` }}>{item.label}</div>}
          </For>
        </Match>
      </Switch>
      <Show when={props.items().length > 2}>
        <Dynamic component={props.mode() === 'grid' ? 'section' : 'aside'}>many</Dynamic>
      </Show>
      <Show when={portalOpen()}>
        <Portal>
          <div class="toast">
            {props.text()}
            <Portal><i class="tip" /></Portal>
          </div>
        </Portal>
      </Show>
    </div>
  );
  // after the JSX: `box` is assigned by the ref, and a mutation effect's first apply is synchronous
  createMeasureEffect(() => props.items().length, () => { setH(box.offsetHeight); }); // layout in measure: allowed
  createMutationEffect(() => h(), (v) => { box.style.minHeight = `${v}px`; });
  return view;
}

it('a full app — render, For (keyed and manual), Show/Switch/Dynamic/Portal (nested), use:value, class/style/attr bindings, measure + mutate effects, heavy-animation parking, dispose — produces no violation', async () => {
  const [items, setItems] = createSignal<Item[]>([{ id: 1, label: 'a' }, { id: 2, label: 'b' }]);
  const [mode, setMode] = createSignal<'list' | 'grid' | 'none'>('list');
  const [text, setText] = createSignal('');
  const el = mount(() => <App items={items} mode={mode} text={text} setText={setText} />);
  await frame(); // first measure apply
  expect(el.querySelectorAll('li').length).toBe(2);
  expect(document.querySelector('.toast')).not.toBeNull();
  expect(document.querySelector('.tip')).not.toBeNull(); // a Portal inside a Portal: both sanction <body>

  setItems([{ id: 3, label: 'c' }, ...items()]);
  await frame();
  setMode('grid');
  await frame();
  setItems([items()[1], items()[0], items()[2], { id: 4, label: 'd' }]); // manual order: moves + append
  await frame();
  expect(el.querySelector('section')).not.toBeNull();

  const input = el.querySelector('input')!;
  type(input, ' hi'); // rejected (trimStart) → synchronous rollback before paint; then formatted (upper case)
  await frame();
  expect(input.value).toBe('HI');
  type(input, 'HI!');
  await frame();
  expect(document.querySelector('.toast')!.textContent).toBe('HI!');

  const end = beginHeavyAnimation(300, true);
  setMode('none');
  setItems([]);
  await frame(); // parked
  expect(el.querySelector('p')).toBeNull();
  end();
  await frame(); // released: measure then mutate in one frame
  expect(el.querySelector('p')!.textContent).toBe('none');

  for (const d of disposers.splice(0)) d();
  await frame();
  expect(el.innerHTML).toBe('');
  expect(document.querySelector('.toast')).toBeNull();
  expect(document.querySelector('.tip')).toBeNull();
  await flushMicrotasks();
  expect(violations.map(summary)).toEqual([]);
});

it('selectionStart may be read at event time, never in a mutation apply (the directive snapshots it for the applier)', async () => {
  const [text, setText] = createSignal('');
  let caretInMutate = -1;
  const el = mount(() => {
    const input = (<input use:value={text} onInput={(e) => setText(e.currentTarget.value)} />) as HTMLInputElement;
    createMutationEffect(() => text(), () => { caretInMutate = input.selectionStart ?? -1; }); // first apply: creation, measure phase
    return input;
  });
  const input = el.querySelector('input')!;
  type(input, 'ab', 1);
  await frame();
  expect(caretInMutate).toBe(1);
  expect(violations.map(summary)).toEqual(['measure:selectionStart:mutate:mutation']);
});
```

- [ ] **Step 2: Run it, then the full check**

Run: `pnpm vitest run test/stricterdom/attribution.test.tsx`
Expected: `Tests  4 passed (4)`. Known slips: `expected [] to deeply equal ['mutation:class:measure:-']` in the second test or `expected ' hi' to be 'HI'` in the third → the `delegateEvents(['click', 'input'])` in `beforeEach` is missing (handlers never ran); `Cannot read properties of undefined (reading 'style')` → the two effects of `App` were created before the JSX (the `ref` has not run yet at the synchronous first apply).

Run: `pnpm check`
Expected: lint silent (a `let box!: HTMLDivElement` with `ref={box}` instead of the callback is a **lint error** `eslint(no-unassigned-vars)`, and `pnpm check` stops there); `Tests  980 passed (980)`.

- [ ] **Step 3: Commit**

```bash
git add test/stricterdom/attribution.test.tsx
git commit -m "test(stricterdom): attribution through compiled sourceNames; the runtime's phase discipline under strict (full app, 0 violations)

Co-Authored-By: <your model name> <noreply@anthropic.com>"
```

---

### Task 4: The DEV profiler — run counters, "why did this run", slow-run and slow-drain warnings

**Files:**
- Create: `src/stricterdom/runlog.ts`, `test/stricterdom/runlog.test.ts`
- Modify: `src/stricterdom/stricterdom.ts` (import + two calls), `src/stricterdom/index.ts` (exports)

**Interfaces:**
- Consumes: `getEffectDebugInfo`, `setRunObserver`, `EffectNode` (Task 1, `src/core/effects.ts`); `setDrainObserver`, `getDrainingPhase`, `FramePhase` (`src/core/frame.ts`); `describeNode`, `effectPath` (`src/core/debug.ts`); `getPhase`.
- Produces (public, `frameact/stricterdom`): `SLOW_RUN_MS = 7`; `interface RunStats { path: string; runs: number; totalMs: number; maxMs: number }`; `interface RunLogOptions { filter?: string | RegExp }`; `enableRunLog(options?: RunLogOptions): void`; `disableRunLog(): void`; `getRunStats(): RunStats[]` (most runs first; copies); `resetRunStats(): void`. Internal: `setStrictProfiling(on: boolean)` (called by `enableStrict`/`disableStrict`). Console output formats: `` [frameact] run #<n> <path> [<phase>] ← signal "count" via memo "doubled" in Counter `` (`console.log`), `` [frameact] Slow effect run: 10.0 ms in <path> [<phase>] `` and `` [frameact] Slow <phase> drain: 10.0 ms, 1 effect run; slowest: <path> (10.0 ms) `` (`console.warn`).

- [ ] **Step 1: Create `src/stricterdom/runlog.ts`**

```ts
// DEV run counters, the "why did this run" log and the slow-run warnings (spec §3.4). Replaces
// teact's `debugKey` / double-click dumps: every effect run is attributed to its path and to the
// signal (or store leaf) whose write scheduled it.
import { DEV } from '../env';
import { getEffectDebugInfo, setRunObserver, type EffectNode } from '../core/effects';
import { getDrainingPhase, setDrainObserver, type FramePhase } from '../core/frame';
import { describeNode, effectPath } from '../core/debug';
import { getPhase } from '../scheduler/fasterdom';

/** An effect run, or one frame-phase drain, slower than this is reported (`console.warn`). */
export const SLOW_RUN_MS = 7;

export interface RunStats {
  /** `Message > MessageMeta > span.style:color` */
  path: string;
  /** Observed scheduled runs (the creation run is not observed). */
  runs: number;
  totalMs: number;
  maxMs: number;
}

export interface RunLogOptions {
  /** Log only the effects whose path matches (a substring, or a RegExp). */
  filter?: string | RegExp;
}

let logging = false;
let filter: RegExp | null = null;
let attached = false;
/** Who wants the observers: stricterdom (slow-run warnings + counters) and/or the run log. */
let wantedByStrict = false;
const stats = new Map<string, RunStats>();
/** The slowest run of the drain in progress (runs outside a frame drain — tickEnd, idle — are not part of one). */
let drainSlowest: { path: string; ms: number } | null = null;
/** An effect's owner chain never changes: its path is built once, not on every run. */
const paths = new WeakMap<EffectNode, string>();

function pathOf(node: EffectNode): string {
  let path = paths.get(node);
  if (path === undefined) paths.set(node, (path = effectPath(node)));
  return path;
}

function onRun(node: EffectNode, ms: number) {
  const path = pathOf(node);
  let entry = stats.get(path);
  if (entry === undefined) {
    entry = { path, runs: 0, totalMs: 0, maxMs: 0 };
    stats.set(path, entry);
  }
  entry.runs++;
  entry.totalMs += ms;
  if (ms > entry.maxMs) entry.maxMs = ms;
  if (getDrainingPhase() !== null && (drainSlowest === null || ms > drainSlowest.ms)) drainSlowest = { path, ms };
  if (ms > SLOW_RUN_MS) console.warn(`[frameact] Slow effect run: ${ms.toFixed(1)} ms in ${path} [${getPhase()}]`);
  if (logging && (filter === null || path.search(filter) !== -1)) { // (search: a /g filter has no lastIndex state)
    const info = getEffectDebugInfo(node)!;
    const why =
      info.root === null
        ? 'rescheduled (no write recorded)'
        : info.dep === info.root
          ? describeNode(info.root)
          : `${describeNode(info.root)} via ${describeNode(info.dep)}`;
    console.log(`[frameact] run #${info.runs} ${path} [${getPhase()}] ← ${why}`);
  }
}

function onDrain(phase: FramePhase, ms: number, runs: number) {
  if (ms > SLOW_RUN_MS) {
    const slowest = drainSlowest === null ? '' : `; slowest: ${drainSlowest.path} (${drainSlowest.ms.toFixed(1)} ms)`;
    console.warn(`[frameact] Slow ${phase} drain: ${ms.toFixed(1)} ms, ${runs} effect run${runs === 1 ? '' : 's'}${slowest}`);
  }
  drainSlowest = null;
}

function syncObservers() {
  const wanted = wantedByStrict || logging;
  if (wanted === attached) return;
  attached = wanted;
  setRunObserver(wanted ? onRun : null);
  setDrainObserver(wanted ? onDrain : null);
  if (!wanted) drainSlowest = null;
}

/** @internal stricterdom.ts: enableStrict()/disableStrict() turn the counters and slow-run warnings on/off. */
export function setStrictProfiling(on: boolean) {
  if (!DEV) return;
  wantedByStrict = on;
  syncObservers();
}

/** Log every effect run with its path, phase and the write that scheduled it (DEV; a no-op in production). */
export function enableRunLog(options: RunLogOptions = {}): void {
  if (!DEV) return;
  const f = options.filter;
  filter = f === undefined ? null : typeof f === 'string' ? new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : f;
  logging = true;
  syncObservers();
}

export function disableRunLog(): void {
  if (!DEV) return;
  logging = false;
  filter = null;
  syncObservers();
}

/** Per-path counters since the last reset, most runs first. Empty in production and while nothing observes runs. */
export function getRunStats(): RunStats[] {
  const out: RunStats[] = [];
  for (const entry of stats.values()) {
    // insertion sort by runs, descending (lib ES2022 has no toSorted; .sort() is linted)
    let i = out.length;
    while (i > 0 && out[i - 1].runs < entry.runs) i--;
    out.splice(i, 0, { ...entry });
  }
  return out;
}

export function resetRunStats(): void {
  stats.clear();
}
```

- [ ] **Step 2: Wire it into `stricterdom.ts` and `index.ts`**

`src/stricterdom/stricterdom.ts` — after `import { LAYOUT_CAUSES } from './layoutCauses';` add
```ts
import { setStrictProfiling } from './runlog';
```
In `enableStrict`, replace
```ts
  strictHooks.forceMutation = (cb, target) => allowMutation(target, cb);
}
```
with
```ts
  strictHooks.forceMutation = (cb, target) => allowMutation(target, cb);
  setStrictProfiling(true); // run counters and the slow-run / slow-drain warnings (runlog.ts)
}
```
In `disableStrict`, replace
```ts
  if (!DEV || !isStrict) return;
  drainRecords();
  strictHooks.forceMutation = (cb) => cb();
```
with
```ts
  if (!DEV || !isStrict) return;
  drainRecords();
  setStrictProfiling(false);
  strictHooks.forceMutation = (cb) => cb();
```
`src/stricterdom/index.ts` — append
```ts
export {
  enableRunLog, disableRunLog, getRunStats, resetRunStats, SLOW_RUN_MS, type RunStats, type RunLogOptions,
} from './runlog';
```

- [ ] **Step 3: Write the failing test `test/stricterdom/runlog.test.ts`**

```ts
import { createEffect, createMemo, createMutationEffect, createRoot, createSignal, flushSync } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { disableStrict, enableStrict, setHandler } from '../../src/stricterdom/stricterdom';
import { disableRunLog, enableRunLog, getRunStats, resetRunStats, SLOW_RUN_MS } from '../../src/stricterdom/runlog';
import { useDomHarness } from '../helpers/dom';

useDomHarness();

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  flushSync();
  disableRunLog();
  disableStrict();
  setHandler();
  resetRunStats();
});

/** A clock the test advances by hand: `performance.now()` is read twice per run and twice per drain. */
function fakeClock() {
  const clock = { now: 0 };
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  return clock;
}

/** A Counter component with a memo between the signal and the binding effect. */
function counter(count: () => number, apply: (v: number) => void) {
  createRoot((dispose) => {
    disposers.push(dispose);
    createComponent(
      () => {
        const doubled = createMemo(() => count() * 2, { id: 'doubled' });
        createMutationEffect(() => doubled(), apply, { name: 'div.children' });
        return null;
      },
      {},
      'Counter',
    );
  });
}

it('enableStrict counts scheduled runs per path with totals; resetRunStats clears; disableStrict stops counting', () => {
  const clock = fakeClock();
  const [count, setCount] = createSignal(0, { id: 'count' });
  enableStrict();
  counter(count, () => { clock.now += 2; });
  expect(getRunStats()).toEqual([]); // the creation run is not observed
  setCount(1);
  flushSync();
  setCount(2);
  flushSync();
  expect(getRunStats()).toEqual([{ path: 'Counter > div.children', runs: 2, totalMs: 4, maxMs: 2 }]);
  resetRunStats();
  expect(getRunStats()).toEqual([]);
  disableStrict();
  setCount(3);
  flushSync();
  expect(getRunStats()).toEqual([]);
});

it('getRunStats orders by runs, most first', () => {
  enableRunLog({ filter: 'nothing-matches' });
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  createRoot((dispose) => {
    disposers.push(dispose);
    createMutationEffect(() => a(), () => {}, { name: 'rare' });
    createMutationEffect(() => b(), () => {}, { name: 'busy' });
  });
  setA(1);
  flushSync();
  for (let i = 1; i <= 3; i++) {
    setB(i);
    flushSync();
  }
  expect(getRunStats().map((s) => `${s.path}:${s.runs}`)).toEqual(['busy:3', 'rare:1']);
});

it('enableRunLog logs each run with its number, path, phase and the write that scheduled it; filter narrows it', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const [count, setCount] = createSignal(0, { id: 'count' });
  counter(count, () => {});
  enableRunLog();
  setCount(1);
  flushSync();
  expect(log).toHaveBeenCalledWith('[frameact] run #2 Counter > div.children [mutate] ← signal "count" via memo "doubled" in Counter');
  log.mockClear();
  enableRunLog({ filter: 'Other' });
  setCount(2);
  flushSync();
  expect(log).not.toHaveBeenCalled();
  enableRunLog({ filter: /Counter > div\.\w+/ });
  setCount(3);
  flushSync();
  expect(log).toHaveBeenCalledTimes(1);
  disableRunLog();
  setCount(4);
  flushSync();
  expect(log).toHaveBeenCalledTimes(1);
});

it('a run slower than SLOW_RUN_MS warns with the path and the phase; so does a drain, naming its slowest effect', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const clock = fakeClock();
  const [count, setCount] = createSignal(0);
  enableStrict();
  counter(count, (v) => { clock.now += v === 4 ? 1 : SLOW_RUN_MS + 3; }); // v is the doubled count
  expect(SLOW_RUN_MS).toBe(7);
  setCount(1);
  flushSync();
  expect(warn.mock.calls.map((c) => c[0])).toEqual([
    '[frameact] Slow effect run: 10.0 ms in Counter > div.children [mutate]',
    '[frameact] Slow mutate drain: 10.0 ms, 1 effect run; slowest: Counter > div.children (10.0 ms)',
  ]);
  warn.mockClear();
  setCount(2); // doubled → 4: 1 ms, quiet
  flushSync();
  expect(warn).not.toHaveBeenCalled();
});

it('the slowest effect a drain warning names ran in that drain (a slow tickEnd run just before it is not)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const clock = fakeClock();
  const [count, setCount] = createSignal(0);
  enableStrict();
  createRoot((dispose) => {
    disposers.push(dispose);
    createEffect(() => count(), (v) => { if (v) clock.now += 12; }, undefined, { name: 'logic' });
    createMutationEffect(() => count(), (v) => { if (v) clock.now += 8; }, { name: 'div.title' });
  });
  flushSync(); // the first (scheduled) tickEnd apply
  warn.mockClear();
  setCount(1);
  flushSync(); // the tickEnd run (12 ms, outside any drain), then the mutate drain (8 ms)
  expect(warn.mock.calls.map((c) => c[0])).toEqual([
    '[frameact] Slow effect run: 12.0 ms in logic [measure]',
    '[frameact] Slow effect run: 8.0 ms in div.title [mutate]',
    '[frameact] Slow mutate drain: 8.0 ms, 1 effect run; slowest: div.title (8.0 ms)',
  ]);
});
```

- [ ] **Step 4: Run it, then the full check**

Run: `pnpm vitest run test/stricterdom/runlog.test.ts`
Expected: `Tests  5 passed (5)`.

Run: `pnpm check`
Expected: lint silent; `Tests  985 passed (985)`.

- [ ] **Step 5: Commit**

```bash
git add src/stricterdom/runlog.ts src/stricterdom/stricterdom.ts src/stricterdom/index.ts test/stricterdom/runlog.test.ts
git commit -m "feat(stricterdom): run counters, why-did-this-run log, slow-run/slow-drain warnings (DEV profiler)

Co-Authored-By: <your model name> <noreply@anthropic.com>"
```

---

### Task 5: `flushSync` production contract — allowed outside a frame pass, an error inside one

**Files:**
- Modify: `src/scheduler/fasterdom.ts` (`passDepth`, the four segment runners, `flushSync`), `src/core/flush.ts` (doc, the in-pass check before the tickEnd flush), `test/scheduler/fasterdom.test.ts` (+2), `test/effects/frame.test.ts` (+2 and an import), `docs/superpowers/specs/2026-10-11-frameact-design.md` (§3.1), `README.md`, `README.ru.md`, `README.zh-CN.md` (one bullet each)

**Interfaces:**
- Consumes: nothing new.
- Produces: `flushSync()` (`src/scheduler/fasterdom.ts`, re-exported as `flushFrameSync` from `frameact/scheduler` and wrapped by the public `flushSync` of `frameact`) throws `Error('[frameact] flushSync() is not reentrant: it was called inside a frame pass (a frame effect, a requestMeasure/requestMutation/requestForcedReflow task or a forceMeasure callback). Write the signal and let the frame apply it, or call flushSync() from the event handler or action that started this.')` while a phase segment runs; the public `flushSync` (`src/core/flush.ts`) checks `isInFramePass()` **before** it flushes tickEnd work, so inside a pass it throws without running any pending tickEnd effect mid-pass; `isInFramePass(): boolean` (`@internal`; used by `core/flush.ts`, available to the kit's guards). The existing test `flushSync is not reentrant` keeps matching `/reentrant/`.

- [ ] **Step 1: `src/scheduler/fasterdom.ts` (three edits)**

Edit 1 — replace
```ts
let pendingForceReflowTasks: ReflowTask[] = [];
let inSyncPass = false;
```
with
```ts
let pendingForceReflowTasks: ReflowTask[] = [];
/**
 * > 0 while a phase segment of a frame pass runs — a rAF segment (measure tasks, then each
 * microtask: mutations, forced-reflow measures, forced-reflow mutations) or flushSync() itself.
 * A microtask between two rAF segments (a tickEnd drain) is NOT inside a segment.
 */
let passDepth = 0;
```

Edit 2 — replace the four segment runners (from `function runMeasureTasks() {` through the closing brace of `runForcedReflowMutations`) with
```ts
function runMeasureTasks() {
  passDepth++;
  try {
    setPhase('measure');
    const current = pendingMeasureTasks;
    pendingMeasureTasks = [];
    current.forEach(safeExec);
  } finally {
    passDepth--;
  }
}

function runMutationTasks() {
  passDepth++;
  try {
    setPhase('mutate');
    const current = pendingMutationTasks;
    pendingMutationTasks = [];
    current.forEach(safeExec);
  } finally {
    passDepth--;
  }
}

function runForcedReflowTasks(): NoneToVoidFunction[] {
  passDepth++;
  try {
    setPhase('measure');
    const mutations: NoneToVoidFunction[] = [];
    // for..of over the live array: tasks requested during this loop are included (as in teact)
    for (const task of pendingForceReflowTasks) {
      safeExec(() => {
        const mutation = task();
        if (mutation) mutations.push(mutation);
      });
    }
    pendingForceReflowTasks = [];
    return mutations;
  } finally {
    passDepth--;
  }
}

function runForcedReflowMutations(mutations: NoneToVoidFunction[]) {
  passDepth++;
  try {
    setPhase('mutate');
    mutations.forEach(safeExec);
    setPhase('measure');
  } finally {
    passDepth--;
  }
}

/** @internal True inside a phase segment of a frame pass (see passDepth). */
export function isInFramePass() {
  return passDepth > 0;
}
```

Edit 3 — replace the `flushSync` doc comment and function (from `/**\n * Run a whole frame pass synchronously (tests, imperative integration code).` to its closing brace) with
```ts
/**
 * Run a whole frame pass synchronously, with the real phase sequence (measure → mutate →
 * forced-reflow measure → forced-reflow mutate). Production contract (spec §3.1): allowed from
 * anywhere OUTSIDE a frame pass — an event handler, a store action, a tickEnd effect — for the
 * cases that need the DOM committed before the current task ends (an iOS swipe-back gesture, the
 * callback of a View Transition). Inside a pass (a frame effect's compute or apply, a
 * requestMeasure/requestMutation/requestForcedReflow task, a forceMeasure callback) it throws: the
 * phases would interleave. Does not bypass heavy-animation gating of the core's run queues. The
 * already-throttled rAF (if any) later fires with empty queues — harmless.
 */
export function flushSync() {
  if (passDepth > 0) {
    throw new Error(
      '[frameact] flushSync() is not reentrant: it was called inside a frame pass (a frame effect, a requestMeasure/requestMutation/requestForcedReflow task or a forceMeasure callback). Write the signal and let the frame apply it, or call flushSync() from the event handler or action that started this.',
    );
  }
  try {
    runMeasureTasks();
    runMutationTasks();
    runForcedReflowMutations(runForcedReflowTasks());
  } finally {
    setPhase('measure');
  }
}
```

- [ ] **Step 2: `src/core/flush.ts` — the doc and the in-pass check (two edits)**

Replace
```ts
import { flushSync as flushFrame, hasPendingFrameTasks } from '../scheduler/fasterdom';
```
with
```ts
import { flushSync as flushFrame, hasPendingFrameTasks, isInFramePass } from '../scheduler/fasterdom';
```
and replace
```ts
/**
 * Run pending tickEnd effects and full synchronous frame passes until neither has work left (a
 * tickEnd apply can dirty frame work and vice versa). Tests and imperative glue only.
 */
export function flushSync() {
```
with
```ts
/**
 * Run pending tickEnd effects and full synchronous frame passes until neither has work left (a
 * tickEnd apply can dirty frame work and vice versa). Allowed in production from outside a frame
 * pass (an event handler, a store action, a tickEnd effect) when the DOM must be committed before
 * the current task ends — an iOS swipe-back gesture, a View Transition callback; inside a frame pass
 * it throws (scheduler/fasterdom.ts). Tests use it as their frame.
 */
export function flushSync() {
  if (isInFramePass()) flushFrame(); // throws the "not reentrant" error before any tickEnd effect runs inside the pass
```

- [ ] **Step 3: Tests**

Append to `test/scheduler/fasterdom.test.ts`:
```ts

it('flushSync inside a rAF pass segment throws instead of interleaving the phases; the pass completes', async () => {
  const log: string[] = [];
  let thrown: unknown;
  requestMeasure(() => {
    try { flushSync(); } catch (error) { thrown = error; }
    log.push('measure:' + getPhase());
  });
  requestMutation(() => log.push('mutate:' + getPhase()));
  await frame();
  expect(String(thrown)).toMatch(/not reentrant: it was called inside a frame pass/);
  expect(log).toEqual(['measure:measure', 'mutate:mutate']);
  expect(getPhase()).toBe('measure');
});

it('flushSync from a microtask between two rAF segments (a tickEnd drain) is outside the pass: it runs, draining the pending rAF work too', async () => {
  const log: string[] = [];
  requestMeasure(() => {
    // queued during the measure segment: runs before the mutate segment's microtask
    void Promise.resolve().then(() => {
      requestMutation(() => log.push('sync-mutate:' + getPhase()));
      flushSync();
      log.push('after-sync:' + getPhase());
    });
  });
  requestMutation(() => log.push('raf-mutate:' + getPhase()));
  await frame();
  // the rAF's own mutation was still pending: the sync pass took it along (FIFO); the rAF's mutate segment then found an empty queue
  expect(log).toEqual(['raf-mutate:mutate', 'sync-mutate:mutate', 'after-sync:measure']);
});
```

`test/effects/frame.test.ts` — after the import line `import { createHeavyAnimationScope } from '../../src/scheduler/heavyAnimation';` add
```ts
import { flushSync as flushAll } from '../../src/core/flush';
```
and append
```ts

it('flushSync from a frame effect apply is that effect\'s error (reported, the drain continues); from a tickEnd effect it commits the frame synchronously', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $a = signal(0);
  const applied: string[] = [];
  root(() => {
    createMutationEffect(() => $a(), (v) => { if (v) flushSync(); });
    createMutationEffect(() => $a(), (v) => { applied.push(`mutate:${v}`); });
  });
  $a.set(1);
  flushSync();
  expect(applied).toEqual(['mutate:0', 'mutate:1']);
  expect(String(err.mock.calls[0][1])).toMatch(/flushSync\(\) is not reentrant/);
  err.mockRestore();
  // an iOS-gesture style commit: a tickEnd effect (outside any pass) flushes the frame work it caused
  const $b = signal(0);
  const order: string[] = [];
  root(() => {
    createMutationEffect(() => $b(), (v) => { order.push(`mutate:${v}:${getPhase()}`); });
    createEffect(() => $b(), (v) => { if (v) { order.push('tick'); flushAll(); order.push('committed'); } });
  });
  $b.set(1);
  flushAll(); // the public flushSync: tickEnd effects first, then the frame
  expect(order).toEqual(['mutate:0:measure', 'tick', 'mutate:1:mutate', 'committed']);
});

it('the public flushSync inside a frame pass throws before it runs any pending tickEnd effect', () => {
  const $c = signal(0);
  const ran: number[] = [];
  root(() => createEffect(() => $c(), (v) => { ran.push(v); }));
  flushAll(); // the first (scheduled) tickEnd apply
  let thrown: unknown;
  root(() => createMutationEffect(() => $c(), (v) => {
    if (v) { try { flushAll(); } catch (error) { thrown = error; } }
  }));
  $c.set(1);
  flushSync(); // the frame only: the mutation apply calls the public flushSync; the tickEnd effect stays pending
  expect(String(thrown)).toMatch(/flushSync\(\) is not reentrant/);
  expect(ran).toEqual([0]);
  flushAll();
  expect(ran).toEqual([0, 1]);
});
```
(`frame.test.ts` imports `flushSync` from `fasterdom` — the frame-only one; the second half of the first test deliberately uses the public one, `flushAll`, so the tickEnd effect runs first; the second test checks that the public one refuses a pass before touching the tickEnd queue.)

- [ ] **Step 4: Docs**

`docs/superpowers/specs/2026-10-11-frameact-design.md` §3.1 — replace the `flushSync()` bullet
```markdown
- `flushSync()`: синхронный дрен всех четырёх очередей с корректным `setPhase`
  и сбросом `waiting` у throttle; реентер — ошибка в dev. Гейт `flushSync` **не**
  обходит. Нужен для тестов; `render()` в нём не нуждается (§3.3).
```
with
```markdown
- `flushSync()`: синхронный проход кадра — все четыре очереди с настоящей
  последовательностью `setPhase`. **Контракт для прода (план 4):** разрешён откуда
  угодно *вне* прохода кадра — из обработчика события, экшена стора, tickEnd-эффекта —
  когда DOM должен быть закоммичен до конца текущей задачи (iOS-жест «назад»,
  колбэк View Transition: `ungated(() => setState(…)); flushSync()`). *Внутри*
  прохода (compute/apply кадрового эффекта, задача `requestMeasure`/`requestMutation`/
  `requestForcedReflow`, колбэк `forceMeasure`) — ошибка в dev и в проде: фазы
  переплелись бы (счётчик `passDepth` в `fasterdom.ts`; микротаск между сегментами
  rAF-прохода — tickEnd-дрен — *не* внутри прохода). Гейт `flushSync` **не** обходит.
  stricterdom не даёт ложных срабатываний внутри `flushSync`: записи
  `MutationObserver` разбираются при каждой смене фазы, а не в колбэке (§3.4).
  `render()` в нём не нуждается (§3.3).
```

`README.md` — replace the bullet
```markdown
- `frameForcedReflow` for the rare "mutate → measure → mutate" (FLIP) case, still inside one frame.
```
with
```markdown
- `frameForcedReflow` for the rare "mutate → measure → mutate" (FLIP) case, still inside one frame;
- `flushSync()` commits the frame synchronously when the current task must see the DOM (an iOS swipe-back gesture, a View
  Transition callback): allowed from event handlers, store actions and tickEnd effects; inside a frame pass it throws.
```
`README.ru.md` — replace
```markdown
- `frameForcedReflow` — для редкого случая «mutate → measure → mutate» (FLIP), всё ещё в одном кадре.
```
with
```markdown
- `frameForcedReflow` — для редкого случая «mutate → measure → mutate» (FLIP), всё ещё в одном кадре;
- `flushSync()` коммитит кадр синхронно, когда DOM нужен до конца текущей задачи (iOS-жест «назад», колбэк View
  Transition): разрешён из обработчиков событий, экшенов стора и tickEnd-эффектов; внутри прохода кадра — ошибка.
```
`README.zh-CN.md` — replace
```markdown
- `frameForcedReflow` 用于少见的 "mutate → measure → mutate"（FLIP）场景，仍然在同一帧内完成。
```
with
```markdown
- `frameForcedReflow` 用于少见的 "mutate → measure → mutate"（FLIP）场景，仍然在同一帧内完成；
- `flushSync()` 在当前任务必须立即看到 DOM 时同步提交一帧（iOS 返回手势、View Transition 回调）：可在事件处理器、store action 和 tickEnd effect 中调用；在帧处理过程内部调用会抛出错误。
```

- [ ] **Step 5: Run the tests, then the full check**

Run: `pnpm vitest run test/scheduler/fasterdom.test.ts test/effects/frame.test.ts`
Expected: `Tests  35 passed (35)`.

Run: `pnpm check`
Expected: lint silent; `Tests  989 passed (989)`.

- [ ] **Step 6: Commit**

```bash
git add src/scheduler/fasterdom.ts src/core/flush.ts test/scheduler/fasterdom.test.ts test/effects/frame.test.ts docs/superpowers/specs/2026-10-11-frameact-design.md README.md README.ru.md README.zh-CN.md
git commit -m "feat(scheduler): flushSync production contract — allowed outside a frame pass, throws inside one (passDepth); spec §3.1, README ×3

Co-Authored-By: <your model name> <noreply@anthropic.com>"
```

---

### Task 6: The headless-Chrome lane, the surface test, README ×3, spec §3.4/§4/§5

**Files:**
- Create: `test/chrome/index.html`, `test/chrome/main.tsx`, `test/chrome/vite.config.ts`, `test/chrome/run.mjs`, `test/stricterdom/index.test.ts`, `test/stricterdom/production.test.ts`
- Modify: `package.json` (`scripts.test:chrome`), `.gitignore`, `README.md`, `README.ru.md`, `README.zh-CN.md`, `docs/superpowers/specs/2026-10-11-frameact-design.md` (§3.4, §4, §5)

**Interfaces:**
- Consumes: the whole `frameact/stricterdom` surface (Tasks 2, 4); `frameact/vite` (`src/vite/index.ts`, default export `frameact(options)`); Vite's JS API (`build`, `preview`).
- Produces: `pnpm test:chrome` — prints one `ok <name>` / `FAIL <name> — <detail>` line per scenario and `9/9 scenarios passed`, exit code 1 on any failure or when the page did not publish `data-result`; `CHROME_BIN` overrides the Chrome path. Not part of `pnpm check`.

- [ ] **Step 1: The page — `test/chrome/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>frameact stricterdom — headless Chrome lane</title>
    <style>
      body { margin: 0; }
      .box { width: 120px; height: 48px; }
      #app { padding: 8px; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: The scenarios — `test/chrome/main.tsx`**

```tsx
// The headless-Chrome lane (run by test/chrome/run.mjs): what jsdom cannot check — real layout
// values, `innerText` / `elementFromPoint` / `scrollingElement` / `visualViewport`, the real
// MutationObserver and rAF microtask ordering, `isContentEditable`. Each scenario records the
// violations stricterdom reported; the page publishes the results in `data-result` on <html>.
import {
  createEffect, createMeasureEffect, createMutationEffect, createRoot, createSignal, flushSync, requestMeasure, requestMutation,
} from 'frameact';
import { createComponent, Portal, render } from 'frameact/dom';
import {
  enableStrict, forceMeasure, forceMutation, getRunStats, IGNORE_SUBTREE_ATTR, setHandler, type StrictViolationError,
} from 'frameact/stricterdom';

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];
let violations: StrictViolationError[] = [];
const app = document.getElementById('app')!;

const summary = (v: StrictViolationError) => `${v.kind}:${v.detail}:${v.phase}:${v.path ?? '-'}`;

/**
 * One frame pass plus a macrotask, so the pass's microtasks (phases, observer callbacks) have run.
 * Headless Chrome under `--dump-dom` may never paint, so rAF may never fire: fasterdom then runs the
 * pass from its 35 ms timeout fallback, and this helper waits for whichever comes first.
 */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setTimeout(resolve, 0);
    };
    requestAnimationFrame(finish);
    setTimeout(finish, 80);
  });
}

function check(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

async function scenario(name: string, run: () => Promise<string[]> | string[]) {
  violations = [];
  try {
    const expected = await run();
    await nextFrame();
    const got = violations.map(summary);
    check(name, JSON.stringify(got) === JSON.stringify(expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`);
  } catch (error) {
    check(name, false, `threw ${String(error)}`);
  }
}

function Panel(props: { probe: () => number }) {
  const [pad, setPad] = createSignal(0);
  let box!: HTMLDivElement;
  const view = <div ref={(el) => { box = el; }} class="box" style={{ 'padding-top': `${props.probe() + pad()}px` }} />;
  createMeasureEffect(() => props.probe(), () => { setPad(box.offsetHeight > 0 ? 1 : 0); }); // measure phase: allowed
  return view;
}

async function main() {
  enableStrict();
  setHandler((error) => { violations.push(error); });

  // 1. a layout read inside a compiled binding, in the mutate phase, with real layout behind it
  await scenario('measure-in-mutate', async () => {
    const [n, setN] = createSignal(0);
    let box!: HTMLElement;
    const dispose = render(() => createComponent(Panel, { probe: () => (n() === 0 ? 0 : (box.offsetHeight > 0 ? 1 : -1)) }), app);
    box = app.querySelector('.box')!;
    await nextFrame(); // the measure effect saw real layout (48px) and added 1px of padding
    setN(1); // the probe, read by the style binding in the mutate phase, reads layout: +1px and one violation
    await nextFrame();
    const height = box.offsetHeight; // 48 + 1 (measure effect) + 1 (probe)
    dispose();
    await nextFrame();
    return height === 50 ? ['measure:offsetHeight:mutate:Panel > div.style:padding-top'] : [`layout was ${height}`];
  });

  // 2. the Chrome-only layout causes
  await scenario('chrome-only-causes', () => {
    const el = document.createElement('div');
    el.textContent = 'x';
    forceMutation(() => app.appendChild(el), app);
    requestMutation(() => {
      void el.innerText;
      void document.elementFromPoint(1, 1);
      void document.scrollingElement;
      void visualViewport!.height;
    });
    return [
      'measure:innerText:mutate:-', 'measure:elementFromPoint:mutate:-', 'measure:scrollingElement:mutate:-', 'measure:height:mutate:-',
    ];
  });

  // 3. real rAF pass: a write in a measure task is caught; writes in the mutate task are not
  await scenario('raf-phases', () => {
    const el = document.createElement('div');
    forceMutation(() => app.appendChild(el), app);
    requestMeasure(() => { el.className = 'bad'; });
    requestMutation(() => { el.className = 'good'; el.appendChild(document.createElement('i')); });
    return ['mutation:class:measure:-'];
  });

  // 4. an event handler writing the DOM directly, through the real observer
  await scenario('event-handler-write', () => {
    const button = document.createElement('button');
    button.addEventListener('click', () => { button.classList.add('clicked'); });
    forceMutation(() => app.appendChild(button), app);
    button.click();
    return ['mutation:class:measure:-'];
  });

  // 5. forceMeasure in a mutate task reads real layout; a write inside its window is caught
  await scenario('forceMeasure', () => {
    const el = document.createElement('div');
    el.className = 'box';
    forceMutation(() => app.appendChild(el), app);
    let read = -1;
    requestMutation(() => {
      read = forceMeasure(() => el.offsetHeight);
      forceMeasure(() => { el.title = 'inside'; });
    });
    flushSync(); // from the event-handler level: allowed
    return read === 48 ? ['mutation:title:measure:-'] : [`read ${read}`];
  });

  // 6. the exceptions with the real DOM: isContentEditable, details[open], data-*, the ignore attribute
  await scenario('exceptions', async () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    const details = document.createElement('details');
    const ignored = document.createElement('div');
    ignored.setAttribute(IGNORE_SUBTREE_ATTR, '');
    forceMutation(() => { app.append(editor, details, ignored); }, app);
    await nextFrame();
    editor.appendChild(document.createTextNode('typed')); // childList inside an editable host
    details.open = true;
    app.dataset.state = 'open';
    ignored.appendChild(document.createElement('p'));
    ignored.firstElementChild!.className = 'x';
    editor.setAttribute('class', 'focused'); // an attribute on the editable host is still a violation
    return ['mutation:class:measure:-'];
  });

  // 7. selectionStart in the mutate phase
  await scenario('selectionStart', () => {
    const input = document.createElement('input');
    forceMutation(() => app.appendChild(input), app);
    requestMutation(() => { void input.selectionStart; });
    return ['measure:selectionStart:mutate:-'];
  });

  // 8. render + Portal + flushSync from the event-handler level: a clean app produces nothing
  await scenario('render-portal-flushSync', async () => {
    const [n, setN] = createSignal(0);
    const dispose = render(() => {
      const span = document.createElement('span');
      createMutationEffect(() => n(), (v) => { span.textContent = String(v); span.className = `n${v}`; });
      return [span, createComponent(Portal, { get children() { return document.createElement('i'); } })];
    }, app);
    await nextFrame();
    setN(1);
    flushSync();
    const committed = app.querySelector('span')!.className === 'n1';
    await nextFrame();
    dispose();
    await nextFrame();
    const stats = getRunStats().find((s) => s.path === 'mutation');
    return committed && stats !== undefined && stats.runs >= 1 ? [] : [`committed=${committed} stats=${JSON.stringify(stats)}`];
  });

  // 9. a handler writes a signal, then the DOM: in a browser the tickEnd drain runs BEFORE the observer
  //    callback — the pending record must not be attributed to the tickEnd effect that applies first
  await scenario('handler-write-before-tickEnd', async () => {
    const [n, setN] = createSignal(0);
    const button = document.createElement('button');
    forceMutation(() => app.appendChild(button), app);
    const dispose = createRoot((d) => {
      createEffect(() => n(), () => {}, undefined, { name: 'logic' });
      return d;
    });
    button.addEventListener('click', () => { setN(n() + 1); button.classList.add('pressed'); });
    await nextFrame(); // the first apply is done and no observer microtask is queued any more
    button.click();
    await nextFrame();
    dispose();
    return ['mutation:class:measure:-'];
  });

  document.documentElement.dataset.result = JSON.stringify(results);
}

main().catch((error: unknown) => {
  results.push({ name: 'main', ok: false, detail: String(error) });
  document.documentElement.dataset.result = JSON.stringify(results);
});
```

- [ ] **Step 3: The build config — `test/chrome/vite.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
// The `.ts` extension keeps Vite's native config loader from warning (as in the root vitest.config.ts); this file
// is inside tsconfig's `include`, where an explicit `.ts` import is TS5097 without allowImportingTsExtensions.
// @ts-expect-error TS5097 — Vite bundles the config, the extension is fine at runtime
import frameact from '../../src/vite/index.ts';

const src = (file: string) => fileURLToPath(new URL(`../../src/${file}`, import.meta.url));

/** The headless-Chrome lane: a dev build (DEV = true, sourceNames on) of test/chrome/main.tsx. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  mode: 'development',
  plugins: [frameact({ dev: true })],
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  resolve: {
    alias: [
      { find: 'frameact/dom', replacement: src('dom/index.ts') },
      { find: 'frameact/stricterdom', replacement: src('stricterdom/index.ts') },
      { find: 'frameact/jsx-runtime', replacement: src('jsx-runtime.ts') },
      { find: /^frameact$/, replacement: src('index.ts') },
    ],
  },
  build: { outDir: 'dist', emptyOutDir: true, minify: false, target: 'es2022' },
  logLevel: 'warn',
});
```

- [ ] **Step 4: The runner — `test/chrome/run.mjs`**

```js
// The headless-Chrome lane: `pnpm test:chrome`. Builds test/chrome (a dev build through the frameact
// Vite plugin), serves it with `vite preview`, dumps the DOM from headless Chrome and checks the
// results the page published in `data-result`. Needs Google Chrome (CHROME_BIN overrides the path);
// not part of `pnpm check` (jsdom covers the patch logic; this lane covers real layout and timing).
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build, preview } from 'vite';

const configFile = fileURLToPath(new URL('./vite.config.ts', import.meta.url));
/** `data-result` is an HTML attribute: undo the serializer's escaping before parsing the JSON. */
const unescapeAttr = (html) => html.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const chrome = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const port = 4178;

await build({ configFile });
const server = await preview({ configFile, preview: { port, strictPort: true } });
const profile = mkdtempSync(join(tmpdir(), 'frameact-chrome-'));
try {
  const { stdout } = await promisify(execFile)(
    chrome,
    [
      '--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profile}`,
      '--virtual-time-budget=10000', '--dump-dom', `http://localhost:${port}/`,
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  const match = /data-result="([^"]*)"/.exec(stdout);
  if (!match) {
    console.error('no data-result in the dumped DOM (the page did not finish):\n' + stdout.slice(0, 2000));
    process.exitCode = 1;
  } else {
    const results = JSON.parse(unescapeAttr(match[1]));
    let failed = 0;
    for (const { name, ok, detail } of results) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` — ${detail}`}`);
      if (!ok) failed++;
    }
    console.log(`${results.length - failed}/${results.length} scenarios passed`);
    if (failed) process.exitCode = 1;
  }
} finally {
  await new Promise((resolve) => server.httpServer.close(resolve));
  rmSync(profile, { recursive: true, force: true });
}
```

`package.json` — in `"scripts"`, after the `"check"` line add
```json
    "test:chrome": "node test/chrome/run.mjs",
```
`.gitignore` — append the line `test/chrome/dist/`.

- [ ] **Step 5: Run the lane**

Run: `pnpm test:chrome`
Expected (about 2 s):
```
ok   measure-in-mutate
ok   chrome-only-causes
ok   raf-phases
ok   event-handler-write
ok   forceMeasure
ok   exceptions
ok   selectionStart
ok   render-portal-flushSync
ok   handler-write-before-tickEnd
9/9 scenarios passed
```
`no data-result in the dumped DOM` with `<div class="box" …>` still in the dump means the page stalled waiting for a `requestAnimationFrame` that never fires under `--dump-dom` — check that `nextFrame()` has the 80 ms fallback. Scenario 9 is the one place the browser's microtask order (the tickEnd drain *before* the observer callback) is exercised: `got ["mutation:class:measure:logic"]` means the apply hook is not called before the apply (Task 1, Edit 6a). If Chrome is elsewhere: `CHROME_BIN=/path/to/chrome pnpm test:chrome`.

- [ ] **Step 6: The surface test — `test/stricterdom/index.test.ts` — and the production-build test — `test/stricterdom/production.test.ts`**

```ts
import * as strict from '../../src/stricterdom/index';

it('exports the frameact/stricterdom surface', () => {
  for (const name of [
    'enableStrict', 'disableStrict', 'isStrictEnabled', 'forceMeasure', 'forceMutation', 'suppressStrict', 'setHandler',
    'enableRunLog', 'disableRunLog', 'getRunStats', 'resetRunStats',
  ]) {
    expect(typeof (strict as Record<string, unknown>)[name], name).toBe('function');
  }
  expect(strict.IGNORE_SUBTREE_ATTR).toBe('data-stricterdom-ignore');
  expect(strict.SLOW_RUN_MS).toBe(7);
  expect(new strict.StrictViolationError('measure', 'offsetHeight', 'mutate', null, null).message).toBe(
    '[frameact/stricterdom] Unexpected measurement `offsetHeight` outside an effect [mutate]',
  );
  expect(strict.LAYOUT_CAUSES.HTMLInputElement.props).toEqual(['selectionStart', 'selectionEnd']);
});

it('every escape is a plain call while strict is off', () => {
  const el = document.createElement('div');
  expect(strict.isStrictEnabled()).toBe(false);
  expect(strict.forceMutation(() => 1, el)).toBe(1);
  expect(strict.suppressStrict(() => 2)).toBe(2);
  expect(strict.getRunStats()).toEqual([]);
  expect(strict.forceMeasure(() => 3)).toBe(3);
});
```

`test/stricterdom/production.test.ts` (a real `vite build` of an app that calls the whole surface, `NODE_ENV=production` vs `development`; about 0.3 s):
```ts
// @vitest-environment node
// The DEV-only claim, checked on a real production build: an app that calls the whole
// frameact/stricterdom surface keeps none of the detectors, the observer, the profiler or the
// core's attribution fields — only the thin wrappers.
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

const src = (file: string) => fileURLToPath(new URL(`../../src/${file}`, import.meta.url));

const ENTRY = `
import { enableStrict, disableStrict, forceMeasure, forceMutation, suppressStrict, setHandler, enableRunLog, getRunStats } from ${JSON.stringify(src('stricterdom/index.ts'))};
import { createMemo, createMutationEffect, createSignal, flushSync } from ${JSON.stringify(src('index.ts'))};
enableStrict();
setHandler(() => {});
enableRunLog();
const [a, setA] = createSignal(0);
const doubled = createMemo(() => a() * 2);
createMutationEffect(() => doubled(), (v) => {
  forceMeasure(() => v);
  forceMutation(() => v, document.body);
  suppressStrict(() => v);
});
setA(1);
flushSync();
console.log(getRunStats());
disableStrict();
`;

/** The app above as a virtual module. */
const entryPlugin: Plugin = {
  name: 'entry',
  resolveId: (id) => (id.endsWith('virtual:app') ? '\0app' : null), // (lib mode resolves the entry against the root first)
  load: (id) => (id === '\0app' ? ENTRY : null),
};

async function bundle(mode: 'production' | 'development'): Promise<string> {
  const out = (await build({
    configFile: false,
    logLevel: 'silent',
    mode,
    plugins: [entryPlugin],
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    build: { write: false, minify: false, lib: { entry: 'virtual:app', formats: ['es'], fileName: 'app' } },
  })) as { output: { code: string }[] }[];
  return out[0].output[0].code;
}

const DEV_ONLY = ['MutationObserver', 'Unexpected measurement', 'getBoundingClientRect', 'Slow effect run', 'performance.now', 'stampNotify', '_dirtyDep', 'effectPath'];

it('a production build keeps none of stricterdom, the profiler or the core attribution (a dev build keeps all)', async () => {
  const prod = await bundle('production');
  const dev = await bundle('development');
  expect(DEV_ONLY.filter((s) => prod.includes(s))).toEqual([]);
  expect(DEV_ONLY.filter((s) => !dev.includes(s))).toEqual([]);
  expect(prod).toContain('function forceMeasure'); // the thin wrappers stay
}, 30_000);
```

Run: `pnpm vitest run test/stricterdom/index.test.ts test/stricterdom/production.test.ts` — Expected: `Tests  3 passed (3)`.

- [ ] **Step 7: README ×3**

`README.md`:
1. Replace
```markdown
- **stricterdom** *(planned)* — a dev mode that catches phase violations at the DOM-API level and names the
  offending effect.
```
with
```markdown
- **stricterdom** — a dev mode that catches phase violations at the DOM-API level and names the offending effect
  (`Message > MessageMeta > span.style:color [mutate]`).
```
2. Replace
```markdown
> a signal tree with cause-tagged parking during heavy animations) is in. Next: stricterdom. Not published
> to npm yet. APIs may change.
```
with
```markdown
> a signal tree with cause-tagged parking during heavy animations) is in, and so is stricterdom (`frameact/stricterdom`:
> DEV phase checks with effect attribution, a run profiler). Next: the benchmark. Not published to npm yet. APIs may change.
```
3. Replace `| Phase-violation checks | stricterdom | no | stricterdom + effect attribution *(planned)* |` with `| Phase-violation checks | stricterdom | no | stricterdom + effect attribution |`.
4. Insert before the line `## Inspiration and credits`:
````markdown
## stricterdom (dev mode)

A dev-only guard that turns the phase discipline into a checked invariant at the DOM-API level, ported from teact:
layout-forcing getters and methods (`offsetHeight`, `getBoundingClientRect()`, `scrollTop`, `focus()`,
`getComputedStyle()`, `selectionStart`, …) report a violation outside the measure phase, and a `MutationObserver` on
`document.body` reports live-DOM writes outside the mutate phase. Every violation names the effect:

```ts
import { enableStrict, setHandler } from 'frameact/stricterdom';
if (import.meta.env.DEV) enableStrict();
// [frameact/stricterdom] Unexpected measurement `offsetHeight` in Message > MessageMeta > span.style:color [mutate]
// [frameact/stricterdom] Unexpected mutation `class` of <button id="send"> outside an effect [measure]
```

Component names come from the compiler's `sourceNames` (on in dev), binding names are the compiler's labels. Detached
subtrees are never reported (that is how the runtime builds DOM), nor are `data-*` attributes, `details[open]`, edits
inside `contenteditable` hosts and anything under `data-stricterdom-ignore`. Escapes: `forceMeasure(cb)` reads layout from
the mutate phase (scroll anchoring; a plain call anywhere else), `forceMutation(cb, nodes)` writes from the measure phase
(a mount — `render()` and `Portal` use it), `suppressStrict(cb)` turns both checks off for third-party code,
`setHandler(fn)` replaces `console.error` (throw from it to fail a test). Mutation records are judged at every phase change
and around every effect apply, so `flushSync()` never produces a false positive and the report names the effect that made
the write.

The same switch turns on the DEV profiler: a run slower than 7 ms warns with its path (`Slow effect run: 12.3 ms in
Message > span.children [mutate]`), so does a frame phase (`Slow mutate drain: 18.0 ms, 240 effect runs; slowest: …`),
`getRunStats()` counts runs per path, and `enableRunLog({ filter })` prints why each effect ran:
`run #3 ChatList > li.class [mutate] ← signal "store.title" via memo "chatTitle" in ChatList`. All of it is dead code in
production builds (`process.env.NODE_ENV === 'production'`): the functions become `cb => cb()`.

````
5. Replace `| 4 · stricterdom | dev-mode phase checks with effect attribution | ⏳ |` with `| 4 · stricterdom | dev-mode phase checks with effect attribution, run profiler, `flushSync` production contract | ✅ done |`.
6. In the Development block, after the line `pnpm check     # oxlint + TypeScript 7 (tsc) + vitest` add
```
pnpm test:chrome  # stricterdom in headless Chrome (real layout, real observer timing); needs Google Chrome
```

`README.ru.md`:
1. Replace `- **stricterdom** *(в планах)* — dev-режим, который ловит нарушения фаз на уровне DOM API и называет виновный эффект.` with
```markdown
- **stricterdom** — dev-режим, который ловит нарушения фаз на уровне DOM API и называет виновный эффект
  (`Message > MessageMeta > span.style:color [mutate]`).
```
2. Replace `> сигналов с парковкой по причине на время тяжёлых анимаций) тоже готов. Дальше — stricterdom.` with
```markdown
> сигналов с парковкой по причине на время тяжёлых анимаций) тоже готов, как и stricterdom (`frameact/stricterdom`:
> dev-проверки фаз с атрибуцией до эффекта, профайлер прогонов). Дальше — бенчмарк.
```
3. Replace `| Проверка нарушений фаз | stricterdom | нет | stricterdom + атрибуция до эффекта *(в планах)* |` with `| Проверка нарушений фаз | stricterdom | нет | stricterdom + атрибуция до эффекта |`.
4. Insert before `## Вдохновение и благодарности`:
````markdown
## stricterdom (dev-режим)

Dev-страж, который превращает дисциплину фаз в проверяемый инвариант на уровне DOM API (порт из teact): геттеры и
методы, вызывающие layout (`offsetHeight`, `getBoundingClientRect()`, `scrollTop`, `focus()`, `getComputedStyle()`,
`selectionStart`, …), сообщают о нарушении вне measure-фазы, а `MutationObserver` на `document.body` — о записях в
живой DOM вне mutate-фазы. Каждое нарушение называет эффект:

```ts
import { enableStrict, setHandler } from 'frameact/stricterdom';
if (import.meta.env.DEV) enableStrict();
// [frameact/stricterdom] Unexpected measurement `offsetHeight` in Message > MessageMeta > span.style:color [mutate]
// [frameact/stricterdom] Unexpected mutation `class` of <button id="send"> outside an effect [measure]
```

Имена компонентов даёт `sourceNames` компилятора (включён в dev), имена биндингов — его метки. Detached-поддеревья не
считаются нарушением (так рантайм и строит DOM), как и `data-*`-атрибуты, `details[open]`, правки внутри
`contenteditable` и всё под `data-stricterdom-ignore`. Эскейпы: `forceMeasure(cb)` читает layout из mutate-фазы (якорь
скролла; вне mutate-фазы — обычный вызов), `forceMutation(cb, nodes)` пишет из measure-фазы (монтирование — так работают
`render()` и `Portal`), `suppressStrict(cb)` выключает обе проверки для стороннего кода, `setHandler(fn)` заменяет
`console.error` (бросьте из него, чтобы уронить тест). Записи мутаций разбираются при каждой смене фазы и вокруг каждого
apply эффекта, поэтому `flushSync()` не даёт ложных срабатываний, а отчёт называет эффект, который сделал запись.

Тот же выключатель включает dev-профайлер: прогон дольше 7 мс предупреждает с путём (`Slow effect run: 12.3 ms in
Message > span.children [mutate]`), фаза кадра — тоже (`Slow mutate drain: 18.0 ms, 240 effect runs; slowest: …`),
`getRunStats()` считает прогоны по путям, а `enableRunLog({ filter })` печатает, почему эффект выполнился:
`run #3 ChatList > li.class [mutate] ← signal "store.title" via memo "chatTitle" in ChatList`. В production-сборке
(`process.env.NODE_ENV === 'production'`) всё это — мёртвый код: функции превращаются в `cb => cb()`.

````
5. Replace `| 4 · stricterdom | dev-проверки фаз с атрибуцией до эффекта | ⏳ |` with `| 4 · stricterdom | dev-проверки фаз с атрибуцией до эффекта, профайлер прогонов, контракт `flushSync` для прода | ✅ готово |`.
6. After `pnpm check     # oxlint + TypeScript 7 (tsc) + vitest` add
```
pnpm test:chrome  # stricterdom в headless Chrome (настоящий layout и тайминг observer'а); нужен Google Chrome
```

`README.zh-CN.md`:
1. Replace `- **stricterdom** *（计划中）* —— 开发模式下在 DOM API 层面捕获阶段违规，并指出是哪个 effect 造成的。` with `- **stricterdom** —— 开发模式下在 DOM API 层面捕获阶段违规，并指出是哪个 effect 造成的（`Message > MessageMeta > span.style:color [mutate]`）。`
2. Replace `> 按原因停靠的 signal 树）也已完成。接下来是 stricterdom。尚未发布到 npm，API 可能变化。` with `> 按原因停靠的 signal 树）也已完成，stricterdom（`frameact/stricterdom`：开发模式阶段检查并定位到 effect，运行分析器）也已完成。接下来是基准测试。尚未发布到 npm，API 可能变化。`
3. Replace `| 阶段违规检查 | stricterdom | 无 | stricterdom + 定位到 effect *（计划中）* |` with `| 阶段违规检查 | stricterdom | 无 | stricterdom + 定位到 effect |`.
4. Insert before `## 灵感与致谢`:
````markdown
## stricterdom（开发模式）

一个仅限开发模式的守卫，把阶段纪律变成 DOM API 层面可检查的不变量（移植自 teact）：触发布局的 getter 和方法
（`offsetHeight`、`getBoundingClientRect()`、`scrollTop`、`focus()`、`getComputedStyle()`、`selectionStart` 等）在 measure
阶段之外被调用时报告违规；`document.body` 上的 `MutationObserver` 报告 mutate 阶段之外对真实 DOM 的写入。每条违规都会指出
effect：

```ts
import { enableStrict, setHandler } from 'frameact/stricterdom';
if (import.meta.env.DEV) enableStrict();
// [frameact/stricterdom] Unexpected measurement `offsetHeight` in Message > MessageMeta > span.style:color [mutate]
// [frameact/stricterdom] Unexpected mutation `class` of <button id="send"> outside an effect [measure]
```

组件名来自编译器的 `sourceNames`（开发模式下开启），绑定名是编译器的标签。游离子树不会被报告（运行时就是这样构建 DOM 的），
`data-*` 属性、`details[open]`、`contenteditable` 宿主内部的编辑以及 `data-stricterdom-ignore` 之下的一切也不会。逃生口：
`forceMeasure(cb)` 在 mutate 阶段读取布局（滚动锚定；在其他阶段只是普通调用），`forceMutation(cb, nodes)` 在 measure 阶段写入（挂载——
`render()` 和 `Portal` 就用它），`suppressStrict(cb)` 为第三方代码关闭两项检查，`setHandler(fn)` 替换 `console.error`（在其中抛出即可让测试失败）。
变更记录在每次阶段切换以及每个 effect apply 的前后判定，因此 `flushSync()` 不会产生误报，报告指出做出写入的 effect。

同一个开关还会开启开发分析器：超过 7 ms 的运行会带路径发出警告（`Slow effect run: 12.3 ms in Message > span.children
[mutate]`），帧阶段同样（`Slow mutate drain: 18.0 ms, 240 effect runs; slowest: …`），`getRunStats()` 按路径统计运行次数，
`enableRunLog({ filter })` 打印每个 effect 为何运行：`run #3 ChatList > li.class [mutate] ← signal "store.title" via memo
"chatTitle" in ChatList`。在生产构建（`process.env.NODE_ENV === 'production'`）中这些全是死代码：函数退化为 `cb => cb()`。

````
5. Replace `| 4 · stricterdom | 开发模式阶段检查，定位到具体 effect | ⏳ |` with `| 4 · stricterdom | 开发模式阶段检查，定位到具体 effect，运行分析器，`flushSync` 生产契约 | ✅ 完成 |`.
6. After `pnpm check     # oxlint + TypeScript 7 (tsc) + vitest` add
```
pnpm test:chrome  # 在 headless Chrome 中运行 stricterdom（真实布局、真实 observer 时序）；需要 Google Chrome
```

- [ ] **Step 8: Spec §3.4, §4, §5**

In `docs/superpowers/specs/2026-10-11-frameact-design.md`, replace the whole §3.4 (from the line `### 3.4 \`stricterdom\`` up to, not including, `### 3.5 \`store\``) with:

```markdown
### 3.4 `stricterdom`

Порт `teact/src/lib/fasterdom/stricterdom.ts` и `layoutCauses.ts` (план 4): патч
геттеров/методов, вызывающих layout → нарушение, если фаза не `measure`;
`MutationObserver` на `document.body` → нарушение, если мутация при фазе не `mutate`.
Detached-узлы игнорируются (`contains` документа через прототипные натив-методы —
DOM clobbering, `natives.ts`), поэтому создание поддеревьев нарушением не считается. Исключения: `data-*`-атрибуты, `details[open]`, `childList`
внутри `contentEditable`-хоста (`isContentEditable`; в jsdom — `closest('[contenteditable]')`),
поддерево под `data-stricterdom-ignore` (константа `IGNORE_SUBTREE_ATTR`). `layoutCauses`
дополнен `selectionStart`/`selectionEnd` (`HTMLInputElement`, `HTMLTextAreaElement`).
Включается в dev (`enableStrict()`); в проде всё дерево модуля — мёртвый код (`DEV`),
публичные функции — `cb => cb()`.

**Фаза и записи observer'а.** Фаза берётся из планировщика (`getPhase`), а не хранится
отдельно; `forceMeasure` подменяет её локально. Записи `MutationObserver` **не ждут
колбэка**: они снимаются (`takeRecords`) при каждой смене фазы (`onPhaseChange`) и
проверяются против *предыдущей* фазы, а также до и после каждого apply эффекта вне
mutate-фазы (хук `setApplyHook` ядра) и вокруг `forceMeasure`/`forceMutation`/
`suppressStrict`. Поэтому (а) внутри `flushSync` нет ложных срабатываний (колбэк
observer'а пришёл бы уже после прохода, с фазой `measure`), (б) запись из apply
measure-/tickEnd-эффекта атрибутируется этому эффекту синхронно, а запись, сделанная
до apply (обработчик события, сырая задача), — не ему (в браузере tickEnd-дрен идёт
раньше колбэка observer'а). `suppressStrict` —
счётчик, а не unpatch/repatch; записи окна отбрасываются по его закрытию.

**Публичный API `frameact/stricterdom`:** `enableStrict()`, `disableStrict()`,
`isStrictEnabled()`, `forceMeasure(cb)` (в mutate-фазе — окно measure, запись внутри —
нарушение; в любом другом контексте — обычный вызов, без ошибки),
`forceMutation(cb, nodes, allowAnyPhase?)` (dev-ошибка в mutate-фазе без `allowAnyPhase`;
санкционированы записи, чья цель — один из `nodes`; вложенная санкция того же узла не
снимает внешнюю), `suppressStrict(cb)`,
`setHandler(handler?)`, класс `StrictViolationError { kind: 'measure' | 'mutation';
detail; phase; path; target }`, `IGNORE_SUBTREE_ATTR`, `LAYOUT_CAUSES`. Шов
`strictHooks.forceMutation` в `src/dom/strict.ts` (его зовут `render()` и `Portal`)
при `enableStrict()` указывает на санкционирование без проверки фазы.

**Атрибуция.** Ядро в dev держит `currentEffect` на время `run`. Сообщение:
`[frameact/stricterdom] Unexpected measurement \`offsetHeight\` in Message > MessageMeta >
span.style:color [mutate]` — имена компонентов (третий аргумент `createComponent`, из
`sourceNames`), имя биндинга (метка компилятора или фасада: `div.class`, `measure`),
фаза, в которой случилось нарушение; у мутации — ещё цель (`<button id="send">`); вне
эффекта — `outside an effect`. Путь строит ядро (`src/core/debug.ts`: `ownerPath`,
`effectPath`, `describeNode`), им же пользуется предупреждение «measure-эффект загрязнён
из mutate-фазы» (`frame.ts`) — теперь с путём и источником записи.

**Dev-профайлер (тот же выключатель, `runlog.ts`).** «Slow run» (> 7 мс, `SLOW_RUN_MS`)
на прогон эффекта и на дрен фазы (с самым медленным эффектом); счётчики прогонов по
пути (`getRunStats()`/`resetRunStats()`); лог «почему выполнился» (`enableRunLog({ filter })`
/ `disableRunLog()`): `run #3 ChatList > li.class [mutate] ← signal "store.title" via memo
"chatTitle" in ChatList`. Источник записывает `notify()` ядра перед вызовом планировщика
(`notifyDep`/`notifyRoot`; на эффекте — до конца прогона, чтобы освобождённый лист
стора не удерживался), листья стора получают dev-id `store.<ключ>` / `store.$TRACK` /
`store.$VALUES`; «самый медленный эффект» дрена — только из этого дрена
(`getDrainingPhase`). Это замена `debugKey`/dblclick-дампов teact. В production-сборке
всё перечисленное — мёртвый код; это проверяет тест `production.test.ts` (настоящий
`vite build`).

Следствие архитектуры: поскольку **все** записи в живой DOM идут через mutate-фазу,
любая точка вне её — безопасное окно для чтения layout. В teact это соглашение, у
нас — проверяемый инвариант с именем нарушителя.

```

§4 — three edits in the tree:
```
    core/                 форк maverick (+ правки §3.2), effects.ts (run, очереди run'ов,
                          планировщики, гейтинг), context.ts, map.ts (+key fn)
```
→
```
    core/                 форк maverick (+ правки §3.2), effects.ts (run, очереди run'ов,
                          планировщики, гейтинг), context.ts, map.ts (+key fn),
                          debug.ts (dev-атрибуция: ownerPath/effectPath/describeNode)
```
`    stricterdom/          stricterdom.ts, layoutCauses.ts, attribution.ts` → `    stricterdom/          stricterdom.ts, layoutCauses.ts, runlog.ts (профайлер), index.ts`
`  test/                   vitest + jsdom` → `  test/                   vitest + jsdom; test/chrome — дорожка в headless Chrome (pnpm test:chrome)`

§5 — replace the stricterdom bullet
```markdown
- stricterdom: чтение layout в mutate / запись в measure → ошибка с путём
  `Component > binding [phase]`; detached игнорируется; `selectionStart` в mutate
  → ошибка.
```
with
```markdown
- stricterdom: чтение layout в mutate / запись в measure → ошибка с путём
  `Component > binding [phase]`; detached игнорируется; `selectionStart` в mutate
  → ошибка; исключения (`data-*`, `details[open]`, `contentEditable`,
  `data-stricterdom-ignore`); `forceMeasure`/`forceMutation`/`suppressStrict`/`setHandler`;
  `render` и `Portal` (в том числе Portal в Portal) через шов без ошибок; `flushSync` без
  ложных срабатываний; запись из tickEnd-эффекта атрибутируется синхронно, а запись до
  apply — не ему; clobbering `document.contains`/`document.body` не ломает проверки;
  полное приложение на компиляторе (For keyed и manual, Show/Switch/Dynamic/Portal,
  `use:value`, парковка) — 0 нарушений; профайлер: счётчики, лог «почему выполнился»,
  slow run/drain (мок `performance.now`); production-сборка без dev-кода (`vite build`).

**Дорожка в headless Chrome (`pnpm test:chrome`, не входит в `pnpm check`).** Vite-сборка
`test/chrome/main.tsx` через плагин frameact, `vite preview`, Chrome `--headless=new
--dump-dom`; сценарии — то, чего jsdom не умеет: настоящий layout под measure-эффектом,
`innerText`/`elementFromPoint`/`scrollingElement`/`visualViewport`, порядок микротасков
настоящего rAF-прохода и observer'а (в том числе tickEnd-дрен раньше колбэка observer'а),
`isContentEditable`, `forceMeasure` с настоящим значением, `flushSync` из обработчика.
```

- [ ] **Step 9: Full check and commit**

Run: `pnpm check`
Expected: lint silent (a `warning unicorn(consistent-function-scoping)` on `run.mjs` means a helper was defined inside the `else` block — it must be at module scope); tsc 0 errors (a `TS5097` on `test/chrome/vite.config.ts` means the `@ts-expect-error` line above its `.ts` import is missing); `Test Files  72 passed (72)`, `Tests  992 passed (992)`.

```bash
git add test/chrome/index.html test/chrome/main.tsx test/chrome/vite.config.ts test/chrome/run.mjs test/stricterdom/index.test.ts test/stricterdom/production.test.ts package.json .gitignore README.md README.ru.md README.zh-CN.md docs/superpowers/specs/2026-10-11-frameact-design.md
git commit -m "feat(stricterdom): headless-Chrome lane (pnpm test:chrome), surface + production-build tests, README ×3, spec §3.4/§4/§5

Co-Authored-By: <your model name> <noreply@anthropic.com>"
```

---

## Self-review (done while writing the plan)

1. **Spec coverage.** §3.4: port of both files (Task 2); `phase !== 'measure'` → error on layout reads, `MutationObserver` on `document.body` for writes outside mutate (Task 2); detached ignored (Task 2 test "detached subtrees"); `data-*` and `contentEditable` excluded, plus the tt exceptions `data-stricterdom-ignore` and `details[open]` (Task 2); `forceMeasure`/`forceMutation`/`suppressStrict`/`setHandler` as in teact (+ `allowAnyPhase`) (Task 2); `enableStrict()` in dev, zero cost in prod (every function `if (!DEV)`; `index.test.ts` checks the escapes are plain calls while off, `production.test.ts` checks a real production build); `selectionStart/End` in `layoutCauses` (Task 2, and the Task 3 test "selectionStart may be read at event time"); attribution `Message > MessageMeta > span.textContent [mutate]`-style with `createComponent` names and `sourceNames` binding labels (Task 1 + Task 3's compiled suite gives exactly `Message > MessageMeta > span.style:color`); "slow run > 7 ms with the same path" (Task 4, per run and per drain); "measure effect dirtied from the mutate phase" with the path (Task 1). Brief: `disableStrict` ✓, `strictHooks` seam implemented ✓, DEV run counters + "why did this run" (Task 4), `flushSync` production contract with the reentry error kept (Task 5), the headless-Chrome lane and jsdom tests for the patch logic (Tasks 6, 2), attribution headers + `THIRD_PARTY_LICENSES.md` (Task 2), exact public signatures for plan 6 (Interfaces of Tasks 2 and 4). §5: "render into an attached container gives no stricterdom error" (Tasks 2, 3), "layout read in mutate / write in measure → error with path", "detached ignored", "`selectionStart` in mutate → error" ✓.
2. **Placeholder scan.** No TBD/TODO; every code step shows the code; every modify step shows old → new text; every run step names the command and the expected output.
3. **Type consistency.** `StrictViolationError(kind, detail, phase, path, target)` is constructed the same way in `stricterdom.ts`, `index.test.ts` and read as `.detail` in all three test suites and `main.tsx`; `setApplyHook`/`setRunObserver`/`setDrainObserver` take `fn | null` everywhere; `getEffectDebugInfo` returns `{ dep, root, runs }` and `runlog.ts` reads exactly those; `setStrictProfiling(on: boolean)` is defined in Task 4 and called from `stricterdom.ts` only after Task 4's edit; the `frame.test.ts` additions of Tasks 1 and 5 both rely on its existing imports (`signal`, `root`, `createMeasureEffect`, `createMutationEffect`, `createEffect`, `getPhase`, `flushSync`, `frame`, `raf`) plus the `flushAll` import added in Task 5.

**Execution notes for the implementer.** Tasks are independent in review but sequential in code: 1 → 2 → 3 → 4 → 5 → 6 (Task 2 imports Task 1's hooks; Task 4 edits Task 2's file; Task 6's lane imports Task 4's `getRunStats`). After every task read the **whole tail** of `pnpm check` — a lint error stops the chain before vitest. The only step outside `pnpm check` is Task 6 Step 5 (`pnpm test:chrome`): if there is no Chrome on the machine, skip it and say so in the commit message.

## Follow-ups (not in this plan)

1. A DEV check for live-DOM writes made from a *compute* half inside the mutate drain (the phase model allows them; a per-effect "in compute" flag plus an after-compute `takeRecords` would catch them at a cost per compute).
2. `characterData` records are not observed (teact parity): a text node written outside mutate goes unnoticed. Enabling them requires whitelisting the runtime's own `.data` writes, which all happen in mutate anyway — cheap to try once the kit exists.
3. `enableStrict()` observes `document.body` only: attribute writes on `<html>` (theme classes) are never reported. Decide with the kit whether to observe `document.documentElement` with an allow-list for `class`/`style` on `<html>`.
4. The stricterdom `setHandler` and the core's effect-error logging are two reporters; a single `setErrorReporter` for the whole core (plan 2's deferred item) could unify them.
5. The run log cannot name the *store path* beyond the leaf key (`store.title`): `StoreNode` has no parent pointer. A DEV-only parent/key pair on `StoreNode` would give `store.chats.123.title`.
6. CI for `pnpm test:chrome`: the lane runs only locally (it needs Google Chrome). A CI job with Chrome (`CHROME_BIN`) would keep the browser-only scenarios (real layout, the microtask order of scenario 9) from rotting.
7. Between the mutate segment of a rAF pass and its forced-reflow segment the scheduler phase stays `mutate` (teact parity), so a tickEnd effect or a promise continuation running in that microtask gap writes the DOM unreported (judged as `mutate`). frameact drains records at phase changes, so ending each mutate segment with `setPhase('measure')` would close the gap — decide together with the phase consumers (`applyCleanupDisposer`, the measure-dirtied warning).
8. A `flushSync()` from inside a `forceMeasure` window that was opened in that gap (outside a pass, so it is allowed) runs the nested pass under the forced `measure` phase: its mutate-phase applies would be reported. Rare; resetting `forcedPhase` on a phase change would fix it if it ever shows up.
