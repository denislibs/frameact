import { createMemo, mapArray, untrack } from '../index';

export type Accessor<T> = () => T;
export type Each<T> = readonly T[] | undefined | null | false;

export interface ForBaseProps<T> {
  each: Each<T>;
  /** Rendered while the list is empty (created under For's owner, disposed when rows arrive). */
  fallback?: unknown;
}

/**
 * `<For each keyed fallback>` over `mapArray` (spec §3.3 "Списки"). `keyed` defaults to `true`
 * (identity by reference); `false` maps by index (item is an accessor); a function keys by
 * `keyFn(item)` — the pattern for immutable data: a replaced object with the same key updates the
 * row in place and `insert` sees no array change.
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
  const rows = mapArray<T, unknown>(() => props.each, props.children, { keyed: props.keyed });
  if (!('fallback' in props)) return rows;
  return createMemo(() => {
    const list = rows();
    return list.length === 0 ? untrack(() => props.fallback) : list;
  });
}
