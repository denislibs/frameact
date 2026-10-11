// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
// Adapted from: https://github.com/solidjs/solid/blob/main/packages/solid/src/reactive/array.ts#L153

import { DEV } from '../env';
import { compute, createComputation, createScope, dispose, handleError, read, scoped, write } from './core';
import type { Computation, Maybe, ReadSignal, Scope } from './types';

export * from './selector';

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
  return read.bind(
    createComputation<MappedItem[]>(
      [],
      updateMap.bind({
        _scope: createScope(),
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
  let i = 0,
    newItems = this._list() || [],
    mapper = () => this._map(read.bind(this._nodes[i]), i);

  scoped(() => {
    if (newItems.length === 0) {
      if (this._len !== 0) {
        dispose.call(this._scope, false);
        this._items = [];
        this._mappings = [];
        this._len = 0;
        this._nodes = [];
      }

      return;
    }

    for (i = 0; i < newItems.length; i++) {
      if (i < this._items.length && this._items[i] !== newItems[i]) {
        write.call(this._nodes[i], newItems[i]);
      } else if (i >= this._items.length) {
        this._mappings[i] = compute<MappedItem>(
          (this._nodes[i] = createComputation(newItems[i], null)),
          mapper,
          null,
        );
      }
    }

    for (; i < this._items.length; i++) dispose.call(this._nodes[i]);

    this._len = this._nodes.length = newItems.length;
    this._items = newItems.slice(0);
    this._mappings = this._mappings.slice(0, this._len);
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
  return read.bind(
    createComputation<MappedItem[]>(
      [],
      updateKeyedMap.bind({
        _scope: createScope(),
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
  const newItems = this._list() || [],
    indexed = this._map.length > 1;

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
        mappings[j] = mapRow(
          node,
          indexed
            ? () => this._map(item, read.bind(node))
            : () => (this._map as (value: Item) => MappedItem)(item),
        );
      }

      // 3) moved rows learn their new index
      for (let j = start; j < newLen; j++) write.call(nodes[j], j);
    } catch (error) {
      for (let k = 0; k < created.length; k++) dispose.call(created[k]);
      throw error;
    }

    if (removed) for (let k = 0; k < removed.length; k++) dispose.call(removed[k]);

    this._mappings = mappings;
    this._nodes = nodes;
    this._items = newItems.slice(0);
    this._len = newLen;
  }, this._scope);

  return this._mappings;
}

/**
 * frameact: runs a row's mapper under the row's owner. A throw is reported through the row
 * (onError handlers up its owner chain, else the console) and the row maps to `undefined` (the DOM
 * layer renders nothing for it); the other rows keep working.
 */
function mapRow<T>(row: Computation, fn: () => T): T | undefined {
  try {
    return compute<T>(row, fn, null);
  } catch (error) {
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
  return read.bind(
    createComputation<Mapped[]>(
      [],
      (updateKeyedMapBy<Item, Key, Mapped>).bind({
        _scope: createScope(),
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

  // Transactional like updateKeyedMap: locals first, commit at the end, rows created by a pass
  // that throws are disposed. Row mappers and keyFn are isolated.
  scoped(() => {
    if (newLen === 0) {
      if (this._len !== 0) {
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

    // Resolve keys; a duplicate falls back to an index key (like teact's `key` handling).
    const newKeys: Key[] = new Array(newLen);
    const seen = new Set<Key>();
    for (let j = 0; j < newLen; j++) {
      let key = keyOf(this, newItems[j], j);
      if (seen.has(key)) {
        if (DEV) console.warn('[frameact] mapArray: duplicate key', key, '— falling back to index');
        key = indexKey(this, j);
      }
      seen.add(key);
      newKeys[j] = key;
    }

    const oldLen = this._len;
    const oldIndexByKey = new Map<Key, number>();
    for (let i = 0; i < oldLen; i++) oldIndexByKey.set(this._keys[i], i);

    const mappings: Mapped[] = new Array(newLen);
    const itemNodes: Computation<Item>[] = new Array(newLen);
    const indexNodes: Computation<number>[] = new Array(newLen);
    const kept = new Uint8Array(oldLen);
    const created: Computation[] = [];

    try {
      for (let j = 0; j < newLen; j++) {
        const i = oldIndexByKey.get(newKeys[j]);
        if (i !== undefined && !kept[i]) {
          kept[i] = 1;
          mappings[j] = this._mappings[i];
          itemNodes[j] = this._itemNodes[i];
          indexNodes[j] = this._indexNodes[i];
        } else {
          createRow(this, newItems[j], j, mappings, itemNodes, indexNodes, created);
        }
      }

      // Reused rows learn their new item and index (no-ops for the rows created above).
      for (let j = 0; j < newLen; j++) {
        if (itemNodes[j]._value !== newItems[j]) write.call(itemNodes[j], newItems[j]);
        if (indexNodes[j]._value !== j) write.call(indexNodes[j], j);
      }
    } catch (error) {
      for (let k = 0; k < created.length; k++) dispose.call(created[k]);
      throw error;
    }

    for (let i = 0; i < oldLen; i++) if (!kept[i]) dispose.call(this._itemNodes[i]);

    this._mappings = mappings;
    this._itemNodes = itemNodes;
    this._indexNodes = indexNodes;
    this._keys = newKeys;
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
  created: Computation[],
) {
  const itemNode = createComputation<Item>(item, null); // owned by data._scope
  let indexNode!: Computation<number>;
  created.push(itemNode);
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

export function mapArray<Item, Mapped>(
  list: ReadSignal<Maybe<readonly Item[]>>,
  mapFn: (item: any, index: any) => Mapped,
  options: MapArrayOptions<Item> = {},
): ReadSignal<Mapped[]> {
  const keyed = options.keyed ?? true;
  if (keyed === true) return computedKeyedMap(list, mapFn, options);
  if (keyed === false) return computedMap(list, mapFn, options);
  return computedKeyedMapBy(list, keyed, mapFn, options);
}
