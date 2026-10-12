// Manual order adapted from teact (MIT, © 2022 Alexander Zinchuk) — renderFastListChildren / teactOrderKey.
import { DEV } from '../env';
import { createMemo, mapArray, untrack, type Accessor } from '../index';
import { tagManualOrder } from './reconcile';

export type { Accessor };
export type Each<T> = readonly T[] | undefined | null | false;

export interface ForBaseProps<T> {
  each: Each<T>;
  /**
   * Rendered while the list is empty. It is read inside For's memo, so the memo owns it: it is
   * disposed (its `onCleanup`s run) when rows arrive, and recreated when the list empties again.
   */
  fallback?: unknown;
  /**
   * `manual`: the DOM order is not the list order. Kept rows stay where they are, new rows are
   * inserted at their list index (a contiguous run before one anchor), and a kept row moves only when
   * its `orderKey` changes. For lists whose visual order is a CSS transform of `index()` (ChatList):
   * zero DOM moves on reorder. Every row must be a single DOM node, and `For` must be the sole
   * content of its slot (nested in a larger array it falls back to the ordinary diff).
   */
  order?: 'manual';
  /** Computed per item, untracked, whenever `each` changes (it is not reactive on its own); a changed key moves that row to its list index. Keys are compared with `Object.is`: return a primitive (a fresh object or array counts as a change on every recompute). A throwing `orderKey` is logged and leaves that row where it is. */
  orderKey?: (item: T) => unknown;
}

/**
 * `<For each keyed fallback>` over `mapArray` (spec §3.3 "Списки"). `keyed` defaults to `true`
 * (identity by reference); `false` maps by index (item is an accessor); a function keys by
 * `keyFn(item)` — the pattern for immutable data: a replaced object with the same key updates the
 * row in place and `insert` sees no array change.
 *
 * `keyed`, `children` and `order` are read once, when the component is created: switching the mode or the
 * row renderer later is not supported (`each` and `fallback` are reactive).
 * Every mode passes the index argument to `children` (a number in `keyed: false`, else an accessor).
 */
export function For<T>(
  props: ForBaseProps<T> & { keyed?: true; children: (item: T, index: Accessor<number>) => unknown },
): unknown;
export function For<T>(
  props: ForBaseProps<T> & { keyed: false; children: (item: Accessor<T>, index: number) => unknown },
): unknown;
export function For<T>(
  props: ForBaseProps<T> & {
    keyed: (item: T) => unknown;
    children: (item: Accessor<T>, index: Accessor<number>) => unknown;
  },
): unknown;
export function For<T>(
  props: ForBaseProps<T> & { keyed?: boolean | ((item: T) => unknown); children: (item: any, index: any) => unknown },
): unknown {
  const mapped = mapArray<T, unknown>(() => props.each, props.children, { keyed: props.keyed });
  const rows = props.order === 'manual' ? manualOrder(mapped, () => props.each, () => props.orderKey) : mapped;
  if (!('fallback' in props)) return rows;
  return createMemo(() => {
    const list = rows();
    return list.length === 0 ? untrack(() => props.fallback) : list;
  });
}

let warnedManualRow = false;

const isNode = (row: unknown): row is Node => row != null && !!(row as Node).nodeType;

/**
 * The array handed to `insert` is in DOM order (kept rows in their previous order, new rows at
 * their list index) and tagged as manually ordered, with the set of rows whose `orderKey` changed.
 * `insertExpression` then applies it with the insert-only `reconcileManual`: kept rows are never
 * touched, new rows are inserted in batches, a row with a changed `orderKey` moves exactly once.
 * Non-node rows (a mapper that threw maps to `undefined`) are never "kept": they hold no DOM.
 */
function manualOrder<T>(
  mapped: () => unknown[],
  each: () => Each<T>,
  orderKey: () => ((item: T) => unknown) | undefined,
): () => unknown[] {
  let prevOrder: unknown[] = [];
  let prevKeys = new Map<unknown, unknown>();
  return createMemo(() => {
    const rows = mapped(); // list order; row identity is stable per key (mapArray)
    // Tracked on purpose: when only an item's orderKey changes (same ids at the same list positions),
    // mapArray returns the very same rows array, so reading `each()` is what re-runs this memo and
    // lets the changed row move.
    const items = each() || [];
    const keyFn = untrack(orderKey);
    const prevSet = new Set<unknown>();
    for (const row of prevOrder) if (isNode(row)) prevSet.add(row);
    const nextKeys = new Map<unknown, unknown>();
    const moved = new Set<unknown>();
    const rowSet = new Set<unknown>();
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      if (isNode(row)) rowSet.add(row);
      else if (DEV && !warnedManualRow && row != null) {
        warnedManualRow = true;
        console.error('[frameact] <For order="manual">: every row must be a single DOM node', row);
      }
      if (!keyFn || !isNode(row)) continue;
      let key: unknown;
      try {
        key = untrack(() => keyFn(items[j]));
      } catch (error) {
        // a throwing orderKey must not lose the list update: that row keeps its place
        console.error('[frameact] <For order="manual">: orderKey failed', error);
        key = prevKeys.has(row) ? prevKeys.get(row) : undefined;
      }
      nextKeys.set(row, key);
      if (prevSet.has(row) && !Object.is(prevKeys.get(row), key)) moved.add(row);
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
    prevOrder = out;
    prevKeys = nextKeys;
    return out;
  });
}
