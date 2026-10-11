import { mapArray } from '../../src/core/map';
import { signal } from '../../src/core/signals';
import { onDispose, root } from '../../src/core/core';

type Msg = { id: number; text: string };

it('keyed by function: a new object with the same key updates the row in place', () => {
  const $list = signal<Msg[]>([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  const created = vi.fn();
  const rows = root(() =>
    mapArray($list, (item, index) => { created(); return { get text() { return item().text; }, get index() { return index(); } }; }, { keyed: (m) => m.id }),
  );
  const [r1, r2] = rows();
  expect([r1.text, r2.text]).toEqual(['a', 'b']);
  $list.set([{ id: 1, text: 'a' }, { id: 2, text: 'B' }]); // id 2 re-created immutably
  const [n1, n2] = rows();
  expect(n1).toBe(r1);
  expect(n2).toBe(r2);           // same row object
  expect(n2.text).toBe('B');     // item() updated
  expect(created).toHaveBeenCalledTimes(2);
});

it('reorder updates index(); removal disposes the row; append creates once', () => {
  const $list = signal<Msg[]>([{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }]);
  const disposed: number[] = [];
  const rows = root(() =>
    mapArray($list, (item, index) => { onDispose(() => disposed.push(item().id)); return { get id() { return item().id; }, get index() { return index(); } }; }, { keyed: (m) => m.id }),
  );
  expect(rows().map((r) => r.index)).toEqual([0, 1, 2]);
  $list.set([$list()[2], $list()[0]]); // c, a — b removed
  expect(rows().map((r) => [r.id, r.index])).toEqual([[3, 0], [1, 1]]);
  expect(disposed).toEqual([2]);
  $list.set([...$list(), { id: 4, text: 'd' }]);
  expect(rows().map((r) => r.id)).toEqual([3, 1, 4]);
  $list.set([]);
  expect(rows()).toEqual([]);
  expect(disposed).toHaveLength(4);
  expect(new Set(disposed)).toEqual(new Set([1, 2, 3, 4]));
});

it('duplicate keys warn in DEV and fall back to the index', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const $list = signal<Msg[]>([{ id: 1, text: 'a' }, { id: 1, text: 'dup' }]);
  const rows = root(() => mapArray($list, (item) => ({ get text() { return item().text; } }), { keyed: (m) => m.id }));
  expect(rows().map((r) => r.text)).toEqual(['a', 'dup']);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

it('changing the key of the same object is remove + create', () => {
  const $list = signal<Msg[]>([{ id: 1, text: 'a' }]);
  const created = vi.fn();
  const rows = root(() => mapArray($list, (item) => { created(); return item().id; }, { keyed: (m) => m.text }));
  rows();
  $list.set([{ ...$list()[0], text: 'renamed' }]);
  rows();
  expect(created).toHaveBeenCalledTimes(2);
});

it('keyed: true (default) maps by reference; keyed: false maps by index', () => {
  const a = { id: 1 }, b = { id: 2 };
  const $list = signal([a, b]);
  const byRef = root(() => mapArray($list, (item, index) => ({ item, get i() { return index(); } })));
  expect(byRef()[1].item).toBe(b);
  const byIdx = root(() => mapArray($list, (item, index) => ({ get item() { return item(); }, index }), { keyed: false }));
  expect(byIdx()[0].index).toBe(0);
  $list.set([b, a]);
  expect(byIdx()[0].item).toBe(b);
});

// P2 (perf review): keyed-by-function fast paths.
type M = { id: number; text: string };
const make = (n: number, from = 0): M[] => Array.from({ length: n }, (_, i) => ({ id: from + i, text: `t${from + i}` }));

function setup(initial: M[]) {
  const $list = signal<M[]>(initial);
  const keyFn = vi.fn((m: M) => m.id);
  const mapper = vi.fn((item: () => M) => ({ get text() { return item().text; } }));
  const rows = root(() => mapArray($list, mapper, { keyed: keyFn }));
  rows();
  keyFn.mockClear();
  mapper.mockClear();
  return { $list, keyFn, mapper, rows };
}

describe('P2: keyed by function — fast paths', () => {
  it('one item replaced by a new object with the same key: same array, item() updated, no mapper call', () => {
    const { $list, mapper, rows } = setup(make(100));
    const before = rows();
    const next = $list().slice();
    next[42] = { id: 42, text: 'edited' };
    $list.set(next);
    const after = rows();
    expect(after).toBe(before);
    expect(after[42].text).toBe('edited');
    expect(mapper).not.toHaveBeenCalled();
  });

  it('a new array with the same items: same array, keyFn never called', () => {
    const { $list, keyFn, rows } = setup(make(100));
    const before = rows();
    $list.set($list().slice());
    expect(rows()).toBe(before);
    expect(keyFn).not.toHaveBeenCalled();
  });

  it('append 1: only the new row is created, keyFn runs once, existing rows keep identity', () => {
    const { $list, keyFn, mapper, rows } = setup(make(100));
    const before = rows();
    $list.set([...$list(), { id: 100, text: 'new' }]);
    const after = rows();
    expect(after).toHaveLength(101);
    expect(after.slice(0, 100)).toEqual(before);
    after.slice(0, 100).forEach((row, i) => expect(row).toBe(before[i]));
    expect(after[100].text).toBe('new');
    expect(mapper).toHaveBeenCalledTimes(1);
    expect(keyFn).toHaveBeenCalledTimes(1);
  });

  it('prepend 50: only the new rows are created, keyFn runs for them only, existing rows keep identity', () => {
    const { $list, keyFn, mapper, rows } = setup(make(1000));
    const before = rows();
    $list.set([...make(50, -50), ...$list()]);
    const after = rows();
    expect(after).toHaveLength(1050);
    after.slice(50).forEach((row, i) => expect(row).toBe(before[i]));
    expect(after.slice(0, 50).map((r) => r.text)).toEqual(make(50, -50).map((m) => m.text));
    expect(mapper).toHaveBeenCalledTimes(50);
    expect(keyFn).toHaveBeenCalledTimes(50);
  });

  it('a middle reorder, insert and removal stay correct', () => {
    const { $list, mapper, rows } = setup(make(10));
    const before = rows();
    const l = $list();
    // 0 1 | 5 4 new 3 | 8 9   (2, 6, 7 removed; 3..5 reordered; one inserted)
    $list.set([l[0], l[1], l[5], l[4], { id: 99, text: 'x' }, { ...l[3], text: 'three' }, l[8], l[9]]);
    const after = rows();
    expect(after.map((r) => r.text)).toEqual(['t0', 't1', 't5', 't4', 'x', 'three', 't8', 't9']);
    expect(after[2]).toBe(before[5]);
    expect(after[5]).toBe(before[3]);
    expect(after[7]).toBe(before[9]);
    expect(mapper).toHaveBeenCalledTimes(1);
  });

  it('index() follows a prepend', () => {
    const $list = signal<M[]>(make(3));
    const rows = root(() => mapArray($list, (item: () => M, index: () => number) => ({ get i() { return index(); }, get id() { return item().id; } }), { keyed: (m: M) => m.id }));
    rows();
    $list.set([...make(2, -2), ...$list()]);
    expect(rows().map((r) => [r.id, r.i])).toEqual([[-2, 0], [-1, 1], [0, 2], [1, 3], [2, 4]]);
  });
});

it('P2: a key duplicated across the unchanged prefix and the changed window never leaks a row', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const A = { id: 1, text: 'a' }, B = { id: 2, text: 'b' }, X = { id: 1, text: 'x' };
  const $list = signal<M[]>([A, B]);
  let live = 0;
  const rows = root(() =>
    mapArray($list, (item: () => M) => { live++; onDispose(() => live--); return { get text() { return item().text; } }; }, { keyed: (m: M) => m.id }),
  );
  rows();
  $list.set([A, X, B]);           // X duplicates A's key, inserted in the window
  expect(rows().map((r) => r.text)).toEqual(['a', 'x', 'b']);
  $list.set([{ id: 9, text: 'z' }, { id: 1, text: 'a2' }, { id: 1, text: 'x2' }]); // both dups in one old window
  expect(rows().map((r) => r.text)).toEqual(['z', 'a2', 'x2']);
  expect(live).toBe(3);
  $list.set([B]);
  expect(rows().map((r) => r.text)).toEqual(['b']);
  expect(live).toBe(1);
  warn.mockRestore();
});
