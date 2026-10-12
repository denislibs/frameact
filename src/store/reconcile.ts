// reconcile (spec §3.5 req. 3): merge immutable data into the store by diff — matched items (by key)
// and unchanged branches keep their store identity, only changed leaves notify.
import { isWrappable, setProperty, unwrap } from './store';

export interface ReconcileOptions {
  /** Identity key of array items (default `'id'`); `null`: arrays are diffed by index. */
  key?: string | null;
}

/** `T` without `readonly` (deep): a `Readonly<…>`/`as const` chunk reconciles into a mutable path. */
export type Mutable<T> = T extends (...args: any[]) => any
  ? T
  : T extends readonly (infer U)[]
    ? Mutable<U>[]
    : T extends object
      ? { -readonly [K in keyof T]: Mutable<T[K]> }
      : T;

/** `parent[prop]` ← `next`: a changed primitive, a type change or a different key replaces; same-shaped objects recurse. */
function applyState(next: any, parent: any, prop: PropertyKey, key: string | null): void {
  const prev = parent[prop];
  if (next === prev) return;
  if (
    !isWrappable(next) ||
    !isWrappable(prev) ||
    Array.isArray(next) !== Array.isArray(prev) ||
    (key !== null && !Array.isArray(next) && (next as any)[key] !== (prev as any)[key])
  ) {
    setProperty(parent, prop, next);
    return;
  }
  reconcileInto(prev, next, key);
}

function reconcileInto(prev: any, next: any, key: string | null): void {
  if (Array.isArray(next)) {
    reconcileArray(prev, next, key);
    return;
  }
  let prevCount = 0; // prev's keys BEFORE the loop (an explicit `undefined` in next deletes during it)
  for (const k in prev) if (k !== undefined) prevCount++;
  let present = 0; // keys of `next` that `prev` has too
  for (const k in next) {
    const nv = next[k];
    const pv = prev[k];
    if (pv !== undefined || Object.hasOwn(prev, k)) present++;
    if (nv === pv) continue; // (the common case: an unchanged primitive)
    if (typeof nv === 'object' && nv !== null && typeof pv === 'object' && pv !== null) applyState(nv, prev, k, key);
    else setProperty(prev, k, nv); // (an `undefined` value deletes the key)
  }
  // deletions only when `prev` has keys `next` lacks: prevCount === present ⇔ every key of prev is in next
  if (prevCount !== present) {
    for (const k in prev) if (!Object.hasOwn(next, k)) setProperty(prev, k, undefined);
  }
}

function reconcileArray(prev: any[], next: any[], key: string | null): void {
  const n = next.length;
  const keyed = key !== null && n > 0 && isWrappable(next[0]) && (next[0] as any)[key] != null;
  if (!keyed) {
    for (let i = 0; i < n; i++) {
      if (next[i] === undefined) setProperty(prev, i, undefined, false); // an explicit undefined element is a value, not a hole
      else applyState(next[i], prev, i, key);
    }
  } else {
    // items matched by key keep their (old) raw object, merged in place; new keys are adopted
    const byKey = new Map<unknown, any>();
    for (let i = 0; i < prev.length; i++) {
      const o = prev[i];
      if (isWrappable(o)) byKey.set((o as any)[key], o);
    }
    const result: any[] = [];
    result.length = n;
    for (let i = 0; i < n; i++) {
      const item = next[i];
      const old = isWrappable(item) ? byKey.get((item as any)[key]) : undefined;
      if (old !== undefined && old !== item) {
        reconcileInto(old, item, key);
        result[i] = old;
      } else result[i] = item;
    }
    for (let i = 0; i < n; i++) if (prev[i] !== result[i]) setProperty(prev, i, result[i], false);
  }
  if (prev.length !== n) setProperty(prev, 'length', n);
}

/**
 * `setState('messages', chatId, reconcile(chunk))`: merge immutable data by diff. Array items are
 * matched by `key` (default `'id'`; keys must be unique — a duplicate puts one raw object at two
 * indexes) and merged into their old raw object — proxies and `For` rows keep their identity; new
 * items are adopted as they are (the store owns them from then on); the order is rewritten by index.
 * A non-object at the path, a type mismatch or a frozen `prev` (an immutable value) is replaced.
 */
export function reconcile<T>(value: T, options: ReconcileOptions = {}): (prev: unknown) => Mutable<T> {
  const key = options.key === undefined ? 'id' : options.key;
  const next = unwrap(value) as any;
  return (prev: any) => {
    if (!isWrappable(prev) || !isWrappable(next)) return next;
    if (Array.isArray(prev) !== Array.isArray(next)) return next;
    reconcileInto(prev, next, key);
    return prev;
  };
}
