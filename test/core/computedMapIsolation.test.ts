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

  it('owners of rows from a pass with a throwing row are disposed on recovery (probe P1b)', () => {
    let created = 0,
      cleaned = 0;
    const $list = signal(['ok', 'boom', 'ok2']);
    const rows = root(() =>
      mapArray(
        $list,
        (item: () => string) => {
          created++;
          onDispose(() => cleaned++);
          if (item() === 'boom') throw new Error('boom');
          return item();
        },
        { keyed: false },
      ),
    );
    expect(rows()).toEqual(['ok', undefined, 'ok2']);
    expect(created).toBe(3);
    // the shape shrinks: every row created in the failed pass (including the throwing one) is disposed
    $list.set([]);
    expect(rows()).toEqual([]);
    expect(cleaned).toBe(created);
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

describe('computedKeyedMap index argument', () => {
  it('index accessor is passed even to mappers declared with fewer params / rest params', () => {
    const $list = signal(['a', 'b']);
    const rows = root(() => mapArray($list, (...args: any[]) => args.length, { keyed: true }));
    expect(rows()).toEqual([2, 2]);
  });
});
