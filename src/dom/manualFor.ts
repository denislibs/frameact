// Manual-order lists, adapted from teact (MIT, © 2022 Alexander Zinchuk) — renderFastListChildren / teactOrderKey.
// frameact: a component of its own (not `For order="manual"`), so an app without manual-order lists does not bundle
// this code: `ManualFor` registers the insert-only reconciler with `insert` (reconcile.ts) when it runs — not at
// module load, so the module has no top-level side effect and a bundler drops it when `ManualFor` is not imported.
import { DEV } from '../env';
import { handleError } from '../core/core';
import { createMemo, getOwner, mapArray, untrack, type Accessor } from '../index';
import { withFallback, type Each, type ForBaseProps } from './list';
import { getNatives } from './natives';
import { ownedBy, setManualReconciler, tagManualOrder, tagSlot } from './reconcile';

export interface ManualForBaseProps<T> extends ForBaseProps<T> {
  /** Computed per item, untracked, whenever `each` changes (it is not reactive on its own); a changed key moves that row to its list index. Keys are compared with `Object.is`: return a primitive (a fresh object or array counts as a change on every recompute). A throwing `orderKey` is logged and leaves that row where it is. */
  orderKey?: (item: T) => unknown;
}

/**
 * `<ManualFor each orderKey keyed fallback>`: `For` for lists whose DOM order is not the list order. Kept
 * rows stay where they are, new rows are inserted at their list index (a contiguous run before one anchor),
 * and a kept row moves only when its `orderKey` changes. For lists whose visual order is a CSS transform of
 * `index()` (ChatList): zero DOM moves on reorder. Every row must be a single DOM node, and `ManualFor` must be
 * the sole content of its slot (nested in a larger array it falls back to the ordinary diff). Everything else
 * (`each`, `keyed`, `fallback`, `children`) is as in `For`.
 */
export function ManualFor<T>(
  props: ManualForBaseProps<T> & { keyed?: true; children: (item: T, index: Accessor<number>) => unknown },
): unknown;
export function ManualFor<T>(
  props: ManualForBaseProps<T> & { keyed: false; children: (item: Accessor<T>, index: number) => unknown },
): unknown;
export function ManualFor<T>(
  props: ManualForBaseProps<T> & {
    keyed: (item: T) => unknown;
    children: (item: Accessor<T>, index: Accessor<number>) => unknown;
  },
): unknown;
export function ManualFor<T>(
  props: ManualForBaseProps<T> & { keyed?: boolean | ((item: T) => unknown); children: (item: any, index: any) => unknown },
): unknown {
  setManualReconciler(reconcileManual); // idempotent; before the first tagged array can reach `insert`
  const mapped = mapArray<T, unknown>(() => props.each, props.children, { keyed: props.keyed });
  return withFallback(manualOrder(mapped, () => props.each, () => props.orderKey), props);
}

let warnedManualRow = false;

/** Through the owner's `onError` handlers (as mapArray reports a failed row), else the console. */
function reportOrderKeyError(error: unknown): void {
  try {
    handleError(getOwner(), error);
  } catch (unhandled) {
    console.error('[frameact] <ManualFor>: orderKey failed', unhandled);
  }
}

const isNode = (row: unknown): row is Node => row != null && !!(row as Node).nodeType;

/** `row -> key` for the node rows of one pass (`keys[j]` belongs to `rows[j]`). */
function keyMapOf(rows: readonly unknown[], keys: readonly unknown[]): Map<unknown, unknown> {
  const map = new Map<unknown, unknown>();
  for (let j = 0; j < rows.length; j++) if (isNode(rows[j])) map.set(rows[j], keys[j]);
  return map;
}

/**
 * The array handed to `insert` is in DOM order (kept rows in their previous order, new rows at
 * their list index) and tagged as manually ordered, with the set of rows whose `orderKey` changed.
 * `insertExpression` then applies it with the insert-only `reconcileManual`: kept rows are never
 * touched, new rows are inserted in batches, a row with a changed `orderKey` moves exactly once.
 * Non-node rows (a mapper that threw maps to `undefined`) are never "kept": they hold no DOM.
 *
 * Fast path: `mapArray` hands back the very same rows array when only the items behind the rows
 * changed (`keyed={fn}`: an edited chat, no structural change). If every `orderKey` is also
 * unchanged, nothing can move: the previous array is returned as is (the memo does not notify,
 * `insert` does not run) and no collection is built. The keys of a pass live in two position-indexed
 * buffers that are swapped, so the steady state allocates nothing per pass.
 */
function manualOrder<T>(
  mapped: () => unknown[],
  each: () => Each<T>,
  orderKey: () => ((item: T) => unknown) | undefined,
): () => unknown[] {
  let prevOrder: unknown[] = [];
  let prevRows: unknown[] | null = null;
  let prevKeyed = false;
  let prevKeys: unknown[] = []; // order key of prevRows[j] (undefined: no orderKey, or not a node)
  let keyBuffer: unknown[] = [];
  return createMemo(() => {
    const rows = mapped(); // list order; row identity is stable per key (mapArray)
    // Tracked on purpose: when only an item's orderKey changes (same ids at the same list positions),
    // mapArray returns the very same rows array, so reading `each()` is what re-runs this memo and
    // lets the changed row move.
    const items = each() || [];
    const keyFn = untrack(orderKey);
    const same = rows === prevRows && prevKeyed === (keyFn !== undefined);
    if (same && !keyFn) return prevOrder; // no keys to compare: the same rows are the same order
    let unchanged = same;
    let prevKeyMap: Map<unknown, unknown> | undefined;
    const keys = keyBuffer;
    keys.length = rows.length;
    untrack(() => {
      for (let j = 0; j < rows.length; j++) {
        const row = rows[j];
        if (!isNode(row)) {
          if (DEV && !warnedManualRow && row != null) {
            warnedManualRow = true;
            console.error('[frameact] <ManualFor>: every row must be a single DOM node', row);
          }
          keys[j] = undefined;
          continue;
        }
        if (!keyFn) {
          keys[j] = undefined;
          continue;
        }
        let key: unknown;
        try {
          key = keyFn(items[j]);
        } catch (error) {
          // a throwing orderKey must not lose the list update: that row keeps its place
          reportOrderKeyError(error);
          key = same ? prevKeys[j] : (prevKeyMap ??= keyMapOf(prevRows ?? [], prevKeys)).get(row);
        }
        keys[j] = key;
        if (unchanged && !Object.is(prevKeys[j], key)) unchanged = false;
      }
    });
    if (unchanged) return prevOrder; // the same rows, the same keys: nothing to place, nothing to move
    const prevSet = new Set<unknown>();
    for (const row of prevOrder) if (isNode(row)) prevSet.add(row);
    if (keyFn) prevKeyMap ??= keyMapOf(prevRows ?? [], prevKeys);
    const moved = new Set<unknown>();
    const rowSet = new Set<unknown>();
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      if (!isNode(row)) continue;
      rowSet.add(row);
      if (keyFn && prevSet.has(row) && !Object.is(prevKeyMap!.get(row), keys[j])) moved.add(row);
    }
    const kept: unknown[] = [];
    for (const row of prevOrder) if (isNode(row) && rowSet.has(row) && !moved.has(row)) kept.push(row);
    const out: unknown[] = [];
    let k = 0;
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      out.push(isNode(row) && prevSet.has(row) && !moved.has(row) ? kept[k++] : row);
    }
    tagManualOrder(out, moved);
    keyBuffer = prevKeys;
    prevKeys = keys;
    prevRows = rows;
    prevKeyed = keyFn !== undefined;
    prevOrder = out;
    return out;
  });
}

/**
 * Insert-only counterpart of `reconcileArrays`. `next` lists the slot's nodes in DOM order, except
 * for new nodes (placed at their list index) and the `moved` ones. Kept, unmoved nodes are never
 * touched (no `remove`, `replaceChild` or `insertBefore`); a contiguous run of nodes to insert goes
 * before one anchor (the next kept node, else the marker); a `moved` node is moved exactly once.
 * `prev` must be non-empty. A kept node that is out of DOM order despite not being listed in `moved`
 * (the memo ran ahead of the applied DOM) is moved too: correctness first.
 */
export function reconcileManual(
  parentNode: any,
  prev: any[],
  next: any[],
  marker: Node | null | undefined,
  moved: ReadonlySet<unknown>,
): void {
  const { insertBefore, removeChild } = getNatives();
  const nextSet = new Set<any>(next);
  const prevIndex = new Map<any, number>();
  for (let i = 0; i < prev.length; i++) {
    const n = prev[i];
    if (!nextSet.has(n)) {
      if (ownedBy(n, parentNode, marker)) removeChild.call(parentNode, n);
    } else if (ownedBy(n, parentNode, marker)) prevIndex.set(n, i);
  }
  // Stable nodes: already in the DOM, not moved, in increasing DOM order. Walking backwards gives
  // every position the anchor to insert before.
  // The `at > last` test is the safety branch for a `next` that is not in DOM order (the memo ran
  // ahead of the applied DOM): theoretical for `For`, and greedy, not an LIS, so it may move more
  // nodes than the minimum. `moved` carries the intended moves.
  const length = next.length;
  const stable: boolean[] = [];
  let last = -1;
  for (let i = 0; i < length; i++) {
    const n = next[i];
    const at = prevIndex.get(n);
    stable[i] = at !== undefined && at > last && !moved.has(n);
    if (stable[i]) last = at!;
  }
  const anchors: (Node | null)[] = [];
  let anchor: Node | null = marker ?? null;
  for (let i = length - 1; i >= 0; i--) {
    anchors[i] = anchor;
    if (stable[i]) anchor = next[i];
  }
  for (let i = 0; i < length; i++) {
    if (stable[i]) continue;
    const n = next[i];
    insertBefore.call(parentNode, n, anchors[i]);
    tagSlot(n, marker);
  }
}
