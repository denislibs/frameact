<p align="center">
  <img src="docs/assets/social-preview-b.png" alt="frameact — fine-grained signals, one commit per frame" width="100%">
</p>

<p align="center">
  <b>English</b> · <a href="README.ru.md">Русский</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

# frameact

**Fine-grained signals. One commit per frame.**

frameact is a reactive UI framework for apps where every frame counts — think a messenger with
thousand-message histories, a chat list that reorders under your thumb, and animations that must not
stutter on a mid-range phone. It combines **fine-grained signals** (no virtual DOM, components run once,
only bindings update) with the **frame discipline of [teact](https://github.com/Ajaxy/teact)**, the framework
behind Telegram Web A:

- **one pass per frame** — all reactive work and every DOM write is batched into a single `requestAnimationFrame`;
- **explicit phases** — `measure → mutate → forced-reflow measure → forced-reflow mutate`, so layout reads
  never interleave with DOM writes (no layout thrashing);
- **heavy-animation gating** — while a blocking animation runs, frame work is parked and released in one
  frame when it ends, globally or for just one subtree;
- **stricterdom** *(planned)* — a dev mode that catches phase violations at the DOM-API level and names the
  offending effect.

> **Status: early development.** The reactive core is implemented, reviewed and merged
> ([PR #1](https://github.com/denislibs/frameact/pull/1)); the DOM runtime and JSX compiler integration are
> next. Not published to npm yet. APIs may change.

## Why

Signal-based frameworks (Solid, Vue, Svelte 5, Preact Signals) flush effects in a microtask, and each effect
writes to the DOM as soon as it runs. When one effect reads layout and another writes, reads and writes
interleave and the browser is forced to recalculate layout again and again within a frame.

teact solves this for a virtual-DOM renderer with **fasterdom**: every DOM operation is either a
*measurement* or a *mutation*, and they are scheduled into separate phases of one animation frame.
frameact brings the same discipline to fine-grained reactivity — where an update is a single binding, not a
component re-render.

| | teact | Solid 1.x / 2.0 | frameact |
|---|---|---|---|
| Update model | VDOM diff, component re-render | fine-grained | fine-grained |
| When it flushes | rAF, one pass | microtask | rAF, one pass |
| measure / mutate phases | yes | no | yes |
| Heavy-animation gating | global | no | global + per subtree |
| Phase-violation checks | stricterdom | no | stricterdom + effect attribution *(planned)* |

## How it works

Effects are split in two: a tracked, pure **compute** and an untracked **apply** that performs the side
effect. *The phase is the scheduler* — you pick when the apply runs by picking the facade:

```ts
import {
  createSignal, createEffect, createMeasureEffect, createMutationEffect, createIdleEffect,
} from 'frameact';

const [height, setHeight] = createSignal(0);
const [expanded, setExpanded] = createSignal(false);

// measure phase: read layout
createMeasureEffect(() => expanded(), () => setHeight(panel.offsetHeight));

// mutate phase of the same frame: write the DOM
createMutationEffect(() => height(), (h) => { spacer.style.height = `${h}px`; });

// microtask: logic without DOM (network, store)
createEffect(() => expanded(), (open) => analytics.track('panel', { open }));

// when the browser is idle and nothing is animating
createIdleEffect(() => expanded(), () => prefetchDetails());
```

What the frame guarantees:

- N effects dirtied by one write → **one** rAF, one task per phase;
- a signal written in a measure apply reaches mutation effects **in the same frame**;
- writes made while computing in the mutate phase (e.g. a keyed list updating its rows) land **in the same drain**;
- a measure effect dirtied from the mutate phase runs next frame (and warns in dev);
- `frameForcedReflow` for the rare "mutate → measure → mutate" (FLIP) case, still inside one frame.

Heavy animations:

```ts
import { beginHeavyAnimation, createHeavyAnimationScope, provideHeavyAnimationScope } from 'frameact';

const end = beginHeavyAnimation(300, /* isBlocking */ true); // park all frame work for up to 300 ms
// …or only for a subtree: the chat list keeps updating while the chat column slides in
const scope = createHeavyAnimationScope();
provideHeavyAnimationScope(scope);
scope.begin(300, true);
```

Components will be written in plain Solid style — they run once, props are getters — and compiled by
Solid 2.0's JSX compiler pointed at frameact's runtime.

## Inspiration and credits

- **[teact](https://github.com/Ajaxy/teact)** by Alexander Zinchuk — the frame discipline, fasterdom,
  stricterdom and heavy-animation gating come from here. teact powers Telegram Web A (Telegram Air) and
  MyTonWallet. Read the article that explains the idea:
  **[Fasterdom: Optimized Browser Rendering](https://ajaxy.github.io/teact/Fasterdom-Optimized-Browser-Rendering/)**
  — why measuring right after mutating forces a reflow, and how `requestMeasure`, `requestMutation`,
  `requestNextMutation` and `requestForcedReflow` split a frame into phases.
- **[Telegram Web A](https://github.com/Ajaxy/telegram-tt)** — the reference workload: long lists, CSS-transform
  reordering, heavy transitions, input latency on mobile.
- **[maverick-js/signals](https://github.com/maverick-js/signals)** by Rahim Alwer — the reactive graph
  (vendored and patched), itself built on the Reactively algorithm.
- **[SolidJS](https://github.com/solidjs/solid)** and **[dom-expressions](https://github.com/ryansolid/dom-expressions)**
  by Ryan Carniato — the component model, the JSX compiler and the DOM runtime design.

Third-party code is MIT-licensed and attributed in each adapted file.

## Roadmap

| Plan | Scope | Status |
|---|---|---|
| 1 · core | signals, two-phase effects, frame queues, heavy-animation gating, `mapArray`, context | ✅ done — [PR #1](https://github.com/denislibs/frameact/pull/1) |
| 2 · dom | runtime for the JSX compiler, `For`/`Show`/`Switch`, controlled inputs, manual-order lists, Vite plugin | 🛠 planning |
| 3 · store | global store in the style of TeactN (`withGlobal`, action handlers) with animation-aware propagation | ⏳ |
| 4 · stricterdom | dev-mode phase checks with effect attribution | ⏳ |
| 5 · benchmark | teact vs Solid 2.0 vs frameact on messenger scenarios (Chromium + WebKit, CPU ×4) | ⏳ |

Design: [`docs/superpowers/specs/2026-10-11-frameact-design.md`](docs/superpowers/specs/2026-10-11-frameact-design.md)
(in Russian) · plans: [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Development

Requires Node ≥ 22.12 and pnpm.

```bash
pnpm install
pnpm check     # oxlint + TypeScript 7 (tsc) + vitest
```

Toolchain: TypeScript 7 (native), Vite 8 / Vitest 5 + jsdom, oxlint.

## License

frameact's own license is not chosen yet. Vendored and adapted third-party code (maverick-js/signals, teact,
dom-expressions) is MIT — see [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
