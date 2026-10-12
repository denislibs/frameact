// Scroll anchoring across a list update (telegram-tt `InfiniteScroll`'s "restore scrollTop after
// adding items", `MessageList`'s useSyncEffect + forceMeasure snapshot), phase-correct on frameact:
//   1. a MEASURE effect on `items` runs in the frame the list changes, before the mutate drain updates
//      the DOM: it snapshots the anchor item and its position (the "before");
//   2. a FORCED-REFLOW effect on the same `items` runs after the mutate drain of that frame: it reads
//      the anchor's new position and writes the corrected scrollTop through a signal, which a mutation
//      effect applies in the forced-reflow mutate phase of the SAME frame (no flash of the wrong offset).
// A restore only acts on a snapshot taken for the SAME change (a change written in the mutate phase has
// no snapshot in its frame: the anchor only re-bases its position then).
// Under heavy-animation parking the three effects park together and are released in one frame in
// phase order (the store-gate release goes through a measure task — audit R1): create the anchor under
// the same heavy-animation scope as the list it anchors, so that they park and release together.
import { createEffect, createMeasureEffect, createMemo, createMutationEffect, createSignal, frameForcedReflow, untrack, type Accessor } from '../index';
import { SHAPE, TRACK } from '../core/symbols';

/**
 * What a list change is detected by: a store array (model B: `produce`/`reconcile` rewrite it in
 * place, its identity never changes) through its shape — `[$TRACK]` subscribes to the shape only and
 * returns a fresh plain array per change — anything else by its own identity.
 */
export function trackItems(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const shape = (value as { [TRACK]?: unknown })[TRACK];
    if (shape !== undefined) return shape;
  }
  return value;
}

/**
 * Subscribe to a list's changes without reading its items: a store array through its shape version
 * (`Symbol.for('frameact.shape')`: one link, a number, no copy — `trackItems` builds a fresh O(n) array
 * on every read), anything else by its own identity (the value itself). The result is only for
 * subscribing: a store array's version can repeat across two different arrays, so detect "changed"
 * with `createItemsVersion`, not by comparing results.
 */
export function trackShape(value: unknown): unknown {
  if (value !== null && typeof value === 'object') {
    const version = (value as { [SHAPE]?: unknown })[SHAPE];
    if (version !== undefined) return version;
  }
  return value;
}

/**
 * A memo that yields a new number for every change of the list `items()` returns (a new value, or a
 * shape change of a store array in place), in O(1) per change. Effects over it run once per change.
 */
export function createItemsVersion(items: Accessor<unknown>): Accessor<number> {
  let version = 0;
  return createMemo(() => {
    trackShape(items());
    return ++version;
  });
}

export interface ScrollAnchorOptions {
  /** The element whose `scrollTop` is kept (and, unless `list` is given, the one holding the items). */
  container: Accessor<HTMLElement | null | undefined>;
  /** The element holding the items when it is not the scroll container (a nested list). */
  list?: Accessor<HTMLElement | null | undefined>;
  /** Tracked: every change snapshots before and restores after the DOM update (a store array by its shape). */
  items: Accessor<unknown>;
  /** Default `.ListItem`. */
  itemSelector?: string;
  /** Skip the restore (frequently re-ordered lists). */
  noScrollRestore?: Accessor<boolean | undefined>;
  /** Skip the restore while the container is scrolled to the top (a chat list: new chats push the rest down). */
  noScrollRestoreOnTop?: Accessor<boolean | undefined>;
}

export interface ScrollAnchor {
  /** The item the position is kept relative to (the first item, until `track` chose another). */
  anchor: () => HTMLElement | undefined;
  /** The anchor's remembered `getBoundingClientRect().top`. */
  anchorTop: () => number;
  /** From a scroll handler: make `el` the anchor and remember its position (`top` = its `getBoundingClientRect().top`). */
  track(el: HTMLElement | undefined, top?: number): void;
  /** The item elements, listed on first use after each change and cached until the next one (cheap in scroll handlers). */
  items(): HTMLElement[];
  /** True once, right after a restore wrote `scrollTop`: the scroll event it causes is not the user's. */
  consumeRestored(): boolean;
}

const DEFAULT_ITEM_SELECTOR = '.ListItem';

export function createScrollAnchor(options: ScrollAnchorOptions): ScrollAnchor {
  const { container, items, noScrollRestore, noScrollRestoreOnTop } = options;
  const list = options.list ?? container;
  const selector = options.itemSelector ?? DEFAULT_ITEM_SELECTOR;
  let anchor: HTMLElement | undefined;
  let anchorTop = 0;
  let elements: HTMLElement[] = [];
  let restored = false;
  const [scrollTopFix, setScrollTopFix] = createSignal<{ top: number } | undefined>(undefined);

  // The list of item elements is built on demand (`items()`, from a scroll handler), once per change:
  // the snapshot and the restore only need the anchor, and a `querySelectorAll` over a long list costs
  // ~100 µs per 1000 rows each.
  let elementsStale = true;

  function firstItem(): HTMLElement | undefined {
    return untrack(list)?.querySelector<HTMLElement>(selector) ?? undefined;
  }

  /** The anchor is still one of the list's items. */
  function isAlive(el: HTMLElement | undefined): el is HTMLElement {
    return el !== undefined && el.isConnected && untrack(list)?.contains(el) === true;
  }

  // One number per change of the list (identity, or shape of a store array), shared by the effects below.
  const tracked = createItemsVersion(items);
  // The change the last snapshot was taken for. A restore is only valid against a snapshot of ITS change:
  // when the items are written in the mutate phase (an `onStop` run from a mutation task, a store write
  // from a mutation apply) the measure effect cannot run in that frame (it moves to the next), and
  // `anchorTop` is the position from some earlier change, with the user's scrolling in between.
  let snapshotOf = 0;

  // 1. Before the update (measure phase of the frame the items change).
  createMeasureEffect(
    tracked,
    (change) => {
      snapshotOf = change;
      elementsStale = true;
      if (!isAlive(anchor)) anchor = firstItem();
      if (anchor) anchorTop = anchor.getBoundingClientRect().top;
    },
    { name: 'scrollAnchor.snapshot' },
  );

  // 2. After the update (forced-reflow phase of the same frame).
  createEffect(
    tracked,
    (change) => {
      elementsStale = true;
      const el = untrack(container);
      if (!el) return;
      const current = anchor;
      if (isAlive(current)) {
        const newTop = current.getBoundingClientRect().top;
        const delta = snapshotOf === change ? newTop - anchorTop : 0; // no snapshot for this change: re-base only
        anchorTop = newTop;
        if (delta !== 0 && !untrack(() => noScrollRestore?.()) && !(untrack(() => noScrollRestoreOnTop?.()) && el.scrollTop === 0)) {
          setScrollTopFix({ top: el.scrollTop + delta });
          anchorTop -= delta; // after the write the anchor is back where it was
        }
      } else {
        anchor = firstItem();
        if (anchor) anchorTop = anchor.getBoundingClientRect().top;
      }
    },
    frameForcedReflow,
    { name: 'scrollAnchor.restore' },
  );

  // 3. The write (forced-reflow mutate phase of the same frame).
  createMutationEffect(
    () => scrollTopFix(),
    (fix) => {
      const el = untrack(container);
      if (fix === undefined || !el) return;
      el.scrollTop = fix.top;
      restored = true;
    },
    { name: 'scrollAnchor.write' },
  );

  return {
    anchor: () => anchor,
    anchorTop: () => anchorTop,
    track(el, top) {
      anchor = el;
      if (el) anchorTop = top ?? el.getBoundingClientRect().top;
    },
    items() {
      if (elementsStale) {
        const root = untrack(list);
        elements = root ? Array.from(root.querySelectorAll<HTMLElement>(selector)) : [];
        elementsStale = false;
      }
      return elements;
    },
    consumeRestored() {
      const was = restored;
      restored = false;
      return was;
    },
  };
}
