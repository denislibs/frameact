// frameact/store — model B, the "signal-way" tree store (spec §3.5), in the spirit of Solid's
// createStore (MIT, © 2016-2025 Ryan Carniato). State is a tree of plain objects and arrays; every
// property becomes a slim core signal lazily, on its first TRACKED read; a path write mutates the raw
// object in place and notifies that leaf only. No service fields on user objects: the per-object
// bookkeeping (proxy, leaf signals, shape signal) lives in a WeakMap'd StoreNode, which is also the
// Proxy handler of that object (the traps reach its fields through `this`: no lookup on the read path).
import { DEV } from '../env';
import { createSignalNode, getObserver, markLiveRead, trackNode, writeStoreNode } from '../core/core';
import { TRACK } from '../core/symbols';
import type { Computation } from '../core/types';

/** Read on a store proxy: the raw object behind it (see unwrap). */
export const $RAW: unique symbol = Symbol('frameact.store.raw') as any;
/**
 * Read on a store ARRAY proxy: subscribes to the array's shape with one link and returns a plain
 * array of its items (wrapped). `mapArray`/`For` read it, so a list never subscribes per index.
 */
export const $TRACK: typeof TRACK = TRACK;

/** The read-only view of a store value: properties and arrays readonly, functions as they are. */
export type Store<T> = T extends (...args: any[]) => any
  ? T
  : T extends readonly (infer U)[]
    ? StoreArray<U>
    : T extends object
      ? { readonly [K in keyof T]: Store<T[K]> }
      : T;

/** A store array: a readonly array of store items with the `$TRACK` key (`mapArray`/`For` read it). */
export interface StoreArray<U> extends ReadonlyArray<Store<U>> {
  readonly [$TRACK]: readonly Store<U>[];
}

/** @internal DEV counters for tests. */
export const storeStats = { leafSignals: 0, nodes: 0 };

/** raw object → its node. Only objects that were ever read through a proxy have one. */
const nodes = new WeakMap<object, StoreNode>();

/**
 * Plain objects (incl. null-prototype) and arrays become store nodes; class instances, Dates, Maps…
 * are values. A frozen object is a value too: it cannot be mutated (the store writes in place), and a
 * proxy over it could not honour its non-configurable properties — it is returned raw and replaced whole.
 */
export function isWrappable(v: unknown): v is object {
  if (v === null || typeof v !== 'object') return false;
  if (Object.isFrozen(v)) return false;
  if (Array.isArray(v)) return v !== Array.prototype;
  const proto = Object.getPrototypeOf(v);
  if (proto === null) return v !== Object.prototype;
  if (proto !== Object.prototype) return false;
  // a builtin prototype object (`Map.prototype`, `Date.prototype`…) is an ordinary object whose own
  // `constructor` points back at it: never data, and writing into it pollutes every instance
  if (Object.hasOwn(v, 'constructor')) {
    const c = Object.getOwnPropertyDescriptor(v, 'constructor')!.value;
    if (typeof c === 'function' && c.prototype === v) return false;
  }
  return true;
}

/** The key that would reach `Object.prototype` / change a prototype: data never gets to use it. */
const PROTO_KEY = '__proto__';
function dropProto(where: string): void {
  if (DEV) console.error(`[frameact/store] the key "__proto__" was ignored (${where}): it can never be stored`);
}

function readOnly(): never {
  throw new TypeError('[frameact/store] the state is read-only: write through setState (merge, produce, reconcile)');
}

/**
 * Leaf-signal table: instances of a constructor whose prototype has no properties (no inherited
 * `constructor`/`toString` keys) — fast-mode objects that share hidden classes across objects of one
 * shape (all messages read the same fields), unlike `Object.create(null)` dictionaries (measured:
 * -80 B per row, -12 ns per read).
 */
const SigTable = function SigTable() {} as unknown as { new (): Record<PropertyKey, Computation> };
SigTable.prototype = Object.create(null);

/** The node of one raw object — and the Proxy handler of its proxy. */
class StoreNode {
  readonly raw: any;
  readonly proxy: any;
  /** key → leaf signal (slim core signal node), created on the first tracked read */
  sigs: Record<PropertyKey, Computation> | null;
  /** shape signal: arrays — any index/length change; objects — a key added or removed (ownKeys, $TRACK) */
  self: Computation | null;
  /** the shape signal's value: bumped by every shape change */
  shape: number;
  /** values signal (`values()`/`entries()` readers): fires on every effective write to this object */
  vals: Computation | null;
  valsVer: number;

  constructor(raw: object) {
    this.raw = raw;
    this.sigs = null;
    this.self = null;
    this.shape = 0;
    this.vals = null;
    this.valsVer = 0;
    this.proxy = new Proxy(raw, this as ProxyHandler<any>);
    nodes.set(raw, this);
    if (DEV) storeStats.nodes++;
  }

  get(target: any, key: PropertyKey): any {
    const value = target[key];
    if (value === undefined) {
      // (the service keys are never on the target)
      if (key === $RAW) return target;
      if (key === $TRACK) return Array.isArray(target) ? trackedItems(this) : undefined;
    }
    const isObj = typeof value === 'object' && value !== null;
    if (isObj && key === PROTO_KEY) return undefined; // never hand out Object.prototype / Array.prototype
    if (getObserver() !== null && typeof key !== 'symbol') {
      if (typeof value !== 'function') trackKey(this, key, value);
      else if (Object.hasOwn(target, key)) trackKey(this, key, value);
      else if (!Array.isArray(target)) trackSelf(this); // an inherited member (`constructor`, `toString`…) a key of that name may shadow: the shape fires when it appears
    }
    if (isObj) return wrap(value);
    return value;
  }

  has(target: any, key: PropertyKey): boolean {
    if (getObserver() !== null && typeof key !== 'symbol') trackKey(this, key, Object.hasOwn(target, key) ? target[key] : undefined);
    return key in target;
  }

  ownKeys(target: any): ArrayLike<string | symbol> {
    trackSelf(this);
    const ks = Reflect.ownKeys(target);
    if (DEV && ks.length > BIG_KEYS && !warnedBig) {
      warnedBig = true;
      console.warn(
        `[frameact/store] enumerating a store object with ${ks.length} keys through its proxy (Object.keys/values/entries, spread, for…in) is 30–80x slower than on a plain object: use keys()/values()/entries() from "frameact/store".`,
      );
    }
    return ks;
  }

  getOwnPropertyDescriptor(target: any, key: PropertyKey): PropertyDescriptor | undefined {
    const desc = Reflect.getOwnPropertyDescriptor(target, key);
    if (desc === undefined || !desc.configurable || desc.get !== undefined || desc.set !== undefined) return desc;
    // A data property: a LITERAL descriptor (no `delete`s, no per-key getter closure — those made every
    // key iteration 30–80x slower than on a plain object). Its value is the read-only view of the value;
    // Object.values / spread / entries then read the value through `get`, which is where it is tracked.
    const v = desc.value;
    if (typeof v === 'object' && v !== null) desc.value = wrap(v); // (the descriptor is a fresh object: reuse it)
    return desc;
  }

  set(): boolean {
    return readOnly();
  }
  deleteProperty(): boolean {
    return readOnly();
  }
  defineProperty(): boolean {
    return readOnly();
  }
  setPrototypeOf(): boolean {
    return readOnly();
  }
  preventExtensions(): boolean {
    return readOnly();
  }
}

/** DEV: enumerating a store object with more keys than this through its proxy is reported once. */
const BIG_KEYS = 1000;
let warnedBig = false;

function trackKey(node: StoreNode, key: PropertyKey, value: unknown) {
  let sigs = node.sigs;
  if (sigs === null) sigs = node.sigs = new SigTable();
  let s = sigs[key];
  if (s === undefined) {
    s = sigs[key] = createSignalNode(value);
    if (DEV) storeStats.leafSignals++;
  }
  trackNode(s);
}

function trackSelf(node: StoreNode) {
  if (getObserver() === null) return;
  let s = node.self;
  if (s === null) {
    s = node.self = createSignalNode(0);
    if (DEV) storeStats.leafSignals++;
  }
  trackNode(s);
}

function trackVals(node: StoreNode) {
  if (getObserver() === null) return;
  let s = node.vals;
  if (s === null) {
    s = node.vals = createSignalNode(0);
    if (DEV) storeStats.leafSignals++;
  }
  trackNode(s);
}

/**
 * `$TRACK` read: subscribe to the shape only and return a plain array of the items, wrapped, built
 * from the raw array (no per-index trap: an index read through a Proxy stringifies the index, ~80 ns).
 */
function trackedItems(node: StoreNode): unknown[] {
  trackSelf(node);
  const raw = node.raw as unknown[];
  const n = raw.length;
  const out: unknown[] = [];
  out.length = n;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    out[i] = typeof v === 'object' && v !== null ? wrap(v) : v;
  }
  return out;
}

function wrap(value: object): any {
  const n = nodes.get(value);
  if (n !== undefined) return n.proxy;
  if (!isWrappable(value)) return value;
  return new StoreNode(value).proxy;
}

/** The raw object behind a store proxy (or the value itself). O(1): the raw tree holds raw objects only. */
export function unwrap<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    const raw = (value as any)[$RAW];
    if (raw !== undefined) return raw;
  }
  return value;
}

/** A deep, detached copy (history, persistence, devtools). O(n); `unwrap()` is the live raw tree. */
export function snapshot<T>(value: T): T {
  return structuredClone(unwrap(value));
}

/**
 * `keys(obj)` / `values(obj)` / `entries(obj)`: `Object.keys`/`values`/`entries` for store objects, at the
 * speed of a plain object — they read the raw object (no proxy trap per key) and subscribe ONCE: `keys` to
 * the shape (a key added or removed), `values`/`entries` to every write into the object (they hand out
 * the values, so a replaced or changed value must re-run the reader; reading a nested field of a returned
 * item is tracked by that item as usual). Object values come back wrapped (read-only views). Arrays: any
 * item write. A non-store argument is handed to the `Object` function.
 */
export function keys<T extends object>(obj: T): Extract<keyof T, string>[] {
  const raw = (obj as any)[$RAW];
  if (raw === undefined) return Object.keys(obj) as Extract<keyof T, string>[];
  trackSelf(nodes.get(raw)!);
  return Object.keys(raw) as Extract<keyof T, string>[];
}
export function values<T extends object>(obj: T): T[Extract<keyof T, string>][] {
  const raw = (obj as any)[$RAW];
  if (raw === undefined) return Object.values(obj);
  trackShapeOrVals(raw);
  const ks = Object.keys(raw);
  const out: unknown[] = [];
  out.length = ks.length;
  for (let i = 0; i < ks.length; i++) {
    const v = raw[ks[i]];
    out[i] = typeof v === 'object' && v !== null ? wrap(v) : v;
  }
  return out as T[Extract<keyof T, string>][];
}
export function entries<T extends object>(obj: T): [Extract<keyof T, string>, T[Extract<keyof T, string>]][] {
  const raw = (obj as any)[$RAW];
  if (raw === undefined) return Object.entries(obj) as [Extract<keyof T, string>, T[Extract<keyof T, string>]][];
  trackShapeOrVals(raw);
  const ks = Object.keys(raw);
  const out: unknown[] = [];
  out.length = ks.length;
  for (let i = 0; i < ks.length; i++) {
    const v = raw[ks[i]];
    out[i] = [ks[i], typeof v === 'object' && v !== null ? wrap(v) : v];
  }
  return out as [Extract<keyof T, string>, T[Extract<keyof T, string>]][];
}
function trackShapeOrVals(raw: object) {
  const node = nodes.get(raw)!;
  if (Array.isArray(raw)) trackSelf(node); // (an array's shape signal fires on every item write)
  else trackVals(node);
}

// ---- writes -------------------------------------------------------------------------------------

/** @internal > 0 inside `ungated()` (Task 6): leaf writes run plain walks instead of store walks. */
export let ungatedDepth = 0;
/** @internal */
export function setUngatedDepth(n: number) {
  ungatedDepth = n;
}

function notifyLeaf(s: Computation, value: unknown) {
  writeStoreNode(s, value, ungatedDepth === 0);
}

/**
 * Raw-tree invariant: no proxy inside. A new object written into the store (a spread copy of a store
 * object carries the proxies of its nested objects; `merge({ y: state.a.b })` carries one directly) is
 * unwrapped deeply and stripped of its own `__proto__` keys (JSON.parse creates them; a later spread
 * would turn one into a prototype change). The walk covers the NEW value: it stops at store proxies
 * (their raw object is in the tree already), at objects that were ever read through a proxy and at
 * values — but an object of the tree that was never read has no node, so the walk goes through it too
 * (like Solid's deep unwrap). Iterative, with a visited set: a cyclic or very deep new graph is safe.
 */
export function adopt(v: object): object {
  const r = (v as any)[$RAW];
  if (r !== undefined) return r; // a store proxy or a produce draft
  if (nodes.has(v) || !isWrappable(v)) return v;
  let seen: Set<object> | null = null; // (allocated by the first nested object only)
  let stack: object[] = [v];
  while (stack.length !== 0) {
    const o = stack.pop() as Record<string, unknown>;
    const ks = Object.keys(o);
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i];
      if (k === PROTO_KEY) {
        delete o[k];
        dropProto('new data');
        continue;
      }
      const c = o[k];
      if (c === null || typeof c !== 'object') continue;
      const raw = (c as any)[$RAW];
      if (raw !== undefined) {
        o[k] = raw;
        continue;
      }
      if (nodes.has(c) || !isWrappable(c)) continue;
      if (seen === null) seen = new Set([v]);
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(c);
    }
  }
  return v;
}

/**
 * Write `raw[key] = value` — or, when `value` is `undefined` and `deleteOnUndefined` holds, delete the
 * key — and notify what exists: the leaf (dropped from the table after a deletion: its readers are dirty
 * and re-link a fresh leaf if they still read the key), the array `length` (on truncation also the
 * removed indexes) and the shape signal (arrays: any index/length write; objects: a key added or
 * removed). An object never read through a proxy has no node: nothing to notify.
 * Writing into a frozen object: a DEV `TypeError` with a clear message; in production the strict-mode
 * assignment throws the native one.
 */
export function setProperty(raw: any, key: PropertyKey, value: unknown, deleteOnUndefined = true): void {
  if (key === PROTO_KEY) return dropProto('setState');
  if (value !== null && typeof value === 'object') value = adopt(value);
  const had = Object.hasOwn(raw, key); // (own only: `constructor` / `toString` are valid dictionary keys)
  const prev = had ? raw[key] : undefined;
  const del = value === undefined && deleteOnUndefined;
  if (del ? !had : prev === value && (had || value !== undefined)) return;
  if (DEV && Object.isFrozen(raw)) {
    throw new TypeError(`[frameact/store] cannot write "${String(key)}" into a frozen object (the store owns and mutates the objects it holds; replace the frozen object instead)`);
  }
  const isArr = Array.isArray(raw);
  const prevLen = isArr ? raw.length : 0;
  if (del) delete raw[key];
  else raw[key] = value;
  const node = nodes.get(raw);
  if (node === undefined) return;
  const sigs = node.sigs;
  if (sigs !== null) {
    const s = sigs[key];
    if (s !== undefined) {
      notifyLeaf(s, value);
      if (del) delete sigs[key];
    }
    if (isArr) {
      const len = raw.length;
      if (len !== prevLen) {
        const ls = sigs.length;
        if (ls !== undefined && key !== 'length') notifyLeaf(ls, len);
        // truncation: the removed indexes read undefined now
        for (let i = len; i < prevLen; i++) {
          const is = sigs[i];
          if (is !== undefined) notifyLeaf(is, undefined);
        }
      }
    }
  }
  const self = node.self;
  if (self !== null && (isArr || had === del)) notifyLeaf(self, ++node.shape);
  const vals = node.vals;
  if (vals !== null) notifyLeaf(vals, ++node.valsVer);
}

/**
 * Batched write into an array: `mutate` writes the raw array natively (no per-index trap, no per-index
 * notification) and the store notifies ONCE afterwards — the `length` leaf if it changed, every index
 * leaf whose value changed (only indexes that have a reader are looked at: the table is small, the
 * array may not be), the shape signal and the values signal. Readers run after the whole write, so
 * none sees a half-moved array. `always`: notify the shape even if the length is unchanged (sort,
 * reverse, fill, copyWithin, a same-size splice rewrite the items in place).
 */
export function writeArray<R>(raw: any[], always: boolean, mutate: () => R): R {
  const node = nodes.get(raw);
  if (node === undefined || (node.sigs === null && node.self === null && node.vals === null)) return mutate();
  const prevLen = raw.length;
  let idx: number[] | null = null;
  let old: unknown[] | null = null;
  const sigs = node.sigs;
  if (sigs !== null) {
    for (const k in sigs) {
      const n = +k;
      if (n >= 0 && String(n) === k) {
        (idx ??= []).push(n);
        (old ??= []).push(raw[n]);
      }
    }
  }
  const result = mutate();
  const len = raw.length;
  if (sigs !== null) {
    if (idx !== null) {
      for (let j = 0; j < idx.length; j++) {
        const v = raw[idx[j]];
        if (v !== old![j]) notifyLeaf(sigs[idx[j]], v);
      }
    }
    if (len !== prevLen) {
      const ls = sigs.length;
      if (ls !== undefined) notifyLeaf(ls, len);
    }
  }
  if (always || len !== prevLen) {
    const self = node.self;
    if (self !== null) notifyLeaf(self, ++node.shape);
    const vals = node.vals;
    if (vals !== null) notifyLeaf(vals, ++node.valsVer);
  }
  return result;
}

declare const MERGED: unique symbol;
/**
 * The updater `merge()` returns — a function at run time, typed as a marker (no call signature, so it
 * never competes with `(prev: V) => V` for the contextual typing of inline updaters). It is accepted
 * where `Updater<V>` lists `Merger<Partial<V>>`: the partial's keys and value types are checked
 * against the value at the path (an unknown key or a wrong value type is an error).
 */
export interface Merger<P> {
  readonly [MERGED]?: P;
}

/**
 * `setState(…path, merge({ title, unread: 0 }))`: a SHALLOW merge into the object at the path (the
 * only way to merge — a plain object at a path replaces). `undefined` values delete their keys.
 */
export function merge<P extends object>(partial: P): Merger<P> {
  const next = unwrap(partial) as Record<PropertyKey, unknown>;
  return ((prev: unknown) => {
    if (!isWrappable(prev) || Array.isArray(prev)) {
      throw new TypeError('[frameact/store] merge(): the value at the path is not a plain object');
    }
    const ks = Object.keys(next);
    for (let i = 0; i < ks.length; i++) {
      if (ks[i] === PROTO_KEY) dropProto('merge');
      else setProperty(prev, ks[i], next[ks[i]]);
    }
    return prev;
  }) as unknown as Merger<P>;
}

type PathPart = PropertyKey | readonly PropertyKey[] | ((item: any, index: number) => boolean);

/** `list[3] = x` on a 1-item list would leave holes (For renders them as undefined rows): append with produce. */
function checkIndex(parent: any, key: PropertyKey): void {
  if (!Array.isArray(parent) || key === 'length') return;
  const n = typeof key === 'number' ? key : typeof key === 'string' && String(+key) === key ? +key : -1;
  if (n > parent.length) {
    throw new TypeError(`[frameact/store] setState(…, ${n}, …): the index is beyond the length (${parent.length}) and would leave holes — use produce(a => a.push(x))`);
  }
}

/** A hole is never what is wanted (For renders an undefined item, JSON turns it into null). */
function checkHole(parent: any, key: PropertyKey): never {
  throw new TypeError(`[frameact/store] setState(…, ${String(key)}, undefined): use produce(a => a.splice(i, 1)) to remove an item`);
}

/** Apply the last argument of setState at `parent[key]`: a value replaces, `undefined` deletes a key, an updater runs first. */
function applyAt(parent: any, key: PropertyKey, value: unknown): void {
  checkIndex(parent, key);
  if (typeof value === 'function') {
    const prev = Object.hasOwn(parent, key) ? parent[key] : undefined;
    value = (value as (prev: unknown) => unknown)(prev);
    if (value === prev) return; // merge / produce / reconcile mutated in place
  }
  if (value === undefined && Array.isArray(parent)) checkHole(parent, key);
  setProperty(parent, key, unwrap(value));
}

/** The keys a path part selects, or `null` for a plain key. */
function fanKeys(current: any, part: PathPart): readonly PropertyKey[] | null {
  if (Array.isArray(part)) return part;
  if (typeof part === 'function') {
    if (!Array.isArray(current)) throw new TypeError('[frameact/store] a filter function in a path selects items of an array');
    const out: number[] = [];
    for (let j = 0; j < current.length; j++) if (part(current[j], j)) out.push(j);
    return out;
  }
  return null;
}

/** The child object at an OWN key (an inherited `__proto__`, `constructor`… is never descended into). */
function descend(current: any, key: PropertyKey): any {
  const child = Object.hasOwn(current, key) ? current[key] : undefined;
  if (child === null || typeof child !== 'object' || child === Object.prototype || child === Array.prototype) {
    throw new TypeError(`[frameact/store] setState: nothing to descend into at "${String(key)}" (${String(child)})`);
  }
  return child;
}

/**
 * Walk `path` (the setState arguments) from `current`; iterative over plain keys, recursive only where a
 * part fans out. `dry`: validate only (the descent and the static checks of the last part) — a path
 * with a fan-out is walked dry first, so that a missing child or a bad index applies nothing.
 */
function updatePath(current: any, path: unknown[], i: number, dry: boolean): void {
  const last = path.length - 1; // the value
  for (; i < last - 1; i++) {
    const part = path[i] as PathPart;
    const fan = fanKeys(current, part);
    if (fan !== null) {
      for (let j = 0; j < fan.length; j++) updatePath(descend(current, fan[j]), path, i + 1, dry);
      return;
    }
    current = descend(current, part as PropertyKey);
  }
  const value = path[last];
  if (i === last) {
    // The root: its object cannot be replaced (the proxy is bound to it): merge / produce / reconcile only.
    if (typeof value !== 'function' || (!dry && (value as (prev: unknown) => unknown)(current) !== current)) {
      throw new TypeError('[frameact/store] setState(value): the root cannot be replaced — use merge(), produce() or reconcile()');
    }
    return;
  }
  const part = path[last - 1] as PathPart;
  const fan = fanKeys(current, part);
  if (fan !== null) {
    for (let j = 0; j < fan.length; j++) {
      if (dry) {
        checkIndex(current, fan[j]);
        if (value === undefined && Array.isArray(current)) checkHole(current, fan[j]);
      } else applyAt(current, fan[j], value);
    }
  } else if (dry) {
    checkIndex(current, part as PropertyKey);
    if (value === undefined && Array.isArray(current)) checkHole(current, part as PropertyKey);
  } else applyAt(current, part as PropertyKey, value);
}

function setPath(root: any, path: unknown[]): void {
  let fan = false;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    if (typeof p === 'function' || Array.isArray(p)) fan = true;
  }
  if (fan) updatePath(root, path, 0, true);
  updatePath(root, path, 0, false);
}

// ---- produce ------------------------------------------------------------------------------------

/** > 0 while a produce callback runs: a draft kept past it (a closure, an await) cannot write. */
let draftDepth = 0;
function staleDraft(): boolean {
  if (DEV) throw new TypeError('[frameact/store] a produce() draft was written after produce() returned (a draft leaked past its callback): write through setState');
  return true; // production: dropped, like a write to a detached object
}
const drafts = new WeakMap<object, any>();

const asDraft = (v: unknown): unknown => (isWrappable(v) ? draftOf(v) : v);
const adoptArg = (v: unknown): unknown => (v !== null && typeof v === 'object' ? adopt(v) : v);
/** `draft.push(…)` and friends: one batched native write (see writeArray). Items come back as drafts. */
const MUTATORS: Record<string, (this: any, ...args: any[]) => unknown> = Object.assign(Object.create(null), {
  push(this: any, ...items: unknown[]) {
    const raw = draftTarget(this);
    return raw && writeArray(raw, false, () => raw.push(...items.map(adoptArg)));
  },
  pop(this: any) {
    const raw = draftTarget(this);
    return raw && asDraft(writeArray(raw, false, () => raw.pop()));
  },
  shift(this: any) {
    const raw = draftTarget(this);
    return raw && asDraft(writeArray(raw, false, () => raw.shift()));
  },
  unshift(this: any, ...items: unknown[]) {
    const raw = draftTarget(this);
    return raw && writeArray(raw, false, () => raw.unshift(...items.map(adoptArg)));
  },
  splice(this: any, ...args: unknown[]) {
    const raw = draftTarget(this);
    if (!raw) return undefined;
    const call = args.length > 2 ? [args[0], args[1], ...args.slice(2).map(adoptArg)] : args;
    const removed = writeArray(raw, true, () => (raw.splice as (...a: unknown[]) => unknown[])(...call));
    return removed.map(asDraft);
  },
  sort(this: any, compare?: (a: unknown, b: unknown) => number) {
    const raw = draftTarget(this);
    if (!raw) return undefined;
    // oxlint-disable-next-line unicorn/no-array-sort -- the point is the in-place mutation of the raw array
    writeArray(raw, true, () => raw.sort(compare === undefined ? undefined : (a, b) => compare(asDraft(a), asDraft(b))));
    return this;
  },
  reverse(this: any) {
    const raw = draftTarget(this);
    if (!raw) return undefined;
    // oxlint-disable-next-line unicorn/no-array-reverse -- in place, by design
    writeArray(raw, true, () => raw.reverse());
    return this;
  },
  fill(this: any, value: unknown, start?: number, end?: number) {
    const raw = draftTarget(this);
    if (!raw) return undefined;
    writeArray(raw, true, () => raw.fill(adoptArg(value), start, end));
    return this;
  },
  copyWithin(this: any, target: number, start: number, end?: number) {
    const raw = draftTarget(this);
    if (!raw) return undefined;
    writeArray(raw, true, () => raw.copyWithin(target, start, end));
    return this;
  },
});
/** The raw array behind the draft a mutator was called on; `null` for a stale draft (DEV: throws). */
function draftTarget(draft: any): any[] | null {
  const raw = draft?.[$RAW];
  if (!Array.isArray(raw)) throw new TypeError('[frameact/store] an array mutator was called on something that is not a produce() draft of an array');
  if (draftDepth === 0) {
    staleDraft();
    return null;
  }
  return raw;
}

const draftHandler: ProxyHandler<any> = {
  get(target, key) {
    if (key === $RAW) return target;
    const v = target[key];
    if (typeof v === 'object' && v !== null) return key === PROTO_KEY ? undefined : isWrappable(v) ? draftOf(v) : v;
    if (typeof v === 'function' && typeof key === 'string' && Array.isArray(target)) {
      const m = MUTATORS[key];
      if (m !== undefined && v === (Array.prototype as any)[key]) return m;
    }
    return v;
  },
  set(target, key, value) {
    if (draftDepth === 0) return staleDraft();
    if (key === PROTO_KEY) {
      dropProto('produce');
      return true;
    }
    setProperty(target, key, unwrap(value), false); // JS semantics: `draft[k] = undefined` stores undefined
    return true;
  },
  deleteProperty(target, key) {
    if (draftDepth === 0) return staleDraft();
    if (key === PROTO_KEY) return true;
    setProperty(target, key, undefined); // `delete draft[k]`: the key goes (an array gets a hole)
    return true;
  },
  defineProperty: readOnly,
  setPrototypeOf: readOnly,
  preventExtensions: readOnly,
};
function draftOf(raw: object): any {
  let d = drafts.get(raw);
  if (d === undefined) drafts.set(raw, (d = new Proxy(raw, draftHandler)));
  return d;
}

/**
 * Draft mutation: `setState('chats', id, produce(c => { c.title = t; c.unread++ }))`. Every
 * assignment is a leaf write (only that leaf notifies); nothing is copied, identities are kept.
 * Arrays keep JS semantics inside: `splice` shifts, `delete draft[i]` leaves a hole, `draft[i] =
 * undefined` stores the value. The draft is valid inside the callback only (a write after it returns
 * throws in DEV, is dropped in production). The value at the path must be a plain object or array: a
 * frozen value, a class instance or a primitive cannot be drafted (`TypeError`) — replace it instead.
 */
export function produce<T>(fn: (draft: T) => void): (prev: unknown) => T {
  return (prev) => {
    if (!isWrappable(prev)) {
      throw new TypeError(
        prev !== null && typeof prev === 'object' && Object.isFrozen(prev)
          ? '[frameact/store] produce(): the value at the path is frozen (an immutable value) — replace it instead'
          : '[frameact/store] produce(): the value at the path is not a plain object or array',
      );
    }
    draftDepth++;
    try {
      fn(draftOf(prev) as T);
    } finally {
      draftDepth--;
    }
    return prev as unknown as T;
  };
}

// ---- createStore --------------------------------------------------------------------------------

/**
 * The last setState argument: a value (replaces), `undefined` (deletes the key — type-checked for any
 * key, required ones too: the type system cannot tell a deletion from a value here), `merge(partial)`,
 * or an updater (produce / reconcile / your own). An updater sees the read-only view of the previous
 * value and returns the next one; returning the same object means "mutated in place" (what produce,
 * merge and reconcile do) and `l => { l.push(x); return l }` does not type-check on purpose — such a
 * mutation would not notify anybody.
 */
export type Updater<V> = V | undefined | ((prev: Store<V>) => V) | Merger<Partial<V>>;
/** A path part: a key, a readonly array of keys (fan-out), or — on arrays — an item filter. */
export type Part<T> = T extends readonly unknown[]
  ? number | readonly number[] | ((item: T[number], index: number) => boolean)
  : keyof T | readonly (keyof T)[];
export type At<T, K> = K extends readonly (infer E)[]
  ? At<T, E>
  : K extends (...a: any[]) => any
    ? T extends readonly (infer I)[]
      ? I
      : never
    : K extends keyof T
      ? T[K]
      : never;

/** Paths are typed up to 7 keys (`'messages', 'byChatId', chatId, 'byId', id, 'content', 'text'`); deeper writes use `produce` at the 7th level. */
export interface SetStoreFunction<T> {
  <
    K1 extends Part<T>, K2 extends Part<At<T, K1>>, K3 extends Part<At<At<T, K1>, K2>>, K4 extends Part<At<At<At<T, K1>, K2>, K3>>,
    K5 extends Part<At<At<At<At<T, K1>, K2>, K3>, K4>>, K6 extends Part<At<At<At<At<At<T, K1>, K2>, K3>, K4>, K5>>,
    K7 extends Part<At<At<At<At<At<At<T, K1>, K2>, K3>, K4>, K5>, K6>>,
  >(
    k1: K1, k2: K2, k3: K3, k4: K4, k5: K5, k6: K6, k7: K7, value: Updater<At<At<At<At<At<At<At<T, K1>, K2>, K3>, K4>, K5>, K6>, K7>>,
  ): void;
  <
    K1 extends Part<T>, K2 extends Part<At<T, K1>>, K3 extends Part<At<At<T, K1>, K2>>, K4 extends Part<At<At<At<T, K1>, K2>, K3>>,
    K5 extends Part<At<At<At<At<T, K1>, K2>, K3>, K4>>, K6 extends Part<At<At<At<At<At<T, K1>, K2>, K3>, K4>, K5>>,
  >(
    k1: K1, k2: K2, k3: K3, k4: K4, k5: K5, k6: K6, value: Updater<At<At<At<At<At<At<T, K1>, K2>, K3>, K4>, K5>, K6>>,
  ): void;
  <
    K1 extends Part<T>, K2 extends Part<At<T, K1>>, K3 extends Part<At<At<T, K1>, K2>>, K4 extends Part<At<At<At<T, K1>, K2>, K3>>,
    K5 extends Part<At<At<At<At<T, K1>, K2>, K3>, K4>>,
  >(
    k1: K1, k2: K2, k3: K3, k4: K4, k5: K5, value: Updater<At<At<At<At<At<T, K1>, K2>, K3>, K4>, K5>>,
  ): void;
  <K1 extends Part<T>, K2 extends Part<At<T, K1>>, K3 extends Part<At<At<T, K1>, K2>>, K4 extends Part<At<At<At<T, K1>, K2>, K3>>>(
    k1: K1, k2: K2, k3: K3, k4: K4, value: Updater<At<At<At<At<T, K1>, K2>, K3>, K4>>,
  ): void;
  <K1 extends Part<T>, K2 extends Part<At<T, K1>>, K3 extends Part<At<At<T, K1>, K2>>>(
    k1: K1, k2: K2, k3: K3, value: Updater<At<At<At<T, K1>, K2>, K3>>,
  ): void;
  <K1 extends Part<T>, K2 extends Part<At<T, K1>>>(k1: K1, k2: K2, value: Updater<At<At<T, K1>, K2>>): void;
  <K1 extends Part<T>>(k1: K1, value: Updater<At<T, K1>>): void;
  /** The root: `merge(…)`, `produce(…)` or `reconcile(…)` (the root object itself is never replaced). */
  (updater: ((prev: Store<T>) => T) | Merger<Partial<T>>): void;
}

/**
 * `[state, setState]`: `state` is a read-only tracked view of `initial` (which the store now owns and
 * mutates — it must not be frozen); writes go through `setState`. Reactivity notes: `key in obj`,
 * `Object.keys`, iteration and `length` are tracked; `Object.hasOwn`/`hasOwnProperty` are not (use
 * `in`); a getter defined on a raw object runs with the raw receiver, so its reads are not tracked —
 * derive with `createMemo` instead.
 */
export function createStore<T extends object>(initial: T): [Store<T>, SetStoreFunction<T>] {
  const raw = unwrap(initial);
  adopt(raw); // (a proxy of another store inside `initial` would break the no-proxy invariant; own `__proto__` keys go)
  if (Object.isFrozen(raw)) throw new TypeError('[frameact/store] createStore: the root object is frozen; the store owns and mutates its state');
  const node = nodes.get(raw) ?? new StoreNode(raw);
  const setState = ((...args: unknown[]) => setPath(raw, args)) as SetStoreFunction<T>;
  return [node.proxy as Store<T>, setState];
}


// ---- gate bypasses (spec §3.5 req. 6): facades with greppable names, not options -----------------

/**
 * `live(() => state.typing)`: the computation reading the store inside is marked live for this
 * compute — its store-caused runs are never parked by a heavy animation, and a live memo is delivered
 * to its readers as a plain walk (they are not parked either). For an indicator or a progress bar
 * inside an animating subtree. Controlled inputs do not need it (their bindings are never parked).
 * Note: an effect on a synchronous custom `Schedule` (`(run) => run()`) runs inside the store walk
 * itself, before the live memo is re-delivered, and may see the memo's previous value for that one
 * run (it re-runs right after); frame and tickEnd effects run after the walk and are not affected.
 */
export function live<T>(read: () => T): T {
  markLiveRead();
  return read();
}

/**
 * `ungated(() => setState(…))`: the store writes inside run plain walks (teact's
 * `forceOnHeavyAnimation`): their readers run now even inside an animating scope, and a parked
 * reader of a written leaf is unparked — it runs with the current state, every leaf included.
 */
export function ungated<T>(write: () => T): T {
  setUngatedDepth(ungatedDepth + 1);
  try {
    return write();
  } finally {
    setUngatedDepth(ungatedDepth - 1);
  }
}
