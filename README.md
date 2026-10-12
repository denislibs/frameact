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

> **Status: early development.** The reactive core ([PR #1](https://github.com/denislibs/frameact/pull/1)) and
> the DOM runtime are implemented: `frameact/dom` for the Solid 2.0 JSX compiler
> (`@solidjs/babel-plugin@2.0.0-rc.14`), `render`, `For` (including `order="manual"`),
> `Show`/`Switch`/`Match`/`Dynamic`/`Portal`, controlled inputs (`use:value` / `use:checked`),
> `HeavyAnimationScope`, a context `Provider` and the `frameact/vite` plugin; the store (`frameact/store`,
> a signal tree with cause-tagged parking during heavy animations) is in. Next: stricterdom. Not published
> to npm yet. APIs may change.

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
`style=` writes `cssText` and is incompatible with `setExtraStyles`. Controlled inputs are `use:value` /
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

Third-party code is MIT-licensed (udomdiff: ISC) and attributed in each adapted file. The compiler fixtures in
`test/dom/fixtures` are vendored verbatim from solidjs/solid and carry a `SOURCE` file instead of per-file headers.

## Roadmap

| Plan | Scope | Status |
|---|---|---|
| 1 · core | signals, two-phase effects, frame queues, heavy-animation gating, `mapArray`, context | ✅ done — [PR #1](https://github.com/denislibs/frameact/pull/1) |
| 2 · dom | runtime for the JSX compiler, `For`/`Show`/`Switch`, controlled inputs, manual-order lists, Vite plugin | ✅ done |
| 3 · store | signal tree store: per-leaf subscriptions, in-place path writes, `reconcile`, cause-tagged parking during animations, typed actions | ✅ done |
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

[MIT](LICENSE). Vendored and adapted third-party code (maverick-js/signals, teact, dom-expressions, solidjs/solid — web client
parts and the compiler fixtures) is also MIT, udomdiff is ISC — see [`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md).
