// I1 (Task 4 review): the by-index map (`keyed: false`) isolates a throwing row like the keyed modes.
import { computedMap, mapArray } from '../../src/core/map';
import { signal } from '../../src/core/signals';
import { onDispose, root } from '../../src/core/core';

let err: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  err = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => err.mockRestore());

describe('computedMap row isolation', () => {
  it('a throwing mapper affects only its row; the others map, the failure is reported', () => {
    const $list = signal(['ok', 'boom', 'ok2']);
    const rows = root(() =>
      computedMap($list, (item, i) => {
        if (item() === 'boom') throw new Error('boom');
        return `${i}:${item()}`;
      }),
    );
    expect(rows()).toEqual(['0:ok', undefined, '2:ok2']);
    expect(err).toHaveBeenCalled();
  });

  it('after a pass with a throwing row in the middle, a partial shrink disposes exactly the dropped rows', () => {
    const alive = new Set<number>();
    let id = 0;
    const $list = signal(['A', 'X']);
    const rows = root(() =>
      mapArray(
        $list,
        (item: () => string) => {
          const me = id++;
          alive.add(me);
          onDispose(() => alive.delete(me));
          if (item() === 'boom') throw new Error('boom');
          return item();
        },
        { keyed: false },
      ),
    );
    expect(rows()).toEqual(['A', 'X']);
    $list.set(['A', 'X', 'b', 'boom', 'c']);
    expect(rows()).toEqual(['A', 'X', 'b', undefined, 'c']);
    expect(alive.size).toBe(5);
    $list.set(['z']);
    expect(rows()).toEqual(['A']); // the row keeps its mapped value; only the item signal changed
    expect([...alive]).toEqual([0]); // only the first row survives
  });

  it('after a throwing row, a later pass keeps the surviving rows and updates in place', () => {
    let created = 0;
    const $list = signal(['a', 'boom']);
    const rows = root(() =>
      computedMap($list, (item) => {
        created++;
        if (item() === 'boom') throw new Error('boom');
        return () => item();
      }),
    );
    const first = rows()[0];
    $list.set(['A', 'boom', 'c']);
    expect(rows()[0]).toBe(first);
    expect((first as () => string)()).toBe('A');
    expect(created).toBe(3);
  });

  it('shrinking disposes only the dropped rows', () => {
    let cleaned = 0;
    const $list = signal(['a', 'b', 'c']);
    const rows = root(() =>
      computedMap($list, (item) => {
        const v = item();
        onDispose(() => cleaned++);
        return v;
      }),
    );
    expect(rows()).toEqual(['a', 'b', 'c']);
    $list.set(['a']);
    expect(rows()).toEqual(['a']);
    expect(cleaned).toBe(2);
  });
});

const textOf = (v: string | { text: string }) => (typeof v === 'string' ? v : v.text);

const mapper = (item: () => string | { text: string }) => {
  if (textOf(item()) === 'boom') throw new Error('boom');
  return () => textOf(item());
};

describe('a row whose mapper failed is retried when its item changes (N1)', () => {
  it('keyed: false: the slot renders the next item', () => {
    const $list = signal(['ok', 'boom']);
    const rows = root(() => mapArray($list, (item: () => string) => mapper(item), { keyed: false }));
    expect(rows().map((r) => r?.())).toEqual(['ok', undefined]);
    $list.set(['ok', 'fine']);
    expect(rows().map((r) => r?.())).toEqual(['ok', 'fine']);
  });

  it('keyed: false: the slot of a failed row in the middle is retried too, and the old owner is disposed', () => {
    let cleaned = 0;
    const $list = signal(['ok', 'boom', 'ok2']);
    const rows = root(() =>
      mapArray(
        $list,
        (item: () => string) => {
          onDispose(() => cleaned++);
          return mapper(item);
        },
        { keyed: false },
      ),
    );
    expect(rows().map((r) => r?.())).toEqual(['ok', undefined, 'ok2']);
    $list.set(['a', 'b', 'c']);
    expect(rows().map((r) => r?.())).toEqual(['a', 'b', 'c']);
    expect(cleaned).toBe(1); // the failed row only
  });

  it('keyed: fn: an edited item with the same key renders the row (fast path returns a new array)', () => {
    const $list = signal([{ id: 1, text: 'a' }, { id: 2, text: 'boom' }]);
    const rows = root(() => mapArray($list, mapper as any, { keyed: (i: { id: number }) => i.id }));
    const before = rows();
    expect(before.map((r: any) => r?.())).toEqual(['a', undefined]);
    $list.set([{ id: 1, text: 'a' }, { id: 2, text: 'fixed' }]);
    const after = rows();
    expect(after).not.toBe(before);
    expect(after.map((r: any) => r?.())).toEqual(['a', 'fixed']);
    // healthy rows still update in place without a new array
    $list.set([{ id: 1, text: 'a' }, { id: 2, text: 'fixed2' }]);
    expect(rows()).toBe(after);
    expect(rows().map((r: any) => r?.())).toEqual(['a', 'fixed2']);
  });

  it('keyed: fn: a failed row reused by key in a reordering pass is retried', () => {
    const $list = signal([{ id: 1, text: 'a' }, { id: 2, text: 'boom' }]);
    const rows = root(() => mapArray($list, mapper as any, { keyed: (i: { id: number }) => i.id }));
    expect(rows().map((r: any) => r?.())).toEqual(['a', undefined]);
    $list.set([{ id: 2, text: 'fixed' }, { id: 1, text: 'a' }]);
    expect(rows().map((r: any) => r?.())).toEqual(['fixed', 'a']);
  });

  it('keyed by reference: a new object at a failed position renders', () => {
    const bad = { text: 'boom' };
    const good = { text: 'good' };
    const $list = signal([bad]);
    const rows = root(() => mapArray($list, (item: { text: string }) => mapper(() => item), { keyed: true }));
    expect(rows().map((r: any) => r?.())).toEqual([undefined]);
    $list.set([good]);
    expect(rows().map((r: any) => r?.())).toEqual(['good']);
  });
});

describe('computedKeyedMap index argument', () => {
  it('index accessor is passed even to mappers declared with fewer params / rest params', () => {
    const $list = signal(['a', 'b']);
    const rows = root(() => mapArray($list, (...args: any[]) => args.length, { keyed: true }));
    expect(rows()).toEqual([2, 2]);
  });
});
