// P1 (perf review): child removal is linear — no per-child indexOf/splice on the parent's array.
import { getScope, onDispose, root } from '../../src/core/core';
import { SCOPE } from '../../src/core/symbols';
import { mapArray } from '../../src/core/map';
import { signal } from '../../src/core/signals';
import type { Computation, Scope } from '../../src/core/types';

function spyIndexOf(children: unknown) {
  const arr = children as unknown[];
  const spy = vi.fn(Array.prototype.indexOf);
  Object.defineProperty(arr, 'indexOf', { value: spy, configurable: true });
  return spy;
}

it('disposing a scope with 10 000 children never searches its children array', () => {
  const order: number[] = [];
  let scope!: Scope;
  const dispose = root((d) => {
    scope = getScope()!;
    for (let i = 0; i < 10_000; i++) {
      root(() => onDispose(() => order.push(i)));
    }
    return d;
  });
  expect(Array.isArray(scope._children)).toBe(true);
  const indexOf = spyIndexOf(scope._children);
  dispose();
  expect(indexOf).not.toHaveBeenCalled();
  // children before self, reverse creation order
  expect(order).toHaveLength(10_000);
  expect(order[0]).toBe(9_999);
  expect(order[9_999]).toBe(0);
});

it('disposing a single child still detaches it from its parent', () => {
  let owner!: Scope;
  let disposeMiddle!: () => void;
  root(() => {
    owner = getScope()!;
    root(() => {});
    disposeMiddle = root((d) => d);
    root(() => {});
  });
  const [first, middle, last] = owner._children as Scope[];
  disposeMiddle();
  expect(owner._children).toEqual([first, last]);
  expect(middle[SCOPE]).toBeNull();
});

it('mass removal from a keyed-by-function list keeps exactly the surviving rows, in order, without indexOf', () => {
  type Row = { id: number };
  const items: Row[] = Array.from({ length: 2_000 }, (_, id) => ({ id }));
  const $list = signal(items);
  let mapScope!: Scope;
  const rows = root(() => {
    const owner = getScope()!;
    const r = mapArray($list, (item: () => Row) => item().id, { keyed: (m: Row) => m.id });
    mapScope = (owner._children as Scope[])[0]; // the map's row scope is created first
    return r;
  });
  expect(rows()).toHaveLength(2_000);
  const indexOf = spyIndexOf(mapScope._children);
  const survivors = items.filter((m) => m.id % 3 === 0);
  $list.set(survivors);
  expect(rows()).toEqual(survivors.map((m) => m.id));
  expect(indexOf).not.toHaveBeenCalled();
  const children = mapScope._children as Computation<Row>[];
  expect(children.map((c) => c._value.id)).toEqual(survivors.map((m) => m.id));
});

it('mass removal from a by-reference list keeps exactly the surviving rows, in order, without indexOf', () => {
  type Row = { id: number };
  const items: Row[] = Array.from({ length: 2_000 }, (_, id) => ({ id }));
  const $list = signal(items);
  let mapScope!: Scope;
  const rows = root(() => {
    const owner = getScope()!;
    const r = mapArray($list, (item: Row) => item.id);
    mapScope = (owner._children as Scope[])[0];
    return r;
  });
  expect(rows()).toHaveLength(2_000);
  const indexOf = spyIndexOf(mapScope._children);
  const survivors = items.filter((m) => m.id % 3 === 0);
  $list.set(survivors);
  expect(rows()).toEqual(survivors.map((m) => m.id));
  expect(indexOf).not.toHaveBeenCalled();
  // by-reference rows are index nodes: after the pass each holds its new position
  const children = mapScope._children as Computation<number>[];
  expect(children.map((c) => c._value)).toEqual(survivors.map((_, j) => j));
});
