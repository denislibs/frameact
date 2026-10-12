// M1 / L1 (perf+sec review): keyed lists stay consistent when a row mapper or keyFn throws.
import { computedKeyedMap, mapArray } from '../../src/core/map';
import { signal } from '../../src/core/signals';
import { createEffect } from '../../src/core/effects';
import { onDispose, onError, root } from '../../src/core/core';

type Item = { id: string; text?: string };

let err: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  err = vi.spyOn(console, 'error').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  err.mockRestore();
  warn.mockRestore();
});

function readSafe<T>(fn: () => T): T | 'threw' {
  try {
    return fn();
  } catch {
    return 'threw';
  }
}

describe('M1: by-reference keyed map (computedKeyedMap)', () => {
  it('after a throwing item, every item still maps to its own row', () => {
    const A = { id: 'A' }, B = { id: 'B' }, C = { id: 'C' }, BAD = { id: 'BAD' };
    const $list = signal<Item[]>([A, B]);
    const rows = root(() =>
      computedKeyedMap($list, (item: Item) => {
        if (item === BAD) throw new Error('bad row');
        return `row:${item.id}`;
      }),
    );
    expect(rows()).toEqual(['row:A', 'row:B']);
    $list.set([B, BAD, A]);
    readSafe(rows);
    $list.set([B, A, C]);
    expect(rows()).toEqual(['row:B', 'row:A', 'row:C']);
  });

  it('isolates the throwing row: it maps to undefined, the error goes to onError, the others render', () => {
    const A = { id: 'A' }, BAD = { id: 'BAD' }, C = { id: 'C' };
    const $list = signal<Item[]>([A, BAD, C]);
    const handled: unknown[] = [];
    const rows = root(() => {
      onError((e) => handled.push(e));
      return computedKeyedMap($list, (item: Item) => {
        if (item === BAD) throw new Error('bad row');
        return `row:${item.id}`;
      });
    });
    expect(rows()).toEqual(['row:A', undefined, 'row:C']);
    expect(handled).toHaveLength(1);
  });

  // (Was: "is transactional: a pass that throws keeps the previous state…", with the throw injected
  // by a scheduler throwing from a write mid-pass. Since review fix round 1 a throwing scheduler is
  // the effect's reported error and never escapes a write, so the pass completes; the map's
  // transactional catch stays as a safety net, with no public way left to throw mid-pass.)
  it('a scheduler throwing from a write mid-pass does not abort the pass: rows stay consistent', () => {
    const A = { id: 'A' }, B = { id: 'B' }, C = { id: 'C' };
    const $list = signal<Item[]>([A, B]);
    const disposed: string[] = [];
    let failSchedule = false;
    const rows = root(() => {
      const map = computedKeyedMap($list, (item: Item, index) => {
        onDispose(() => disposed.push(item.id));
        // an effect on A's index whose custom scheduler throws once: the index write fails mid-pass
        if (item === A) {
          createEffect(() => index(), () => {}, (run) => {
            if (failSchedule) { failSchedule = false; throw new Error('scheduler boom'); }
            queueMicrotask(run);
          });
        }
        return `row:${item.id}`;
      });
      return map;
    });
    expect(rows()).toEqual(['row:A', 'row:B']);
    failSchedule = true;
    $list.set([C, B, A]); // A moves → the scheduler of its index effect throws during the write
    expect(readSafe(rows)).toEqual(['row:C', 'row:B', 'row:A']);
    expect(err).toHaveBeenCalled(); // reported as the effect's error
    expect(disposed).toEqual([]);
    $list.set([B, A]);
    expect(rows()).toEqual(['row:B', 'row:A']);
    expect(disposed).toEqual(['C']);
  });
});

describe('M1: keyed-by-function map (computedKeyedMapBy)', () => {
  it('a poison item neither leaks rows nor freezes the list', () => {
    const $list = signal<Item[]>([{ id: 'a', text: '0' }, { id: 'poison' }, { id: 'c', text: '0' }]);
    const mapped = vi.fn();
    const rows = root(() =>
      mapArray($list, (item: () => Item) => {
        mapped();
        if (item().id === 'poison') throw new Error('poison');
        return { get text() { return item().text; } };
      }, { keyed: (m: Item) => m.id }),
    );
    readSafe(rows);
    for (let n = 1; n <= 5; n++) {
      $list.set([{ id: 'a', text: String(n) }, { id: 'poison' }, { id: 'c', text: String(n) }]);
      readSafe(rows);
    }
    // a, poison, c once; the poison row is retried on each new poison object (N1: a failed row is
    // retried when its item changes), the healthy rows only update in place
    expect(mapped).toHaveBeenCalledTimes(3 + 5);
    const result = rows();
    expect(result[0].text).toBe('5');
    expect(result[1]).toBeUndefined();
    expect(result[2].text).toBe('5');
  });

  it('a throwing keyFn is reported and that item falls back to its index key; the list still updates', () => {
    const $list = signal<Item[]>([{ id: 'a', text: '1' }, { id: 'x' }]);
    const rows = root(() =>
      mapArray($list, (item: () => Item) => ({ get text() { return item().text ?? item().id; } }), {
        keyed: (m: Item) => {
          if (m.id === 'x') throw new Error('key boom');
          return m.id;
        },
      }),
    );
    expect(rows().map((r) => r.text)).toEqual(['1', 'x']);
    $list.set([{ id: 'a', text: '2' }, { id: 'x' }, { id: 'b', text: 'B' }]);
    expect(rows().map((r) => r.text)).toEqual(['2', 'x', 'B']);
    expect(err).toHaveBeenCalled();
  });

  // (Was "is transactional…": see the note on the keyed-by-reference test above.)
  it('a scheduler throwing from an item write mid-pass does not abort the pass: rows stay consistent', () => {
    const $list = signal<Item[]>([{ id: 'a', text: '1' }]);
    const disposed: string[] = [];
    let failSchedule = false;
    const rows = root(() =>
      mapArray($list, (item: () => Item) => {
        const id = item().id;
        onDispose(() => disposed.push(id));
        if (id === 'a') {
          createEffect(() => item(), () => {}, (run) => {
            if (failSchedule) { failSchedule = false; throw new Error('scheduler boom'); }
            queueMicrotask(run);
          });
        }
        return { get text() { return item().text; } };
      }, { keyed: (m: Item) => m.id }),
    );
    expect(rows().map((r) => r.text)).toEqual(['1']);
    failSchedule = true;
    $list.set([{ id: 'n', text: 'new' }, { id: 'a', text: '2' }]); // a's item write: scheduler throws
    const r = readSafe(rows);
    expect(r === 'threw' ? r : r.map((x) => x.text)).toEqual(['new', '2']);
    expect(err).toHaveBeenCalled();
    expect(disposed).toEqual([]);
    $list.set([{ id: 'a', text: '3' }, { id: 'm', text: 'm' }]);
    expect(rows().map((r) => r.text)).toEqual(['3', 'm']);
    expect(disposed).toEqual(['n']);
  });
});

describe('L1: duplicate-key fallback cannot collide with a real key', () => {
  it("an item whose key is the string '__index#2' never shares a row with a duplicate at position 2", () => {
    const $list = signal<Item[]>([{ id: 'a' }, { id: 'b' }, { id: 'a', text: 'dup' }]);
    const created: string[] = [];
    const rows = root(() =>
      mapArray($list, (item: () => Item) => {
        created.push(item().text ?? item().id);
        return { get label() { return item().text ?? item().id; } };
      }, { keyed: (m: Item) => m.id }),
    );
    const before = rows();
    expect(before.map((r) => r.label)).toEqual(['a', 'b', 'dup']);
    $list.set([{ id: 'a' }, { id: 'b' }, { id: '__index#2' }]);
    const after = rows();
    expect(after.map((r) => r.label)).toEqual(['a', 'b', '__index#2']);
    expect(after[2]).not.toBe(before[2]);
    expect(created).toEqual(['a', 'b', 'dup', '__index#2']);
  });
});
