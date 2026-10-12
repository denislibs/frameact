# Porting a teact client to frameact

A working guide for a team coming from telegram-tt (teact + fasterdom + TeactN) to frameact. It covers
the three things that change: **a component runs once** (hooks become primitives), **effects have two
halves and a phase**, and **the store is a tree of signals written in place** (model B, spec §3.5).
The API named here is `frameact`, `frameact/dom`, `frameact/store`, `frameact/scheduler` and the
client-readiness kit `frameact/kit` (plan 6). `frameact/stricterdom` (`enableStrict`, `forceMeasure`,
`forceMutation`, `suppressStrict`, `setHandler`) is plan 4; call it from day one, it is a no-op until then.

## 1. Hooks → primitives

| teact / telegram-tt | frameact | Notes |
|---|---|---|
| `useState` | `createSignal` | The write is visible at once (`get()` after `set()`), only effects wait for their phase. |
| `useSignal`, `useDerivedSignal`, `useDerivedState`, `useSignalEffect`, `useStateRef` | `createSignal` / `createMemo` / `createEffect` | The most direct bridge: signal code ports almost verbatim. |
| `useEffect(fn, deps)` (measure phase of the next frame) | `createEffect(compute, apply)` for logic (tickEnd); `createMeasureEffect` to read layout | Split by purpose. `compute` is tracked and pure; `apply(value, prev)` is the side effect and may return a cleanup. |
| `useLayoutEffect` | `createMutationEffect` | Writes the live DOM in the mutate phase; the first apply is synchronous at creation (detached nodes). |
| `useEffect(fn, [])`, `useLayoutEffect(fn, [])` | **`onMount(fn)`** | Runs once, after attach, in the measure phase (real layout; `focus()`, `scrollTop`). May return a cleanup. |
| unmount cleanup (`useEffect(() => () => …, [])`, `useUnmountCleanup`) | **`onDestroy(fn)`** | Runs once when the component is disposed. Inside an effect/memo compute use `onCleanup` (runs per re-run; DEV warns). |
| `useEffectWithPrevDeps`, `useLayoutEffectWithPrevDeps` | `apply(value, prev)` | `prev` is what the last apply received. |
| `useSyncEffect` (during render) | `createMemo` for derived state; `createMeasureEffect` for a snapshot *before* a DOM update | There is no synchronous effect; a measure effect on the same signal runs before the mutate phase of the same frame (see §4). |
| `useMemo`, `useCallback`, `useLastCallback`, `memo`, `useForceUpdate` | `createMemo`; plain functions | A component body runs once, so a handler closes over accessors and is never stale. |
| `useRef`, `ref={}` | `let el: HTMLDivElement; <div ref={el}>` or a callback ref | A ref is assigned at element creation (detached). |
| `usePrevious`, `useCurrentOrPrev`, `useFrozenProps`, `usePrevDuringAnimation` | **`previous`, `currentOrPrev`, `frozenWhile`** | Memos over a source's history. Read them continuously (JSX, an effect): a memo is lazy and only sees the values it is asked for. |
| `useHeavyAnimation`, `useThrottleForHeavyAnimation` | **`watchHeavyAnimation(onStart, onEnd, scope?)`**, `onFullyIdle` | Unsubscribes with the owner; `scope` defaults to the subtree's scope, not the root. |
| `useMountAfterHeavyAnimation`, `isReady` | `deferUntilIdle(scope, () => <Heavy/>, placeholder)` | The creation gate; scopes gate updates. |
| `useModuleLoader` + `*.async.tsx` | **`lazy(() => import('./X'))`** (`frameact/dom`) | No Suspense: `placeholder` until loaded, `X.preload()` ahead of time. |
| `useShowTransition`, `useMediaTransition`, `<ShowTransition>` | **`createShowTransition`, `createMediaTransition`, `<ShowTransition>`** (`frameact/kit`) | Same classes (`shown/not-shown`, `open/not-open`, `closing`, `opacity-transition fast|slow`). |
| `<Transition activeKey name>` | **`<Transition>`** (`frameact/kit`) | Same class contracts, keep-alive, cleanup policies; `scope` per subtree; slides always wrapped. Not ported: `slideOptimized`, swipe control, `nextKey`. |
| `<InfiniteScroll>`, scroll anchoring in `MessageList` | **`<InfiniteScroll>`, `createScrollAnchor`** (`frameact/kit`) | Snapshot in measure, DOM in mutate, restore in forced reflow — one frame. |
| `debounce`, `throttle`, `fastRaf`, `throttleWithTickEnd`, `onTickEnd`, `onIdle` | the same names in `frameact/scheduler` | Prefer `requestMeasure`/`requestMutation` to `fastRaf` for DOM work. |
| `withGlobal(mapStateToProps)`, `useSelector` | read `state.chats[id].title` in JSX, or a selector function over the proxy | Per-leaf subscriptions; no containers, no storms. |
| `getGlobal()` in a handler | read the store proxy (untracked outside computations) or `unwrap(state)` | — |
| `setGlobal(newGlobal)` | `setState(path…, value)`, `merge()`, `produce`, `reconcile` | See §5. |
| `setGlobal(g, { forceOnHeavyAnimation })` | `ungated(() => setState(…))` | — |
| `getActions().x()`, `addActionHandler` | `defineActions({ x })`, `afterActions(cb)` | FIFO cascade; `afterActions` runs after it. |
| `key={id}` to remount one element | `<Show when={id()} keyed>{(id) => …}</Show>` | — |
| `teactFastList` + `teactOrderKey` | `<For order="manual" orderKey={…}>` | Zero DOM moves on reorder. |
| `teactExperimentControlled` | `use:value` / `use:checked` | Caret, IME, synchronous rollback before paint. |
| `className={buildClassName(…)}` | `class={[a, { b: cond }]}` | Token diff: imperative classes survive. `className=` on an element is a DEV error. |
| `style="…"` + `setExtraStyles` | the same | Extra styles are re-applied after every string `style=` write (plan 6). |
| `Portal` | `<Portal mount>` | Events bubble to the logical position. |

## 2. The traps (read these twice)

1. **Destructuring props.** `function Chat({ isOpen })` reads `isOpen` once, at creation; it never updates.
   Take `props` and read `props.isOpen` where it is used — in JSX, inside a memo, inside an effect's
   compute. The Vite plugin warns on `function X({`, `const X = ({`, and `const { a } = props` in dev.
   To forward a subset use `splitProps(props, ['a', 'b'])` (lazy getters) or `mergeProps`.
2. **Reading a prop or a signal early.** `const open = props.isOpen;` at the top of the component is the same
   trap without braces. So is `const chat = state.chats[id]` followed by `chat.title` in JSX — that one is
   fine (the proxy is read lazily), but `const title = state.chats[id].title` is a one-time read.
3. **Handler props are bound once.** `<button onClick={props.onClick}>` attaches the function it sees at
   creation. If the parent can replace the handler, write `onClick={(e) => props.onClick?.(e)}`.
4. **No `useLastCallback`.** Delete it. A handler defined in the component body sees the current signal
   values because it calls accessors.
5. **Effects: side effects in `apply`, never in `compute`.** `createEffect(() => state.draft, (draft) => save(draft))`.
   A DOM write in `compute` runs in the wrong phase and under tracking.
6. **Measure in measure, mutate in mutate.** Layout reads (`getBoundingClientRect`, `offsetHeight`,
   `scrollTop` read, `focus()`) belong in `createMeasureEffect`, `onMount`, an event handler or a
   `requestMeasure` task; DOM writes in `createMutationEffect` or `requestMutation`. Need a read after a
   write in the same frame? `createEffect(c, a, frameForcedReflow)` or `requestForcedReflow`.
7. **`onCleanup` in an apply is a DEV error.** Return the cleanup from `apply` instead. In the component
   body, `onDestroy(fn)` (or `onCleanup`) runs at disposal, synchronously — a live-DOM write there (a class
   on `document.body`) goes through `requestMutation`.
8. **Identity memos go stale under in-place writes** (audit R2, see §5.3).

## 3. Component shape

```tsx
import { createMemo, createSignal, onDestroy, onMount } from 'frameact';
import { For, Show } from 'frameact/dom';
import { state, actions } from '../global';

export function ChatList(props: { folderId: number; onSelect?: (id: string) => void }) {
  const chats = createMemo(() => selectFolderChats(state, props.folderId)); // a selector over the proxy
  let list!: HTMLDivElement;
  onMount(() => {
    list.scrollTop = state.ui.chatListScroll;            // real layout, after attach
    return () => actions.saveChatListScroll(list.scrollTop); // runs on dispose
  });
  onDestroy(() => actions.chatListClosed());
  return (
    <div ref={list} class="ChatList">
      <For each={chats()} order="manual" orderKey={(c) => c.lastMessageDate}>
        {(chat) => <ChatRow chat={chat} onClick={() => props.onSelect?.(chat.id)} />}
      </For>
      <Show when={chats().length === 0}><Empty /></Show>
    </div>
  );
}
```

`ChatRow` receives a store proxy: `props.chat.title` subscribes to that leaf; a `setState('chats', id,
'title', t)` re-runs that one text binding.

## 4. The frame: phases and scroll anchoring

A frame runs **measure → mutate → forced reflow**; every phase drains its queue of effect runs once.
A signal written in a measure apply reaches a mutation effect in the same frame; one written in a
mutate apply reaches a measure effect only next frame (DEV warns). The idiom teact spells as
`useSyncEffect + forceMeasure` (snapshot) + `useLayoutEffect + requestForcedReflow` (restore) is:

```ts
createMeasureEffect(() => props.items, () => { top = anchor.getBoundingClientRect().top; });  // before the DOM update
createEffect(() => props.items, () => { setFix(scrollTop + (anchor.getBoundingClientRect().top - top)); }, frameForcedReflow); // after it
createMutationEffect(() => fix(), (v) => { if (v !== undefined) el.scrollTop = v; });        // forced-reflow mutate phase, same frame
```

That is `createScrollAnchor` in `frameact/kit`. Under a heavy animation all three park and are released
together, measure first (the store-gate release goes through a measure task for this — audit R1, fixed in the store's fix round).
Create the anchor under the same heavy-animation scope as its list. A store array is tracked by its shape, so
`produce`/`reconcile` writes in place are anchored too.

## 5. The store model (model B) for the client

### 5.1 Writes

- **A value at a path replaces**: `setState('chats', id, chat)`. **`merge()` merges** one level:
  `setState('chats', id, merge({ title, unreadCount }))`. **`undefined` deletes** the key:
  `setState('chats', id, undefined)`. Arrays: `produce((a) => a.splice(i, 1))`, never a hole.
- **Server chunks**: `setState('messages', chatId, reconcile(chunk))` — matched by `id`, rows keep
  their identity, only changed leaves notify. Use it for everything that arrives as immutable objects.
- **Drafts and multi-field updates**: `produce((draft) => { … })`.
- **Never write from a render**: writes belong in actions (`defineActions`) or event handlers.
  A nested action call is queued (FIFO), `afterActions(cb)` runs after the cascade.
- Reducers that return `{ ...global, … }` become path writes. Keep the *selectors* — pure functions over
  the proxy track themselves; put a derived array in a `createMemo`.

### 5.2 Reads

- In JSX and effects: read the proxy (`state.chats[id].title`). Each read is one leaf subscription.
- In handlers and actions: read the proxy too (untracked outside computations), or `unwrap(state.chats)`
  for a raw object to hand to a worker. `structuredClone(proxy)` throws — `snapshot()` (O(n)) or
  `unwrap` first.
- `byTabId`: keep tab state under `state.byTabId[tabId]`; a selector `selectTabState(state, tabId)` is a
  plain function, call it in JSX.
- Lists: `<For each={state.messages[chatId]}>` subscribes to the array's shape; an edited message wakes
  its row only.

### 5.3 Identity pitfalls (R2)

In teact, `global.chats.byId` is a new object after every change, so `useMemo(..., [chatsById])` and
`memoized(selector)` by argument identity are correct. In model B the **same object is mutated in
place**: an identity-keyed memo returns the stale result forever. Port every such memo to
`createMemo(() => …)` (it tracks the leaves it reads) and delete `util/memoized.ts`-style caches over
store objects. The same holds for `shallowEqual` guards: compare values, not references, or just let
the leaf subscriptions do their job.

### 5.4 Animations

Store-caused frame effects inside an animating scope park until the animation ends; local signals,
events, `live()` reads and `ungated()` writes do not wait. tickEnd logic is never parked. A
`<Transition>` creates a scope per subtree (pass `scope` to share one), so the chat list keeps
updating while the right column slides. View Transitions and the iOS back gesture: write through
`ungated(() => setState(…))` and commit with `flushSync()` (contract to be fixed in plan 4).

### 5.5 Cache and multitab

There is no change feed yet (follow-up: `onStoreWrite` / a patch journal). For a cache, serialise a
subset of `unwrap(state)` in `onFullyIdle` / `createIdleEffect`, throttled; the per-write
`addCallback` + `deepDiff` of tt is not expressible until the feed lands.

## 6. Idioms, short

- `isOpen && <X/>` → `<Show when={isOpen()}><X/></Show>`; keyed remount → `<Show when={id()} keyed>`.
- `lang('Key')` is reactive when `lang` reads the language signal; `withNodes` arrays replace whole:
  render rich text with `<For>` keyed by entity so `CustomEmoji`/lottie nodes survive text edits.
- `requestMeasure(() => el.focus())` in an action; in a component `onMount(() => el.focus())`.
- `beginHeavyAnimation(…, true)` freezes every frame queue globally; prefer a scope (`createHeavyAnimationScope`,
  `<HeavyAnimationScope>`, `<Transition scope>`) so only the moving subtree waits.
- `flushSync()` is for tests and imperative glue (View Transitions, iOS gesture) only.
