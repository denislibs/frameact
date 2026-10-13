# frameact — guide for writing apps (for LLMs and humans)

frameact is a fine-grained signals UI framework in the style of SolidJS (no virtual DOM; a component function runs
once; only the bindings that read a changed signal update) with the frame discipline of teact (Telegram Web A):
all reactive work and every DOM write is batched into **one `requestAnimationFrame` pass** with the phases
`measure → mutate → forced-reflow`, so layout reads never interleave with DOM writes. It targets messenger-class
clients: long lists, high-frequency store updates, heavy animations.

Status: early development, not on npm yet (`private`, MIT, exports are `.ts` sources: your Vite build compiles them).
Every name below exists in the repository at <https://github.com/denislibs/frameact>. Entry points:

| Import | What |
|---|---|
| `frameact` | signals, memos, effects (two-phase), context, frame/phase API, heavy-animation scopes, `flushSync`, lifecycle primitives |
| `frameact/dom` | `render`, `For`, `Show`, `Switch`/`Match`, `Dynamic`, `Portal`, `HeavyAnimationScope`, `children`, `mergeProps`/`splitProps`, `lazy`, class/style helpers, controlled-input helpers, `defineDirective` |
| `frameact/store` | `createStore`, `merge`, `produce`, `reconcile`, `unwrap`/`snapshot`, `keys`/`values`/`entries`, `live`, `ungated`, `defineActions`, `afterActions` |
| `frameact/stricterdom` | DEV phase checker: `enableStrict`, `forceMeasure`, `forceMutation`, `suppressStrict`, `setHandler`, run profiler |
| `frameact/kit` | `Transition`, `ShowTransition`, `createShowTransition`, `createMediaTransition`, `InfiniteScroll`, `createScrollAnchor`, `waitForAnimationEnd` |
| `frameact/scheduler` | raw `requestMeasure`/`requestMutation`/…, `debounce`, `throttle`, `fastRaf`, `onTickEnd`, `onIdle` |
| `frameact/vite` | the Vite plugin (default export) |

## 1. Setup

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import frameact from 'frameact/vite';

export default defineConfig({ plugins: [frameact()] }); // dev flag follows Vite's mode; frameact({ dev: true }) forces it
```

```jsonc
// tsconfig.json (compilerOptions)
{ "jsx": "preserve", "jsxImportSource": "frameact", "moduleResolution": "Bundler" }
```

The plugin runs the Solid 2.0 JSX compiler pointed at `frameact/dom`. It handles `.jsx`/`.tsx` only; client-side DOM only
(no SSR). In dev it warns about a reactive `value=`/`checked=` on inputs, string `on*="…"` attributes and (with the kit) destructured props.

```tsx
import { createSignal } from 'frameact';
import { render } from 'frameact/dom';

function Counter(props: { start: number }) {
  const [n, setN] = createSignal(props.start);
  return <button onClick={() => setN((v) => v + 1)}>{n()}</button>;
}

const dispose = render(() => <Counter start={1} />, document.getElementById('app')!); // dispose() unmounts
```

## 2. The rules that matter most

1. **A component runs once.** The body is setup code, not a render function. Updates happen in bindings: `{n()}` in JSX is
   a binding; `const x = n()` in the body is a one-time read.
2. **Props are reactive getters: never destructure them.** `function Row({ title })` reads `title` once, at creation, and
   never updates. Write `props.title` where it is used (JSX, a memo, an effect's compute). Forward a subset with
   `splitProps(props, ['a', 'b'])` or `mergeProps`.
3. **Read signals where you want updates.** Reading in JSX, `createMemo`, or an effect's `compute` tracks; reading in an
   event handler or inside `untrack` does not.
4. **Side effects belong in an effect's `apply`, not in its `compute`.**
5. **Measure in measure, mutate in mutate** (section 5).
6. **Controlled inputs use `use:value` / `use:checked`** (section 8).

## 3. Signals, memos, effects

```tsx
import { createSignal, createMemo, createEffect, untrack, onCleanup, createRoot } from 'frameact';

const [count, setCount] = createSignal(0);          // [Accessor<number>, Setter<number>]
setCount(5);
setCount((c) => c + 1);                             // updater form
const [obj, setObj] = createSignal({ a: 1 }, { equals: false }); // equals: false = always notify; or (prev, next) => boolean

const double = createMemo(() => count() * 2);       // cached, lazy-pulled, re-runs only when count changes
const peeked = untrack(() => count());              // read without subscribing

// Effects have two halves: `compute` is tracked and pure, `apply` is untracked and performs the side effect.
createEffect(
  () => count(),                                    // compute: its return value is what apply receives
  (value, prev) => {                                // apply(value, prev): may return a cleanup
    document.title = `n = ${value} (was ${prev})`;
    return () => { /* runs before the next apply and on dispose */ };
  },
);

// Scopes: components and createRoot own what is created inside; onCleanup runs on dispose.
const stop = createRoot((dispose) => {
  const unsubscribe = () => {};
  onCleanup(unsubscribe);
  return dispose;
});
stop();

void [obj, setObj, double, peeked];
```

- A write is visible at once (`count()` right after `setCount(1)` is 1); only **effects** wait for their phase. There is
  no `batch()`: many writes make one effect run.
- Default `createEffect` runs in a microtask at the end of the tick (`tickEnd`): use it for logic with no DOM
  (analytics, network, store sync). Its first `apply` is scheduled, not synchronous.
- The phase is the scheduler. Pick the facade by what the `apply` does:

| Facade | `apply` runs | Use for |
|---|---|---|
| `createEffect(c, a)` | microtask (tickEnd) | logic without DOM |
| `createMeasureEffect(c, a)` | measure phase of the next rAF | reading layout |
| `createMutationEffect(c, a)` | mutate phase of the same frame; first apply synchronous at creation | writing the live DOM |
| `createEffect(c, a, frameForcedReflow)` | forced-reflow phase | read after a write in the same frame (FLIP) |
| `createIdleEffect(c, a)` | when the browser is idle and nothing animates | prefetch, caches |

- Do **not** call `onCleanup` inside an `apply` (DEV error): return the cleanup from `apply`. In the component body
  `onCleanup(fn)` / `onDestroy(fn)` run at disposal.
- `createSelector(source)` gives O(1) "is this row selected" bindings: `const isSel = createSelector(selectedId);` then
  `class={{ selected: !!isSel(id)() }}` (calling the returned function with a key gives an accessor; `!!` because it is typed `Boolean`).
- Context: `createContext(default)`, `<Ctx.Provider value={v}>…</Ctx.Provider>`, `useContext(Ctx)` in a component body;
  the value is a snapshot, pass an accessor for reactivity.
- Errors: `onError(handler)` in an owner catches errors thrown in its child computations; otherwise they are logged
  (`console.error`) and the rest of the graph keeps running.

## 4. Derived-value primitives

```tsx
import { createSignal, previous, currentOrPrev, frozenWhile } from 'frameact';

const [user, setUser] = createSignal<{ name: string } | undefined>({ name: 'Ann' });
const [closing, setClosing] = createSignal(false);

const prevUser = previous(user);                 // the value before the current one
const shownUser = currentOrPrev(user);           // last non-empty value: what a closing panel keeps showing
const heldUser = frozenWhile(user, closing);     // freezes while `closing()` is true
// Read these continuously (JSX or an effect): they are lazy memos and see only the values they are asked for.
void [prevUser, shownUser, heldUser, setUser, setClosing];
```

Lifecycle (use in a component body):

```tsx
import { onMount, onDestroy, requestMutation } from 'frameact';

function Panel() {
  let el!: HTMLDivElement;
  onMount(() => {                       // once, after attach, in the MEASURE phase: read layout, focus()
    const top = el.getBoundingClientRect().top;
    requestMutation(() => { el.style.top = `${top}px`; });  // a DOM write goes through the mutate phase
  });
  onDestroy(() => { /* once, at disposal; do not read layout here */ });
  return <div ref={el} />;
}
void Panel;
```

## 5. The frame: phases and scheduling

Order inside one rAF: `measure → mutate → forced-reflow measure → forced-reflow mutate`. Each phase drains its queue once.

- A signal written in a measure `apply` reaches mutation effects **in the same frame**. A signal written in the mutate
  phase reaches a measure effect only in the **next** frame (DEV warns).
- Reads of layout (`offsetHeight`, `getBoundingClientRect()`, `scrollTop` read, `focus()`, `getComputedStyle`) belong in
  `createMeasureEffect`, `onMount`, event handlers, or `requestMeasure`. Writes (including `el.scrollTop = …`) belong in
  `createMutationEffect` or `requestMutation`.

```tsx
import { createSignal, createMeasureEffect, createMutationEffect } from 'frameact';

function Spacer(props: { open: boolean }) {
  let panel!: HTMLDivElement;
  let spacer!: HTMLDivElement;
  const [height, setHeight] = createSignal(0);
  createMeasureEffect(() => props.open, () => { setHeight(panel.offsetHeight); });       // read
  createMutationEffect(() => height(), (h) => { spacer.style.height = `${h}px`; });      // write, same frame
  return <><div ref={panel} /><div ref={spacer} /></>;
}
void Spacer;
```

Imperative scheduling (also exported from `frameact/scheduler`): `requestMeasure(cb)`, `requestMutation(cb)`,
`requestNextMutation(cb)` (a mutation booked from a measure task), `requestForcedReflow(cb)` (a measure task that may return a
mutate function: "mutate → measure → mutate" inside one frame), `getPhase()`. `flushSync()` commits pending effects and frame
work synchronously; use it in tests and for imperative glue (View Transitions, an iOS back gesture). It is allowed from
event handlers, store actions and tickEnd effects, and **throws inside a frame pass**.

## 6. Control flow and components

```tsx
import { createSignal, createSelector } from 'frameact';
import { For, Show, Switch, Match, Dynamic, Portal, children, mergeProps, render } from 'frameact/dom';

interface Chat { id: string; title: string; unread: number }

function List(props: { chats: Chat[]; selectedId: string | undefined; onPick?: (id: string) => void }) {
  const isSelected = createSelector(() => props.selectedId);
  return (
    <ul>
      {/* keyed by reference (default): the callback runs once per item; `index` is an accessor */}
      <For each={props.chats} fallback={<li>No chats</li>}>
        {(chat, index) => (
          <li classList={{ selected: !!isSelected(chat.id)() }} onClick={() => props.onPick?.(chat.id)}>
            {index() + 1}. {chat.title}
          </li>
        )}
      </For>
    </ul>
  );
}

// Immutable server data: key by id so a replaced object updates its row instead of recreating it.
function Rows(props: { chats: Chat[] }) {
  return <For each={props.chats} keyed={(c) => c.id}>{(chat) => <li>{chat().title}</li>}</For>; // `chat` is an accessor in this mode
}

// keyed={false}: by index, `item` is an accessor and `index` a number.
// order="manual": the DOM order is NOT the list order (rows are positioned by CSS transforms of index()).
function ChatList(props: { chats: Chat[] }) {
  return (
    <For each={props.chats} keyed={(c) => c.id} order="manual" orderKey={(c) => c.unread}>
      {(chat, index) => <div style={{ transform: `translateY(${index() * 72}px)` }}>{chat().title}</div>}
    </For>
  );
}

function Box(props: { user?: { name: string }; kind: 'a' | 'b' | 'c'; children?: unknown }) {
  const [portalTarget] = createSignal(document.body);
  const kids = children(() => props.children); // resolve props.children once; kids() / kids.toArray()
  return (
    <div>
      <Show when={props.user} fallback={<span>anonymous</span>}>{(u) => <b>{u().name}</b>}</Show>
      <Show when={props.user} keyed>{(u) => <b>{u.name}</b>}</Show>
      <Switch fallback={<i>other</i>}>
        <Match when={props.kind === 'a'}>A</Match>
        <Match when={props.kind === 'b'}>B</Match>
      </Switch>
      <Dynamic component={props.kind === 'a' ? 'section' : 'article'}>{kids()}</Dynamic>
      <Portal mount={portalTarget()}><div class="modal">…</div></Portal>
    </div>
  );
}

const merged = mergeProps({ size: 1 }, { size: undefined, color: 'red' }); // later wins, undefined falls through
void [List, Rows, ChatList, Box, merged, render];
```

- `For`: default `keyed` is by reference; `keyed={false}` by index; `keyed={fn}` by key (for immutable data). `keyed`,
  `children` and `order` are read once; `each` and `fallback` are reactive. With `order="manual"` every row must be a single
  DOM node and `For` must be the sole content of its slot; kept rows are never moved, only a row whose `orderKey` changes
  moves (return a primitive).
- `Show`: a function child gets an accessor (`u().name`); with `keyed` it gets the value and the child is recreated when the
  identity changes. Reading the accessor after the condition turned falsy throws.
- `Dynamic`: a **string** `component` is a tag name and a trust boundary: it must come from your code, never from
  messages or bot payloads. Invalid names render nothing; `script` is created inert.
- `Portal`: events bubble to the logical position; the content is disposed with the Portal.
- `lazy(() => import('./Settings'), { placeholder })` (from `frameact/dom`) loads a component on first render; `X.preload()` ahead of time.
- A component is `(props) => JSX`. Use `createComponent` only in hand-written (non-JSX) code.

## 7. Elements, attributes, events

```tsx
import { createSignal } from 'frameact';
import { addExtraClass, setExtraStyles } from 'frameact/dom';

function Demo() {
  const [on, setOn] = createSignal(false);
  let el!: HTMLDivElement;
  return (
    <div
      ref={el}
      class={['base', { active: on() }, on() && 'extra']}   // string | array | { token: boolean }; diffed per token
      classList={{ highlighted: on() }}
      style={{ 'background-color': on() ? 'red' : undefined, '--gap': '4px', width: '10px' }} // kebab-case keys; numbers need units
      attr:data-state={on() ? 'on' : null}                  // attribute (null removes)
      bool:hidden={!on()}                                   // boolean attribute
      prop:scrollTop={0}                                    // property write
      onClick={(e) => { setOn(!on()); e.stopPropagation(); }}  // delegated on document; handlers are bound once
      on:pointerdown={(e) => console.log(e.pointerType)}    // native listener (non-delegated)
    >
      <button onClick={() => { addExtraClass(el, 'flash'); setExtraStyles(el, { height: '20px' }); }}>flash</button>
    </div>
  );
}
void Demo;
```

- Class and style writes are **diffed**, so imperative `addExtraClass` / `setExtraStyles` (teact API) survive updates.
  A string `style="…"` writes `cssText`; `setExtraStyles` declarations are re-applied on top of it.
- `className=` is not supported; use `class`. Event handler props are bound once: if a parent can swap the handler, call it
  through `(e) => props.onClick?.(e)`.
- **Security policy** (silent in production, `console.error` in DEV): attribute writes refuse `javascript:` / `vbscript:` URLs,
  non-media `data:` URLs, string `on*` handlers and `srcdoc=`. Not guarded (explicit sinks, keep their input under your
  control): `innerHTML=`, `prop:*`, the *keys* of a spread bag `{...bag}` (never spread server data onto an element or
  component), a string `<Dynamic component>`, `<script src>`. There is no `dangerouslySetInnerHTML`: render rich text as nodes.

### Controlled inputs

```tsx
import { createSignal } from 'frameact';
import { forceControlledValue } from 'frameact/dom';

function Composer(props: { onSend: (text: string) => void }) {
  const [text, setText] = createSignal('');
  let input!: HTMLInputElement;
  const send = () => {
    props.onSend(text());
    setText('');
    forceControlledValue(input); // push the new value through an active IME composition
  };
  return (
    <>
      <input ref={input} use:value={text} onInput={(e) => setText(e.currentTarget.value.trimStart())} />
      <input type="checkbox" use:checked={() => text().length > 0} />
      <button onClick={send}>Send</button>
    </>
  );
}
void Composer;
```

`use:value={accessor}` keeps caret and IME composition, and rolls the DOM back synchronously (before paint) if the
signal ignored an input event. Passing `value={text()}` is a plain property write, not controlled; the Vite plugin warns.
`use:value` also works on `<textarea>` and `<select>`; `use:checked` on checkboxes/radios. Custom directives:
`defineDirective('name', (el, value) => …)` then `<div use:name={…}>`.

## 8. Store (model B)

`frameact/store` is a tree of plain objects whose properties become signals lazily, on the first tracked read.
`state.chats[id].title` subscribes to exactly that leaf. `setState` writes the raw object **in place** and wakes only the
changed leaves: nothing is copied, identities (proxies, `For` rows) are kept. `state` is read-only (assignments throw).

```tsx
import { createStore, merge, produce, reconcile, unwrap, snapshot, keys, defineActions, afterActions, live, ungated } from 'frameact/store';
import { For } from 'frameact/dom';

interface Msg { id: number; text: string; reactions?: Record<string, number> }
interface State {
  chats: Record<string, { id: string; title: string; unread: number; draft?: string }>;
  messages: Record<string, Msg[]>;
}

const [state, setState] = createStore<State>({
  chats: { a: { id: 'a', title: 'Ann', unread: 0 } },
  messages: { a: [] },
});

setState('chats', 'a', 'unread', (n) => n + 1);                 // path write; the last argument: value | updater
setState('chats', 'a', 'title', 'Anna');
setState('chats', 'a', merge({ title: 'Ann', unread: 0 }));     // shallow merge (a plain object at a path REPLACES)
setState('chats', 'a', 'draft', undefined);                     // undefined deletes the key
setState('messages', 'a', reconcile([{ id: 1, text: 'hi' }]));  // immutable server data, matched by `id` (reconcile(v, { key: 'uid' }), key: null = by index)
setState('messages', 'a', produce((list) => { list.push({ id: 2, text: 'yo' }); }));  // draft mutations, valid only inside the callback
setState('chats', ['a'], 'unread', 0);                          // fan-out: an array of keys (or an item filter on arrays)

const raw = unwrap(state.chats);        // the raw object (hand to a worker; structuredClone(proxy) throws)
const copy = snapshot(state.chats);     // O(n) deep copy
const ids = keys(state.chats);          // fast key walk; also values() / entries()

export const actions = defineActions({
  markRead(id: string) { setState('chats', id, 'unread', 0); },
  async load(id: string) {
    const chunk: Msg[] = await Promise.resolve([{ id: 1, text: 'hi' }]);
    setState('messages', id, reconcile(chunk));
    afterActions(() => console.log('cascade done'));            // after the current action cascade
  },
});

export function Messages(props: { chatId: string }) {
  return <For each={state.messages[props.chatId]}>{(m) => <p>{m.text}</p>}</For>;  // an edited message wakes its row only
}
void [raw, copy, ids, live, ungated];
```

- Paths are typed up to 7 keys; deeper writes use `produce` at the 7th level. Write only from actions or event handlers,
  never from a render or a compute.
- Actions are plain typed functions. A call made while another action runs is **queued** (FIFO) and runs after it; an
  `async` action returns a `Promise<void>` that never rejects (errors are reported). Actions run untracked.
- Do not memoize by object identity: the same object is mutated in place, so `createMemo(() => selector(state))` (which
  tracks the leaves it reads) is right and identity-keyed caches go stale.
- `Object.keys(state)` works but `keys(state)` is much faster for big dictionaries. `Object.hasOwn` is not tracked; use `in`.
- Class instances, Dates, Maps and frozen objects are *values* (replaced whole, never wrapped). The key `__proto__` is
  dropped. `createStore`'s argument is owned and mutated by the store.
- Inside a subtree running a heavy animation (section 9) store-driven frame effects **park** until the animation ends; a
  local signal, `live(() => state.x)` (read) or `ungated(() => setState(…))` (write) bypasses that.

## 9. Heavy animations

```tsx
import { beginHeavyAnimation, createHeavyAnimationScope, provideHeavyAnimationScope, onFullyIdle, watchHeavyAnimation } from 'frameact';
import { HeavyAnimationScope } from 'frameact/dom';
import type { JSX } from 'frameact/jsx-runtime';

const end = beginHeavyAnimation(300, true);   // global: park all frame work for up to 300 ms (blocking); end() releases it early

function ChatColumn(props: { children?: JSX.Element }) {
  // only this subtree waits; the chat list elsewhere keeps updating
  const scope = createHeavyAnimationScope();
  provideHeavyAnimationScope(scope);          // every effect created below snapshots this scope
  watchHeavyAnimation(() => console.log('animating'), () => console.log('idle'), scope);
  const stop = scope.begin(300, true);        // duration ms, isBlocking
  onFullyIdle(() => stop());
  return <div>{props.children}</div>;
}

function Panel(props: { children?: JSX.Element }) {
  return <HeavyAnimationScope>{props.children}</HeavyAnimationScope>; // component form: a fresh child scope
}
void [end, ChatColumn, Panel];
```

While a scope is blocked its frame effects (measure, mutate, forced-reflow) are parked and released together in **one**
frame, measure first, when it ends. Raw `requestMeasure`/`requestMutation` and tickEnd effects are never parked. Scopes gate
*updates*, not creation: to postpone creating a heavy subtree use `deferUntilIdle(scope, () => <Heavy />, placeholder)` (from `frameact`).
`<Transition>` (kit) manages its own scope.

## 10. stricterdom (DEV)

```ts
import { enableStrict, forceMeasure, forceMutation, suppressStrict, setHandler, enableRunLog, getRunStats } from 'frameact/stricterdom';

if (import.meta.env.DEV) { // (types: /// <reference types="vite/client" />)
  enableStrict(); // layout read outside measure / live-DOM write outside mutate -> console.error naming the effect:
  // [frameact/stricterdom] Unexpected measurement `offsetHeight` in Message > MessageMeta > span.style:color [mutate]
  enableRunLog({ filter: 'ChatList' }); // why each effect ran; runs slower than 7 ms warn by themselves
}
// Escapes: forceMeasure(() => el.scrollTop) reads from the mutate phase; forceMutation(cb, nodes) writes from measure;
// suppressStrict(cb) mutes both for third-party code; setHandler(fn) replaces console.error (collect violations in tests).
// Mark an overlay with the attribute data-stricterdom-ignore and render violation text with textContent, never innerHTML.
void [forceMeasure, forceMutation, suppressStrict, setHandler, getRunStats];
```

Call `enableStrict()` from day one: every violation names the offending component and binding. All of it is a no-op in
production builds (`forceMeasure`/`forceMutation`/`suppressStrict` just call the callback). It is a linter, not a security boundary.

## 11. Kit (`frameact/kit`)

The thin UI layer a Telegram Web A–class client needs; class contracts follow telegram-tt (bring your own CSS).

```tsx
import { createSignal } from 'frameact';
import { For } from 'frameact/dom';
import { Transition, ShowTransition, InfiniteScroll, createShowTransition, createScrollAnchor, type TransitionSlide } from 'frameact/kit';

function Screens() {
  const [tab, setTab] = createSignal(0);
  // Render by slide.key: the outgoing slide keeps its own content while it slides out. JSX children would re-render it to the new content.
  return (
    <Transition activeKey={tab()} name="slide" shouldCleanup onStart={() => {}} onStop={() => {}}>
      {(slide: TransitionSlide) => <button onClick={() => setTab(slide.key + 1)}>screen {slide.key}</button>}
    </Transition>
  );
}

function Modal(props: { isOpen: boolean; user?: { name: string } }) {
  // <div class="opacity-transition fast shown open ..."> stays mounted while closing (state classes: shown/not-shown, open/not-open, closing)
  return <ShowTransition isOpen={props.isOpen}>{props.user?.name}</ShowTransition>;
}

function Popup(props: { isOpen: boolean }) {
  const t = createShowTransition({ isOpen: () => props.isOpen, closeDuration: 300 });
  return <>{t.shouldRender() && <div ref={t.ref}>popup</div>}</>;
}

function Feed(props: { items: { id: number }[]; loadMore: (dir: 'forwards' | 'backwards') => void }) {
  return (
    <InfiniteScroll items={props.items} itemSelector=".ListItem" onLoadMore={({ direction }) => props.loadMore(direction)}>
      <For each={props.items}>{(m) => <div class="ListItem">{m.id}</div>}</For>
    </InfiniteScroll>
  );
}

function Manual(props: { items: unknown[] }) {
  let box!: HTMLDivElement;
  // snapshot in measure, DOM in mutate, restore in forced-reflow: one frame
  const anchor = createScrollAnchor({ container: () => box, items: () => props.items });
  return <div ref={box} onScroll={() => { if (anchor.consumeRestored()) return; }} />;
}
void [Screens, Modal, Popup, Feed, Manual];
```

`Transition` props: `activeKey: number`, `name`, `direction`, `renderCount`, `shouldCleanup` (+ `cleanupExceptionKey`,
`cleanupOnlyKey`), `shouldRestoreHeight`, `isBlockingAnimation`, `scope`, `disableAnimation`, `slideClass`, `onStart`/`onStop`.
Primitives it builds on: `onMount`, `onDestroy`, `previous`/`currentOrPrev`/`frozenWhile`, `watchHeavyAnimation` (`frameact`),
`lazy`, `splitProps` (`frameact/dom`), `debounce`, `fastRaf`, `throttleWithTickEnd` (`frameact/scheduler`). Note `debounce(fn, ms)`
with defaults runs a single call once (leading); pass `shouldRunFirst = false` to run after the quiet period.

## 12. Common mistakes

| Mistake | Fix |
|---|---|
| `function Row({ title }) {…}` or `const { title } = props` | `function Row(props)` and read `props.title` where used; `splitProps(props, ['a'])` to forward |
| `const t = state.chats[id].title;` then `<b>{t}</b>` | read in JSX: `<b>{state.chats[id].title}</b>`, or wrap in `createMemo` |
| `if (x()) return <A/>; return <B/>;` in a component body | `<Show when={x()} fallback={<B/>}><A/></Show>`: the body runs once |
| `items().map((i) => <Row/>)` | `<For each={items()}>{(i) => <Row/>}</For>` |
| `<input value={text()} />` | `<input use:value={text} onInput={…} />` |
| DOM write or layout read in `compute`, or `onCleanup` inside an `apply` | do it in `apply` of the right phase; return the cleanup from `apply` |
| `el.scrollTop = n` / `el.getBoundingClientRect()` in the wrong phase | `requestMutation(() => …)` / `createMeasureEffect`, `onMount`, a handler; stricterdom names it |
| `style={{ backgroundColor: 'red', width: 10 }}` | kebab-case keys and units: `{ 'background-color': 'red', width: '10px' }` |
| `className="x"` | `class="x"` |
| `<button onClick={props.onClick}>` when the parent swaps the handler | `onClick={(e) => props.onClick?.(e)}` |
| `setState('chats', id, { title })` expecting a merge | a plain object REPLACES: `merge({ title })` |
| `setState(…)` from a compute/render, or mutating `state` directly | write in actions / handlers through `setState` |
| `createMemo(() => memoizeByIdentity(state.chats))` | memo over leaf reads: `createMemo(() => selector(state))` |
| `<Dynamic component={message.tag} />` / spreading server objects `{...payload}` | tag names and prop keys come from your code only |
| `flushSync()` inside an effect `apply` of a frame phase | only from handlers, actions, tickEnd effects, tests |
| Transition children as JSX, expecting the old slide to keep old content | use the render function and render by `slide.key` |
| Reading `previous(x)` once | read it every pass (JSX/effect): it is a lazy memo |

## 13. Testing app code

```ts
import { createSignal, flushSync } from 'frameact';
import { render } from 'frameact/dom';

it('updates a binding', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const [n, setN] = createSignal(0);
  const dispose = render(() => <b>{n()}</b>, host);
  setN(1);
  flushSync();                 // commit pending effects and the frame synchronously
  expect(host.textContent).toBe('1');
  dispose();
});
```

Use vitest + jsdom and the same Vite plugin (`plugins: [frameact({ dev: true })]`) so `.tsx` test files compile. Never `expect`
inside an effect `apply`: record into an array and assert after `flushSync()`.
