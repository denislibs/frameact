// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
// Adapted from: https://github.com/solidjs/solid/blob/main/packages/solid/src/reactive/array.ts#L153

import { DEV } from '../env';
import { compute, createComputation, createScope, dispose, disposeChildren, handleError, read, scoped, write } from './core';
import { TRACK } from './symbols';
import type { Computation, Maybe, ReadSignal, Scope } from './types';

export * from './selector';

/**
 * frameact (zombie rows): the rows' owner scope points at its map memo, so a row's run pulls a dirty
 * map first (effects.ts, ancestor rule) — a row whose item or id is gone is disposed, not run.
 */
function linkMap<T>(scope: Scope, node: Computation<T>): ReadSignal<T> {
  scope._mapMemo = node;
  return read.bind(node) as ReadSignal<T>;
}

/**
 * Reactive map helper that caches each item by index to reduce unnecessary mapping on updates.
 * It only runs the mapping function once per item and adds/removes as needed. In a non-keyed map
 * like this the index is fixed but value can change (opposite of a keyed map).
 *
 * Prefer `computedKeyedMap` when referential checks are required.
 *
 * @see {@link https://github.com/maverick-js/signals#computedmap}
 */
export function computedMap<Item, MappedItem>(
  list: ReadSignal<Maybe<readonly Item[]>>,
  map: (value: ReadSignal<Item>, index: number) => MappedItem,
  options?: { id?: string },
): ReadSignal<MappedItem[]> {
  const scope = createScope();
  return linkMap(
    scope,
    createComputation<MappedItem[]>(
      [],
      updateMap.bind({
        _scope: scope,
        _len: 0,
        _list: list,
        _items: [],
        _map: map,
        _mappings: [],
        _nodes: [],
      }),
      options,
    ),
  );
}

function updateMap<Item, MappedItem>(this: MapData<Item, MappedItem>): any[] {
  const newItems = this._list() || [];

  // Patch (frameact): transactional + per-row isolation, like the keyed modes. The vendored
  // version ran the mapper unisolated and committed `_items/_len` last, so one throwing row emptied
  // the whole list and left the rows created in that pass undisposed. Now a throwing mapper is
  // reported through its row and maps to `undefined` (mapRow); the pass builds new arrays in locals
  // and commits them only when it completes.
  scoped(() => {
    const newLen = newItems.length,
      oldLen = this._len;

    if (newLen === 0) {
      if (oldLen !== 0) {
        dispose.call(this._scope, false);
        this._items = [];
        this._mappings = [];
        this._len = 0;
        this._nodes = [];
      }

      return;
    }

    const oldItems = this._items,
      mappings: MappedItem[] = new Array(newLen),
      nodes: Computation<Item>[] = new Array(newLen);
    let created: Computation[] | null = null,
      retired: Computation[] | null = null;

    try {
      for (let i = 0; i < newLen; i++) {
        if (i < oldLen) {
          const node = this._nodes[i];
          if (oldItems[i] === newItems[i]) {
            nodes[i] = node;
            mappings[i] = this._mappings[i];
            continue;
          }
          // A row whose mapper failed is retried with the new item (otherwise the slot would stay
          // empty for every future item at this position); the failed row is retired at commit.
          if (!failedRows.has(node)) {
            nodes[i] = node;
            mappings[i] = this._mappings[i];
            write.call(node, newItems[i]);
            continue;
          }
          (retired ??= []).push(node);
        }
        const node = createComputation<Item>(newItems[i], null), // owned by this._scope
          index = i;
        (created ??= []).push(node);
        nodes[i] = node;
        mappings[i] = mapRow(node, () => this._map(read.bind(node), index)) as MappedItem;
      }
    } catch (error) {
      // Unreachable by design (mappers are isolated, writes never throw); safety net so the rows
      // created in this pass cannot leak and the previous state stays consistent.
      if (created) disposeChildren(this._scope, created);
      throw error;
    }

    if (retired) disposeChildren(this._scope, retired);
    if (newLen < oldLen) disposeChildren(this._scope, this._nodes.slice(newLen, oldLen));

    this._nodes = nodes;
    this._mappings = mappings;
    this._items = newItems.slice(0);
    this._len = newLen;
  }, this._scope);

  return this._mappings;
}

// Adapted from: https://github.com/solidjs/solid/blob/main/packages/solid/src/reactive/array.ts#L16
/**
 * Reactive map helper that caches each list item by reference to reduce unnecessary mapping on
 * updates. It only runs the mapping function once per item and then moves or removes it as needed. In
 * a keyed map like this the value is fixed but the index changes (opposite of non-keyed map).
 *
 * Prefer `computedMap` when working with primitives to avoid unncessary re-renders.
 *
 * @see {@link https://github.com/maverick-js/signals#computedkeyedmap}
 */
export function computedKeyedMap<Item, MappedItem>(
  list: ReadSignal<Maybe<readonly Item[]>>,
  map: (value: Item, index: ReadSignal<number>) => MappedItem,
  options?: { id?: string },
): ReadSignal<MappedItem[]> {
  const scope = createScope();
  return linkMap(
    scope,
    createComputation<MappedItem[]>(
      [],
      updateKeyedMap.bind({
        _scope: scope,
        _len: 0,
        _list: list,
        _items: [],
        _map: map,
        _mappings: [],
        _nodes: [],
      }),
      options,
    ),
  );
}

function updateKeyedMap<Item, MappedItem>(this: KeyedMapData<Item, MappedItem>): any[] {
  const newItems = this._list() || [];

  // Patch (frameact): transactional. The pass builds new arrays in locals and commits them only
  // when it completes; a throw disposes the rows created in this pass and keeps the previous state
  // (the vendored version mutated `_mappings/_nodes` in place and updated `_items` last, so one
  // throw left rows rendering other items' content). Each row's mapper is isolated (mapRow).
  scoped(() => {
    const newLen = newItems.length,
      oldLen = this._len;

    // fast path for empty arrays
    if (newLen === 0) {
      if (oldLen !== 0) {
        dispose.call(this._scope, false);
        this._nodes = [];
        this._items = [];
        this._mappings = [];
        this._len = 0;
      }
      return;
    }

    const oldItems = this._items,
      oldMappings = this._mappings,
      oldNodes = this._nodes,
      mappings: MappedItem[] = new Array(newLen),
      nodes: Computation<number>[] = new Array(newLen),
      created: Computation[] = [];
    let removed: Computation[] | null = null,
      start = 0,
      end = oldLen - 1,
      newEnd = newLen - 1;

    try {
      if (oldLen !== 0) {
        // skip common prefix
        for (const min = Math.min(oldLen, newLen); start < min && oldItems[start] === newItems[start]; start++) {
          mappings[start] = oldMappings[start];
          nodes[start] = oldNodes[start];
        }

        // common suffix
        for (; end >= start && newEnd >= start && oldItems[end] === newItems[newEnd]; end--, newEnd--) {
          mappings[newEnd] = oldMappings[end];
          nodes[newEnd] = oldNodes[end];
        }

        // 0) a map of all indices in the new window, scanning backwards so we encounter them in natural order
        const newIndices = new Map<Item, number>(),
          newIndicesNext: number[] = new Array(newEnd + 1);
        for (let j = newEnd; j >= start; j--) {
          const item = newItems[j],
            i = newIndices.get(item);
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(item, j);
        }

        // 1) old items found in the new window keep their row; the others are removed (at commit)
        for (let i = start; i <= end; i++) {
          const item = oldItems[i],
            j = newIndices.get(item);
          if (j !== undefined && j !== -1) {
            mappings[j] = oldMappings[i];
            nodes[j] = oldNodes[i];
            newIndices.set(item, newIndicesNext[j]);
          } else (removed ??= []).push(oldNodes[i]);
        }
      }

      // 2) create the rows that are new
      for (let j = start; j <= newEnd; j++) {
        if (nodes[j] !== undefined) continue;
        const item = newItems[j],
          node = createComputation(j, null); // owned by this._scope
        created.push(node);
        nodes[j] = node;
        // the index accessor is always passed (one bind per row): the row node already is the index
        // signal, and a `map.length`-based opt-out breaks `(item, ...rest)` / default-parameter mappers
        mappings[j] = mapRow(node, () => this._map(item, read.bind(node)));
      }

      // 3) moved rows learn their new index
      for (let j = start; j < newLen; j++) write.call(nodes[j], j);
    } catch (error) {
      // Unreachable by design: nothing called inside throws since baac2ff/f545539 (keyFn and
      // mappers are isolated, writes never throw — a throwing Schedule is its effect's error).
      // Safety net: keeps `_mappings`/`_nodes` consistent and the rows created in this pass from
      // leaking if a future change lets something throw here.
      disposeChildren(this._scope, created);
      throw error;
    }

    if (removed) disposeChildren(this._scope, removed);

    this._mappings = mappings;
    this._nodes = nodes;
    this._items = newItems.slice(0);
    this._len = newLen;
  }, this._scope);

  return this._mappings;
}

/**
 * Rows whose mapper threw. When the item of such a row changes it is retried (the row is disposed
 * and recreated through `mapRow`) instead of staying empty forever.
 */
const failedRows = new WeakSet<Computation>();

/**
 * frameact: runs a row's mapper under the row's owner. A throw is reported through the row
 * (onError handlers up its owner chain, else the console) and the row maps to `undefined` (the DOM
 * layer renders nothing for it); the other rows keep working.
 */
function mapRow<T>(row: Computation, fn: () => T): T | undefined {
  try {
    return compute<T>(row, fn, null);
  } catch (error) {
    failedRows.add(row);
    reportListError(row, error, 'row mapper');
    return undefined;
  }
}

function reportListError(scope: Scope, error: unknown, what: string) {
  try {
    handleError(scope, error);
  } catch (unhandled) {
    console.error(`[frameact] mapArray: ${what} failed`, unhandled);
  }
}

interface MapData<Item = any, MappedItem = any> {
  _scope: Scope;
  _len: number;
  _list: ReadSignal<Maybe<readonly Item[]>>;
  _items: Item[];
  _mappings: MappedItem[];
  _nodes: Computation<any>[];
  _map: (value: ReadSignal<any>, index: number) => any;
}

interface KeyedMapData<Item = any, MappedItem = any> {
  _scope: Scope;
  _len: number;
  _list: ReadSignal<Maybe<readonly Item[]>>;
  _items: Item[];
  _mappings: MappedItem[];
  _nodes: Computation<number>[];
  _map: (value: any, index: ReadSignal<number>) => any;
}

// ---- frameact: keyed-by-function map -----------------------------------------

interface KeyedByData<Item, Key, Mapped> {
  _scope: Scope;
  _len: number;
  _list: ReadSignal<Maybe<readonly Item[]>>;
  _keyFn: (item: Item) => Key;
  _map: (item: ReadSignal<Item>, index: ReadSignal<number>) => Mapped;
  _keys: Key[];
  _items: Item[];
  _mappings: Mapped[];
  _itemNodes: Computation<Item>[];
  _indexNodes: Computation<number>[];
  /** fallback keys for duplicates / throwing keyFn, cached per position (see indexKey) */
  _indexKeys: object[];
}

/**
 * Keyed map where identity is `keyFn(item)`, not the reference. The row's owner is its item
 * signal node: disposing it disposes everything the mapper created (the index node included).
 */
export function computedKeyedMapBy<Item, Key, Mapped>(
  list: ReadSignal<Maybe<readonly Item[]>>,
  keyFn: (item: Item) => Key,
  map: (item: ReadSignal<Item>, index: ReadSignal<number>) => Mapped,
  options?: { id?: string },
): ReadSignal<Mapped[]> {
  const scope = createScope();
  return linkMap(
    scope,
    createComputation<Mapped[]>(
      [],
      (updateKeyedMapBy<Item, Key, Mapped>).bind({
        _scope: scope,
        _len: 0,
        _list: list,
        _keyFn: keyFn,
        _map: map,
        _keys: [],
        _items: [],
        _mappings: [],
        _itemNodes: [],
        _indexNodes: [],
        _indexKeys: [],
      } satisfies KeyedByData<Item, Key, Mapped>),
      options,
    ),
  );
}

function updateKeyedMapBy<Item, Key, Mapped>(this: KeyedByData<Item, Key, Mapped>): Mapped[] {
  const newItems = this._list() || [];
  const newLen = newItems.length;
  const oldLen = this._len;
  const oldItems = this._items;
  const oldKeys = this._keys;

  // 1) Common prefix: by reference first (same reference ⇒ same key, no keyFn call), then by key.
  // The key computed where the prefix breaks is kept for the window below (keyFn runs once per item).
  const min = oldLen < newLen ? oldLen : newLen;
  let start = 0;
  let startKey: Key | undefined;
  let hasStartKey = false;
  for (; start < min; start++) {
    const item = newItems[start];
    if (item === oldItems[start]) continue;
    const key = keyOf(this, item, start);
    if (key !== oldKeys[start]) {
      startKey = key;
      hasStartKey = true;
      break;
    }
  }

  // 2) Same keys at every position (the common case: one row's item replaced): write the changed
  // item signals in place and return the previous array — downstream `insert` sees no change.
  // Nothing is allocated on this path.
  if (start === newLen && newLen === oldLen) {
    let retried: Mapped[] | null = null;
    for (let j = 0; j < newLen; j++) {
      const item = newItems[j];
      if (item !== oldItems[j]) {
        oldItems[j] = item;
        if (failedRows.has(this._itemNodes[j])) {
          // Rare path: the row's mapper failed earlier; retry it with the new item and hand
          // `insert` a new array (the mapping at `j` changed).
          retried ??= this._mappings.slice();
          const old = this._itemNodes[j];
          scoped(() => createRow(this, item, j, retried!, this._itemNodes, this._indexNodes, null), this._scope);
          disposeChildren(this._scope, [old]);
        } else write.call(this._itemNodes[j], item);
      }
    }
    if (retried !== null) this._mappings = retried;
    return this._mappings;
  }

  // Otherwise transactional like updateKeyedMap: locals first, commit at the end, rows created by
  // a pass that throws are disposed. Row mappers and keyFn are isolated.
  scoped(() => {
    if (newLen === 0) {
      if (oldLen !== 0) {
        dispose.call(this._scope, false);
        this._keys = [];
        this._items = [];
        this._mappings = [];
        this._itemNodes = [];
        this._indexNodes = [];
        this._len = 0;
      }
      return;
    }

    // 3) Common suffix, the same way.
    let end = oldLen - 1;
    let newEnd = newLen - 1;
    let endKey: Key | undefined;
    let hasEndKey = false;
    while (end >= start && newEnd >= start) {
      const item = newItems[newEnd];
      if (item !== oldItems[end]) {
        const key = newEnd === start && hasStartKey ? (startKey as Key) : keyOf(this, item, newEnd);
        if (key !== oldKeys[end]) {
          endKey = key;
          hasEndKey = true;
          break;
        }
      }
      end--;
      newEnd--;
    }

    const mappings: Mapped[] = new Array(newLen);
    const itemNodes: Computation<Item>[] = new Array(newLen);
    const indexNodes: Computation<number>[] = new Array(newLen);
    const keys: Key[] = new Array(newLen);
    const created: Computation[] = [];
    let removed: Computation[] | null = null;

    for (let j = 0; j < start; j++) {
      mappings[j] = this._mappings[j];
      itemNodes[j] = this._itemNodes[j];
      indexNodes[j] = this._indexNodes[j];
      keys[j] = oldKeys[j];
    }
    for (let j = newEnd + 1, i = end + 1; j < newLen; j++, i++) {
      mappings[j] = this._mappings[i];
      itemNodes[j] = this._itemNodes[i];
      indexNodes[j] = this._indexNodes[i];
      keys[j] = oldKeys[i];
    }

    try {
      // 4) The changed window [start, newEnd] (new) vs [start, end] (old): Map/Set only for it.
      // Duplicates are resolved within the window (a duplicate of an unchanged prefix/suffix key
      // gets its own row; identity for duplicate keys is best-effort, as in teact).
      if (newEnd >= start) {
        let oldIndexByKey: Map<Key, number> | null = null;
        let kept: Uint8Array | null = null;
        if (end >= start) {
          oldIndexByKey = new Map<Key, number>();
          kept = new Uint8Array(end - start + 1);
          for (let i = start; i <= end; i++) oldIndexByKey.set(oldKeys[i], i);
        }
        const seen = new Set<Key>();
        for (let j = start; j <= newEnd; j++) {
          let key =
            j === start && hasStartKey
              ? (startKey as Key)
              : j === newEnd && hasEndKey
                ? (endKey as Key)
                : keyOf(this, newItems[j], j);
          if (seen.has(key)) {
            if (DEV) console.warn('[frameact] mapArray: duplicate key', key, '— falling back to index');
            key = indexKey(this, j);
          }
          seen.add(key);
          keys[j] = key;
          const i = oldIndexByKey !== null ? oldIndexByKey.get(key) : undefined;
          if (i !== undefined) {
            oldIndexByKey!.delete(key); // each old row is reused at most once
            kept![i - start] = 1;
            mappings[j] = this._mappings[i];
            itemNodes[j] = this._itemNodes[i];
            indexNodes[j] = this._indexNodes[i];
          } else {
            createRow(this, newItems[j], j, mappings, itemNodes, indexNodes, created);
          }
        }
        // Old window rows that were not reused are removed (at commit).
        // (by position, not by the Map: a key duplicated in the old window maps to one row only)
        if (kept !== null) {
          for (let i = start; i <= end; i++) {
            if (!kept[i - start]) (removed ??= []).push(this._itemNodes[i]);
          }
        }
      } else if (end >= start) {
        removed = this._itemNodes.slice(start, end + 1);
      }

      // 5) Reused rows learn their new item and index (no-ops for the rows created above).
      for (let j = 0; j < newLen; j++) {
        if (itemNodes[j]._value !== newItems[j]) {
          if (failedRows.has(itemNodes[j])) {
            // the row's mapper failed earlier: retry it with the new item (old row retired at commit)
            (removed ??= []).push(itemNodes[j]);
            createRow(this, newItems[j], j, mappings, itemNodes, indexNodes, created);
            continue;
          }
          write.call(itemNodes[j], newItems[j]);
        }
        if (indexNodes[j]._value !== j) write.call(indexNodes[j], j);
      }
    } catch (error) {
      // Unreachable by design: nothing called inside throws since baac2ff/f545539 (keyFn and
      // mappers are isolated, writes never throw — a throwing Schedule is its effect's error).
      // Safety net: keeps `_mappings`/`_nodes` consistent and the rows created in this pass from
      // leaking if a future change lets something throw here.
      disposeChildren(this._scope, created);
      throw error;
    }

    if (removed !== null) disposeChildren(this._scope, removed);

    this._mappings = mappings;
    this._itemNodes = itemNodes;
    this._indexNodes = indexNodes;
    this._keys = keys;
    this._items = newItems.slice(0);
    this._len = newLen;
  }, this._scope);

  return this._mappings;
}

/** Creates row `j`: its item node owns the index node and everything the mapper creates. */
function createRow<Item, Key, Mapped>(
  data: KeyedByData<Item, Key, Mapped>,
  item: Item,
  j: number,
  mappings: Mapped[],
  itemNodes: Computation<Item>[],
  indexNodes: Computation<number>[],
  created: Computation[] | null,
) {
  const itemNode = createComputation<Item>(item, null); // owned by data._scope
  let indexNode!: Computation<number>;
  created?.push(itemNode);
  itemNodes[j] = itemNode;
  mappings[j] = mapRow(itemNode, () => {
    indexNode = createComputation<number>(j, null); // owned by the row
    return data._map(read.bind(itemNode), read.bind(indexNode));
  }) as Mapped;
  indexNodes[j] = indexNode;
}

/** `keyFn(item)`; a throw is reported and the item falls back to its index key. */
function keyOf<Item, Key, Mapped>(data: KeyedByData<Item, Key, Mapped>, item: Item, j: number): Key {
  try {
    return data._keyFn(item);
  } catch (error) {
    reportListError(data._scope, error, 'keyFn');
    return indexKey(data, j);
  }
}

/**
 * The fallback key for position `j`: a per-map cached object, so it can never collide with a real
 * key (a string like `__index#2` could) and stays stable across passes.
 */
function indexKey<Item, Key, Mapped>(data: KeyedByData<Item, Key, Mapped>, j: number): Key {
  return (data._indexKeys[j] ??= Object.freeze({ index: j })) as Key;
}

export interface MapArrayOptions<Item> {
  /** `true` (default): by reference; `false`: by index; a function: by key. */
  keyed?: boolean | ((item: Item) => unknown);
  id?: string;
}

/**
 * Reactive list mapping. `keyed: fn` is the recommended pattern for large lists (spec §3.5
 * "Стоимость", B): when every position keeps its key (one row's item replaced by a new object) the
 * changed item signals are written in place and the previous array is returned, so a downstream
 * `insert` does not reconcile; otherwise only the window between the common prefix and suffix is
 * diffed with a Map.
 *
 * Rows that read `index()` re-run whenever their position changes — on every prepend, for every
 * row after it. Message-list rows should not read `index()`.
 */
export function mapArray<Item, Mapped>(
  list: ReadSignal<Maybe<readonly Item[]>>,
  mapFn: (item: any, index: any) => Mapped,
  options: MapArrayOptions<Item> = {},
): ReadSignal<Mapped[]> {
  const keyed = options.keyed ?? true;
  // A store array (spec §3.5 req. 10): `list()[TRACK]` subscribes the map to the array's shape only
  // (one link, fired by any index/length write) and returns a plain array of item proxies, iterated
  // untracked. Item content changes reach the rows through their own leaf reads, never the map.
  // A plain array has no such key: the symbol read is a miss.
  const source = list;
  list = (() => {
    const l = source();
    if (l == null) return l;
    const items = (l as any)[TRACK];
    return items !== undefined ? items : l;
  }) as typeof list;
  if (keyed === true) return computedKeyedMap(list, mapFn, options);
  if (keyed === false) return computedMap(list, mapFn, options);
  return computedKeyedMapBy(list, keyed, mapFn, options);
}
