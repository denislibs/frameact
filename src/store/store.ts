// frameact/store — model B, the "signal-way" tree store (spec §3.5), in the spirit of Solid's
// createStore (MIT, © 2016-2025 Ryan Carniato). State is a tree of plain objects and arrays; every
// property becomes a slim core signal lazily, on its first TRACKED read; a path write mutates the raw
// object in place and notifies that leaf only. No service fields on user objects: the per-object
// bookkeeping (proxy, leaf signals, shape signal) lives in a WeakMap'd StoreNode, which is also the
// Proxy handler of that object (the traps reach its fields through `this`: no lookup on the read path).
import { DEV } from '../env';
import { createSignalNode, getObserver, trackNode, writeStoreNode } from '../core/core';
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
  if (Array.isArray(v)) return true;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
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

  constructor(raw: object) {
    this.raw = raw;
    this.sigs = null;
    this.self = null;
    this.shape = 0;
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
    if (getObserver() !== null && typeof key !== 'symbol' && (typeof value !== 'function' || Object.hasOwn(target, key))) {
      trackKey(this, key, value);
    }
    if (typeof value === 'object' && value !== null) return wrap(value);
    return value;
  }

  has(target: any, key: PropertyKey): boolean {
    if (getObserver() !== null && typeof key !== 'symbol') trackKey(this, key, target[key]);
    return key in target;
  }

  ownKeys(target: any): ArrayLike<string | symbol> {
    trackSelf(this);
    return Reflect.ownKeys(target);
  }

  getOwnPropertyDescriptor(target: any, key: PropertyKey): PropertyDescriptor | undefined {
    const desc = Reflect.getOwnPropertyDescriptor(target, key);
    if (!desc || desc.get || desc.set || !desc.configurable) return desc;
    // An accessor: Object.keys / spread check enumerability without reading (tracking) the value.
    const proxy = this.proxy;
    delete desc.value;
    delete desc.writable;
    desc.get = () => proxy[key];
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
}

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
 * unwrapped deeply — O(its new part): the walk stops at objects already in the tree (raw by the
 * invariant) and at values. A cyclic NEW object graph is not supported (infinite recursion).
 */
function adopt(v: object): object {
  const r = (v as any)[$RAW];
  if (r !== undefined) return r; // a store proxy or a produce draft
  if (nodes.has(v) || !isWrappable(v)) return v;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  for (let i = 0; i < keys.length; i++) {
    const c = o[keys[i]];
    if (c !== null && typeof c === 'object') {
      const a = adopt(c);
      if (a !== c) o[keys[i]] = a;
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
  if (value !== null && typeof value === 'object') value = adopt(value);
  const prev = raw[key];
  const had = prev !== undefined || Object.hasOwn(raw, key);
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
    const keys = Object.keys(next);
    for (let i = 0; i < keys.length; i++) setProperty(prev, keys[i], next[keys[i]]);
    return prev;
  }) as unknown as Merger<P>;
}

type PathPart = PropertyKey | readonly PropertyKey[] | ((item: any, index: number) => boolean);

/** Apply the last argument of setState at `parent[key]`: a value replaces, `undefined` deletes a key, an updater runs first. */
function applyAt(parent: any, key: PropertyKey, value: unknown): void {
  if (typeof value === 'function') {
    const prev = parent[key];
    value = (value as (prev: unknown) => unknown)(prev);
    if (value === prev) return; // merge / produce / reconcile mutated in place
  }
  if (value === undefined && Array.isArray(parent)) {
    // A hole is never what is wanted (For renders an undefined item, JSON turns it into null).
    throw new TypeError(`[frameact/store] setState(…, ${String(key)}, undefined): use produce(a => a.splice(i, 1)) to remove an item`);
  }
  setProperty(parent, key, unwrap(value));
}

function fanOut(current: any, part: PathPart, apply: (key: PropertyKey) => void): boolean {
  if (Array.isArray(part)) {
    for (let j = 0; j < part.length; j++) apply(part[j]);
    return true;
  }
  if (typeof part === 'function') {
    if (!Array.isArray(current)) throw new TypeError('[frameact/store] a filter function in a path selects items of an array');
    for (let j = 0; j < current.length; j++) if (part(current[j], j)) apply(j);
    return true;
  }
  return false;
}

/** Walk `path` (the setState arguments) from `current`; iterative over plain keys, recursive only where a part fans out. */
function updatePath(current: any, path: unknown[], i: number): void {
  const last = path.length - 1; // the value
  for (; i < last - 1; i++) {
    const part = path[i] as PathPart;
    if (fanOut(current, part, (key) => updatePath(current[key], path, i + 1))) return;
    current = current[part as PropertyKey];
    if (current === null || typeof current !== 'object') {
      throw new TypeError(`[frameact/store] setState: nothing to descend into at "${String(part)}" (${String(current)})`);
    }
  }
  const value = path[last];
  if (i === last) {
    // The root: its object cannot be replaced (the proxy is bound to it): merge / produce / reconcile only.
    if (typeof value !== 'function' || (value as (prev: unknown) => unknown)(current) !== current) {
      throw new TypeError('[frameact/store] setState(value): the root cannot be replaced — use merge(), produce() or reconcile()');
    }
    return;
  }
  const part = path[last - 1] as PathPart;
  if (fanOut(current, part, (key) => applyAt(current, key, value))) return;
  applyAt(current, part as PropertyKey, value);
}

// ---- produce ------------------------------------------------------------------------------------

const drafts = new WeakMap<object, any>();
const draftHandler: ProxyHandler<any> = {
  get(target, key) {
    if (key === $RAW) return target;
    const v = target[key];
    return isWrappable(v) ? draftOf(v) : v;
  },
  set(target, key, value) {
    setProperty(target, key, unwrap(value), false); // JS semantics: `draft[k] = undefined` stores undefined
    return true;
  },
  deleteProperty(target, key) {
    setProperty(target, key, undefined); // `delete draft[k]`: the key goes (an array gets a hole)
    return true;
  },
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
 * undefined` stores the value. A frozen value cannot be drafted (DEV `TypeError`): replace it.
 */
export function produce<T>(fn: (draft: T) => void): (prev: unknown) => T {
  return (prev) => {
    if (isWrappable(prev)) fn(draftOf(prev) as T);
    else if (DEV && prev !== null && typeof prev === 'object' && Object.isFrozen(prev)) {
      throw new TypeError('[frameact/store] produce(): the value at the path is frozen (an immutable value) — replace it instead');
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
  if (Object.isFrozen(raw)) throw new TypeError('[frameact/store] createStore: the root object is frozen; the store owns and mutates its state');
  const node = nodes.get(raw) ?? new StoreNode(raw);
  const setState = ((...args: unknown[]) => updatePath(raw, args, 0)) as SetStoreFunction<T>;
  return [node.proxy as Store<T>, setState];
}
