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
- **stricterdom** — a dev mode that catches phase violations at the DOM-API level and names the offending effect
  (`Message > MessageMeta > span.style:color [mutate]`).

> **Status: early development.** The reactive core ([PR #1](https://github.com/denislibs/frameact/pull/1)) and
> the DOM runtime are implemented: `frameact/dom` for the Solid 2.0 JSX compiler
> (`@solidjs/babel-plugin@2.0.0-rc.14`), `render`, `For` (including `order="manual"`),
> `Show`/`Switch`/`Match`/`Dynamic`/`Portal`, controlled inputs (`use:value` / `use:checked`),
> `HeavyAnimationScope`, a context `Provider` and the `frameact/vite` plugin; the store (`frameact/store`,
> a signal tree with cause-tagged parking during heavy animations) is in, and so is stricterdom (`frameact/stricterdom`:
> DEV phase checks with effect attribution, a run profiler). Next: the benchmark. Not published to npm yet. APIs may change.

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
| Phase-violation checks | stricterdom | no | stricterdom + effect attribution |

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
- `frameForcedReflow` for the rare "mutate → measure → mutate" (FLIP) case, still inside one frame;
- `flushSync()` commits the frame synchronously when the current task must see the DOM (an iOS swipe-back gesture, a View
  Transition callback): allowed from event handlers, store actions and tickEnd effects; inside a frame pass it throws.

Heavy animations:

```ts
import { beginHeavyAnimation, createHeavyAnimationScope, provideHeavyAnimationScope } from 'frameact';

const end = beginHeavyAnimation(300, /* isBlocking */ true); // park all frame work for up to 300 ms
// …or only for a subtree: the chat list keeps updating while the chat column slides in
const scope = createHeavyAnimationScope();
provideHeavyAnimationScope(scope);
scope.begin(300, true);
```

Components are written in plain Solid style — they run once, props are getters — and compiled by
Solid 2.0's JSX compiler pointed at frameact's runtime (`moduleName: "frameact/dom"`):

```ts
// vite.config.ts
import frameact from 'frameact/vite';
export default { plugins: [frameact()] };
// tsconfig.json: "jsx": "preserve", "jsxImportSource": "frameact"
```

```tsx
import { createSignal } from 'frameact';
import { render } from 'frameact/dom';

function Composer() {
  const [text, setText] = createSignal('');
  return <input use:value={text} onInput={(e) => setText(e.currentTarget.value.trimStart())} />;
}
render(() => <Composer />, document.getElementById('app')!);
```

`class=` / `classList=` / spreads diff class tokens, so imperative `addExtraClass` survives updates; a string
`style=` writes `cssText`, after which the declarations set with `setExtraStyles` are re-applied on top. Controlled inputs are `use:value` /
`use:checked` — a reactive `value=` is written as a property, and the Vite plugin warns about it in dev. To push
a value through an active IME composition (e.g. clearing the field on Send), update the signal first, then call
`forceControlledValue(el)` from the user event handler (`isForcingControlledValue` detects the forced cycle in your
`blur`/`focus` handlers).

**Security.** Attribute writes refuse `javascript:` / `vbscript:` URLs, non-media `data:` URLs, string `on*`
handlers and `srcdoc=`; the explicit escape hatch for trusted HTML is `prop:srcdoc`. Refusals are silent in
production and a `console.error` in DEV.

**Trust boundary: `<Dynamic component="…">`.** A string `component` is a tag name, and a tag name is a key, not a
value, so the attribute policy cannot help: `style`, `base`, `meta`, `link`, `iframe`, `object` and `embed` are all
reachable by name. It must come from the author, never from content (messages, bot markup). The name is validated
(`/^[a-zA-Z][a-zA-Z0-9-]*$/`, anything else renders nothing and logs a DEV error) and `script` is created inert
(cloned from a parsed template, so its text never runs); the rest of the allow-list is yours.

**Outside the policy.** The policy guards attribute *values*. These are explicit sinks or key choices and are not
checked: `innerHTML=`, `prop:*` (including a compiled `prop:href` or `prop:srcdoc`), `setProperty`, the *keys* of a
spread bag (`{...bag}` can name `innerHTML`, `prop:*`, `use:*`), a string `component` of `<Dynamic>`, and
`<script src>` with an untrusted URL (the scheme filter cannot help there; a CSP `script-src` does). Keep their
inputs under your control. `<iframe srcdoc=…>` is refused and not typed; write `prop:srcdoc` to opt in.

## Store

`frameact/store` is a tree of plain objects whose properties become signals lazily, on their first tracked read.
`state.chats[id].title` subscribes to exactly that path; `setState('chats', id, 'title', t)` writes the raw object in
place and wakes that leaf only — one row out of a thousand recomputes, nothing is copied, identities (proxies, `For`
rows) are kept. Server data merges by key with `reconcile`, drafts mutate through `produce`, shallow merges are
explicit (`merge()`), a value at a path replaces, `undefined` deletes the key. Actions are plain typed functions
(`defineActions`); a nested call runs after the current one, `afterActions(cb)` after the cascade.
To walk a big dictionary use `keys(obj)` / `values(obj)` / `entries(obj)` from `frameact/store` (plain-object speed,
one subscription); `Object.keys` over a store proxy works but is 20x slower.

Store-driven frame effects inside a subtree that runs a heavy animation are *parked* by cause: an effect waits only
while store writes are the sole reason it is dirty. A local signal or a `live()` read runs it at once, and it reads the current store.
An event handler that writes the store leaves the effect parked (the handler itself and imperative reads see the
current state; the view catches up when the animation ends) — no computation ever sees two moments of the store. tickEnd logic is never parked,
controlled inputs (`use:value` / `use:checked`) never wait, `ungated(() => setState(…))` bypasses the gate on write.

```ts
const [state, setState] = createStore(INITIAL_STATE);
setState('chats', id, 'unread', (n) => n + 1);
setState('messages', chatId, reconcile(chunk)); // immutable data from the server, matched by `id`
<For each={state.messages[chatId]}>{(m) => <Message m={m} />}</For>
```

## Kit

`frameact/kit` is the thin UI layer a Telegram Web A–class client needs before its main screens, on the
same class contracts as telegram-tt (bring its stylesheets): `<Transition>` (keyed slides, the previous
slide kept alive, cleanup policies, a heavy-animation scope per subtree, `animationend` read in the event
and applied in the mutate phase), `createShowTransition` / `<ShowTransition>` / `createMediaTransition`,
`<InfiniteScroll>` and `createScrollAnchor` (the anchor is snapshotted in the measure phase, the list
updates in the mutate phase, the scroll position is restored in the forced-reflow phase — one frame, also
when released from a heavy animation). The primitives it builds on live in the core: `onMount`, `onDestroy`,
`previous` / `currentOrPrev` / `frozenWhile`, `watchHeavyAnimation` (`frameact`), `lazy`, `splitProps`
(`frameact/dom`), `debounce` / `fastRaf` / `throttleWithTickEnd` (`frameact/scheduler`). The Vite plugin
warns on destructured props, and `setExtraStyles` survives string `style=` writes, as in teact.
Porting guide: [`docs/guides/porting-from-teact.md`](docs/guides/porting-from-teact.md).

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
`setHandler(fn)` replaces `console.error`. A throw from the handler reaches the code that read layout, but mutation
violations are reported at phase boundaries and after applies, where a throw is caught and logged: to fail a test on them,
collect the errors in the handler and assert (or fail on `console.error`). Mutation records are judged at every phase change
and around every effect apply, so `flushSync()` never produces a false positive and the report names the effect that made
the write.

A violation's `message` and `path` are plain text that may contain content-derived strings (the element's `id` and
`class` are quoted and cut to 64 characters, store keys too): a dev overlay must render them with `textContent`, never
`innerHTML`, and mount itself under `data-stricterdom-ignore` (the handler's own reads and writes are never reported, but
the overlay's later updates would be). stricterdom is a development linter, not a security boundary.

The same switch turns on the DEV profiler: a run slower than 7 ms warns with its path (`Slow effect run: 12.3 ms in
Message > span.children [mutate]`), so does a frame phase (`Slow mutate drain: 18.0 ms, 240 effect runs; slowest: …`),
`getRunStats()` counts runs per path, and `enableRunLog({ filter })` prints why each effect ran:
`run #3 ChatList > li.class [mutate] ← signal "store.title" via memo "chatTitle" in ChatList`. All of it is dead code in
production builds (`process.env.NODE_ENV === 'production'`): `enableStrict`, `setHandler` and the run-log functions become
no-ops, `forceMeasure`, `forceMutation` and `suppressStrict` just call `cb()`.

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
- **[alien-signals](https://github.com/stackblitz/alien-signals)** by Johnson Chu (StackBlitz) — the core's
  dependency graph is reworked after its design: one `Link` object per edge in two doubly-linked lists, link reuse
  on re-runs, iterative propagation and shallow marking. This made frameact's core 1.5–2× faster on
  js-reactivity-benchmark.
- **[SolidJS](https://github.com/solidjs/solid)** and **[dom-expressions](https://github.com/ryansolid/dom-expressions)**
  by Ryan Carniato — the component model, the JSX compiler and the DOM runtime design.

Third-party code is MIT-licensed (udomdiff: ISC) and attributed in each adapted file. The compiler fixtures in
`test/dom/fixtures` are vendored verbatim from solidjs/solid and carry a `SOURCE` file instead of per-file headers.

## Roadmap

| Plan | Scope | Status |
|---|---|---|
| 1 · core | signals, two-phase effects, frame queues, heavy-animation gating, `mapArray`, context | ✅ done — [PR #1](https://github.com/denislibs/frameact/pull/1) |
| 2 · dom | runtime for the JSX compiler, `For`/`Show`/`Switch`, controlled inputs, manual-order lists, Vite plugin | ✅ done |
| 3 · store | signal tree store: per-leaf subscriptions, in-place path writes, `reconcile`, cause-tagged parking during animations, typed actions | ✅ done |
| 4 · stricterdom | dev-mode phase checks with effect attribution, run profiler, `flushSync` production contract | ✅ done |
| 5 · benchmark | teact vs Solid 2.0 vs frameact on messenger scenarios (Chromium + WebKit, CPU ×4) | ⏳ |
| 6 · kit | client-readiness kit: `Transition`, `ShowTransition`, `InfiniteScroll` + scroll anchoring, `onMount`/`onDestroy`, `lazy`, `splitProps`, props-destructuring lint, porting guide | ✅ done |

Design: [`docs/superpowers/specs/2026-10-11-frameact-design.md`](docs/superpowers/specs/2026-10-11-frameact-design.md)
(in Russian) · plans: [`docs/superpowers/plans/`](docs/superpowers/plans/).

## Development

Requires Node ≥ 22.12 and pnpm.

```bash
pnpm install
pnpm check     # oxlint + TypeScript 7 (tsc) + vitest
pnpm test:chrome  # stricterdom in headless Chrome (real layout, real observer timing); needs Google Chrome
```

Toolchain: TypeScript 7 (native), Vite 8 / Vitest 5 + jsdom, oxlint.

**For AI assistants.** Contributing to frameact: [`AGENTS.md`](AGENTS.md). Writing an app with it: [`llms.txt`](llms.txt) and [`docs/llms-full.md`](docs/llms-full.md).

## License

[MIT](LICENSE). Vendored and adapted third-party code (maverick-js/signals, teact, dom-expressions, solidjs/solid — web client
parts and the compiler fixtures) is also MIT, udomdiff is ISC — see [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
