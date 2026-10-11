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
