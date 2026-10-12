// Batched array writes (perf review 2): produce()'s array mutators and reconcile's keyed rewrite write
// natively into the raw array and notify once — the shape, `length` and the changed indexes that have
// a reader — instead of once per moved index. A synchronous schedule runs an effect inside every
// notification, so its run count is the notification count.
import { createEffect, createRoot, flushSync } from '../../src/index';
import { createStore, keys, produce, reconcile, unwrap } from 'frameact/store';

const sync = (run: () => void) => run();

/** An effect on a synchronous schedule: runs once per notification that reaches it. */
function probe<T>(fn: () => T): { runs: () => number; last: () => T } {
  let runs = 0;
  let last!: T;
  createRoot(() => {
    createEffect(() => fn(), (v) => { runs++; last = v; }, sync);
  });
  return { runs: () => runs, last: () => last };
}

type Item = { id: number; text: string };
const items = (from: number, n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: from + i, text: `t${from + i}` }));

describe('draft array mutators notify once', () => {
  it('unshift(50) onto 100: the shape, length and each indexed reader run once', () => {
    const [state, setState] = createStore<{ list: Item[] }>({ list: items(100, 100) });
    const shape = probe(() => keys(state.list).length);
    const len = probe(() => state.list.length);
    const first = probe(() => state.list[0].id);
    const tail = probe(() => state.list[120]?.id);
    const [s0, l0, f0, t0] = [shape.runs(), len.runs(), first.runs(), tail.runs()];
    setState('list', produce((l: Item[]) => { l.unshift(...items(0, 50)); }));
    expect(shape.runs() - s0).toBe(1);
    expect(len.runs() - l0).toBe(1);
    expect(first.runs() - f0).toBe(1);
    expect(first.last()).toBe(0);
    expect(tail.runs() - t0).toBe(1);
    expect(tail.last()).toBe(170);
    expect(state.list.length).toBe(150);
    expect(state.list[149].id).toBe(199);
  });
  it('an index whose value did not change is not notified', () => {
    const [state, setState] = createStore<{ list: number[] }>({ list: [1, 2, 3] });
    const a = probe(() => state.list[0]);
    const b = probe(() => state.list[2]);
    const [a0, b0] = [a.runs(), b.runs()];
    setState('list', produce((l: number[]) => { l.push(4); }));
    expect(a.runs() - a0).toBe(0);
    expect(b.runs() - b0).toBe(0);
    expect(state.list.length).toBe(4);
  });
  it.each([
    ['push', (l: number[]) => l.push(9, 10), [1, 2, 3, 9, 10], 5],
    ['pop', (l: number[]) => l.pop(), [1, 2], 3],
    ['shift', (l: number[]) => l.shift(), [2, 3], 1],
    ['unshift', (l: number[]) => l.unshift(7), [7, 1, 2, 3], 4],
    ['splice remove', (l: number[]) => l.splice(1, 1), [1, 3], [2]],
    ['splice insert', (l: number[]) => l.splice(1, 0, 8, 9), [1, 8, 9, 2, 3], []],
    ['splice replace', (l: number[]) => l.splice(0, 2, 5), [5, 3], [1, 2]],
    // oxlint-disable-next-line unicorn/no-array-sort
    ['sort', (l: number[]) => l.sort((a, b) => b - a), [3, 2, 1], undefined],
    // oxlint-disable-next-line unicorn/no-array-reverse
    ['reverse', (l: number[]) => l.reverse(), [3, 2, 1], undefined],
    ['fill', (l: number[]) => l.fill(0, 1), [1, 0, 0], undefined],
    ['copyWithin', (l: number[]) => l.copyWithin(0, 1), [2, 3, 3], undefined],
  ])('%s: JS semantics, results, and readers see the new contents', (_n, mutate, expected, result) => {
    const [state, setState] = createStore<{ list: number[] }>({ list: [1, 2, 3] });
    const seen = probe(() => state.list.join(','));
    let r: unknown;
    setState('list', produce((l: number[]) => { r = mutate(l); }));
    expect([...state.list]).toEqual(expected);
    expect(seen.last()).toBe(expected.join(','));
    if (result !== undefined) expect(r).toEqual(result);
    else expect(r).toBeDefined(); // (sort/reverse/fill/copyWithin return the array)
  });
  it('items inserted by push / unshift / splice / fill are adopted (a proxy inside is unwrapped, __proto__ stripped)', () => {
    const [state, setState] = createStore<any>({ other: { n: 1 }, list: [] as any[] });
    setState('list', produce((l: any[]) => {
      l.push(state.other);
      l.unshift(JSON.parse('{"a":1,"__proto__":{"isAdmin":true}}'));
      l.splice(1, 0, { nested: state.other });
    }));
    const raw = unwrap(state.list);
    expect(raw[2]).toBe(unwrap(state.other));
    expect(raw[1].nested).toBe(unwrap(state.other));
    expect(Object.hasOwn(raw[0], '__proto__')).toBe(false);
    expect(({} as any).isAdmin).toBeUndefined();
  });
  it('removed items come back as drafts and sort/find comparators see drafts', () => {
    const [state, setState] = createStore<{ list: Item[] }>({ list: items(0, 3) });
    setState('list', produce((l: Item[]) => {
      const removed = l.pop()!;
      removed.text = 'edited'; // a draft of a detached object: fine, silent
      // oxlint-disable-next-line unicorn/no-array-sort
      l.sort((a, b) => { a.text += ''; return b.id - a.id; }); // comparator args are drafts (writes notify)
    }));
    expect(state.list.map((x) => x.id)).toEqual([1, 0]);
  });
  it('a stale draft (kept past produce) cannot mutate through a mutator', () => {
    const [state, setState] = createStore<{ list: number[] }>({ list: [1] });
    let leaked!: number[];
    setState('list', produce((l: number[]) => { leaked = l; }));
    expect(() => leaked.push(2)).toThrow(TypeError);
    expect(state.list.length).toBe(1);
  });
  it('mutators on an array nobody reads through a proxy work (no node)', () => {
    const [state, setState] = createStore<{ a: { list: number[] } }>({ a: { list: [1, 2] } });
    const raw = unwrap(state).a.list; // never read through a proxy
    setState('a', 'list', produce((l: number[]) => { l.unshift(0); }));
    expect(raw).toEqual([0, 1, 2]);
  });
});

describe('reconcile of a keyed array notifies once', () => {
  it('prepend 50 to 100 by key: shape and length once, rows keep identity', () => {
    const [state, setState] = createStore<{ list: Item[] }>({ list: items(100, 100) });
    const old = state.list[0];
    const shape = probe(() => keys(state.list).length);
    const len = probe(() => state.list.length);
    const [s0, l0] = [shape.runs(), len.runs()];
    setState('list', reconcile([...items(0, 50), ...items(100, 100)]));
    expect(shape.runs() - s0).toBe(1);
    expect(len.runs() - l0).toBe(1);
    expect(state.list.length).toBe(150);
    expect(state.list[50]).toBe(old); // matched by key: the same proxy
    expect(state.list.map((x) => x.id).slice(48, 52)).toEqual([48, 49, 100, 101]);
  });
  it('a reorder keeps identities and notifies each indexed reader of a moved index', () => {
    const [state, setState] = createStore<{ list: Item[] }>({ list: items(0, 4) });
    const at0 = probe(() => state.list[0].id);
    const at3 = probe(() => state.list[3].id);
    const [a0, b0] = [at0.runs(), at3.runs()];
    setState('list', reconcile([items(0, 4)[3], items(0, 4)[2], items(0, 4)[1], items(0, 4)[0]]));
    expect(at0.last()).toBe(3);
    expect(at3.last()).toBe(0);
    expect(at0.runs() - a0).toBe(1);
    expect(at3.runs() - b0).toBe(1);
  });
  it('shrinking truncates and notifies the removed indexes', () => {
    const [state, setState] = createStore<{ list: Item[] }>({ list: items(0, 4) });
    const at3 = probe(() => state.list[3]?.id);
    setState('list', reconcile(items(0, 2)));
    expect(at3.last()).toBeUndefined();
    expect(state.list.length).toBe(2);
  });
  it('flush keeps working (a normal-schedule effect)', () => {
    const [state, setState] = createStore<{ list: Item[] }>({ list: items(0, 3) });
    const log: number[] = [];
    createRoot(() => { createEffect(() => state.list.length, (n) => { log.push(n); }); });
    flushSync();
    setState('list', reconcile(items(0, 5)));
    flushSync();
    expect(log).toEqual([3, 5]);
  });
});
