import { DEV } from '../env';
import { createMemo, mapArray, untrack, type Accessor } from '../index';

export type { Accessor };
export type Each<T> = readonly T[] | undefined | null | false;

export interface ForBaseProps<T> {
  each: Each<T>;
  /**
   * Rendered while the list is empty. It is read inside For's memo, so the memo owns it: it is
   * disposed (its `onCleanup`s run) when rows arrive, and recreated when the list empties again.
   */
  fallback?: unknown;
}

/**
 * `<For each keyed fallback>` over `mapArray` (spec §3.3 "Списки"). `keyed` defaults to `true`
 * (identity by reference); `false` maps by index (item is an accessor); a function keys by
 * `keyFn(item)` — the pattern for immutable data: a replaced object with the same key updates the
 * row in place and `insert` sees no array change.
 *
 * `keyed` and `children` are read once, when the component is created: switching the mode or the
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
  if ((props as { order?: unknown }).order !== undefined) {
    // Both modes throw (a prod build must not quietly render a manual-order list with keyed semantics); prod has a short text.
    throw new Error(
      DEV
        ? '[frameact] <For order="manual"> no longer exists: use <ManualFor> (manual-order lists live in their own component so apps without them do not bundle the code)'
        : 'frameact: <For order> was removed, use <ManualFor>',
    );
  }
  return withFallback(mapArray<T, unknown>(() => props.each, props.children, { keyed: props.keyed }), props);
}

/** @internal `rows` as is, or a memo that shows `props.fallback` while the list is empty. Shared with ManualFor. */
export function withFallback(rows: () => unknown[], props: { fallback?: unknown }): unknown {
  if (!('fallback' in props)) return rows;
  return createMemo(() => {
    const list = rows();
    return list.length === 0 ? untrack(() => props.fallback) : list;
  });
}
