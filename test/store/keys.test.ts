// Key iteration over store objects (perf review 1): plain data descriptors from the proxy (no
// per-key closure), and keys()/values()/entries() that read the raw object and subscribe once.
import { createEffect, createRoot, flushSync } from '../../src/index';
import { createStore, entries, keys, produce, unwrap, values } from 'frameact/store';

function watch<T>(fn: () => T): T[] {
  const log: T[] = [];
  createRoot(() => {
    createEffect(fn, (v) => { log.push(v); });
  });
  flushSync();
  return log;
}

describe('the proxy enumerates through plain data descriptors', () => {
  it('Object.keys / values / entries / spread / for-in / JSON agree with a plain object', () => {
    const data = { a: { n: 1 }, b: 2, c: 'x' };
    const [state] = createStore<any>({ d: data });
    expect(Object.keys(state.d)).toEqual(['a', 'b', 'c']);
    expect(Object.values(state.d).map((v: any) => (typeof v === 'object' ? v.n : v))).toEqual([1, 2, 'x']);
    expect(Object.entries(state.d).map(([k]) => k)).toEqual(['a', 'b', 'c']);
    expect({ ...state.d }.b).toBe(2);
    const forIn: string[] = [];
    for (const k in state.d) forIn.push(k);
    expect(forIn).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(state.d)).toBe(JSON.stringify(data));
  });
  it('the descriptor is a data descriptor whose object value is the read-only proxy, not the raw object', () => {
    const [state] = createStore<any>({ d: { a: { n: 1 }, b: 2 } });
    const da = Object.getOwnPropertyDescriptor(state.d, 'a')!;
    expect(da.get).toBeUndefined();
    expect(da.enumerable).toBe(true);
    expect(da.value).toBe(state.d.a);
    expect(da.value).not.toBe(unwrap(state.d.a));
    expect(Object.getOwnPropertyDescriptor(state.d, 'b')!.value).toBe(2);
    expect(Object.getOwnPropertyDescriptor(state.d, 'zz')).toBeUndefined();
  });
  it('Object.values over a proxy hands out proxies and tracks every value read', () => {
    const [state, setState] = createStore<any>({ d: { a: { n: 1 }, b: { n: 2 } } });
    const log = watch(() => Object.values(state.d).map((v: any) => v.n).join(','));
    setState('d', 'a', 'n', 9);
    flushSync();
    expect(log).toEqual(['1,2', '9,2']);
  });
  it('arrays still enumerate', () => {
    const [state] = createStore<any>({ l: [{ id: 1 }, { id: 2 }] });
    expect(Object.keys(state.l)).toEqual(['0', '1']);
    expect([...state.l].map((x: any) => x.id)).toEqual([1, 2]);
    expect(Object.getOwnPropertyDescriptor(state.l, 'length')!.value).toBe(2);
  });
});

describe('keys / values / entries', () => {
  it('work on store objects, store arrays and plain values', () => {
    const [state] = createStore<any>({ d: { a: { n: 1 }, b: 2 }, l: [10, 20] });
    expect(keys(state.d)).toEqual(['a', 'b']);
    const vs = values(state.d);
    expect(vs[0]).toBe(state.d.a); // wrapped: the same proxy
    expect(vs[1]).toBe(2);
    expect(entries(state.d)).toEqual([['a', state.d.a], ['b', 2]]);
    expect(keys(state.l)).toEqual(['0', '1']);
    expect(values(state.l)).toEqual([10, 20]);
    expect(keys({ x: 1 })).toEqual(['x']);
    expect(values({ x: 1 })).toEqual([1]);
    expect(entries({ x: 1 })).toEqual([['x', 1]]);
  });
  it('keys() re-runs on add/remove only, values() on any value change, entries() likewise', () => {
    const [state, setState] = createStore<any>({ d: { a: 1, b: 2 } });
    const k = watch(() => keys(state.d).join(','));
    const kRuns = watch(() => ({ n: keys(state.d).length }));
    const v = watch(() => values(state.d).join(','));
    const e = watch(() => entries(state.d).map(([key, val]) => `${key}=${val}`).join(','));
    setState('d', 'a', 5); // value change only
    flushSync();
    expect(k).toEqual(['a,b']);
    expect(kRuns.length).toBe(1);
    expect(v).toEqual(['1,2', '5,2']);
    expect(e).toEqual(['a=1,b=2', 'a=5,b=2']);
    setState('d', 'c', 3); // key added
    flushSync();
    expect(k).toEqual(['a,b', 'a,b,c']);
    expect(v.at(-1)).toBe('5,2,3');
    setState('d', 'a', undefined); // key removed
    flushSync();
    expect(k.at(-1)).toBe('b,c');
    expect(v.at(-1)).toBe('2,3');
  });
  it('replacing an object value is seen by values() readers', () => {
    const [state, setState] = createStore<any>({ d: { a: { n: 1 } } });
    const log = watch(() => values(state.d).map((x: any) => x.n).join(','));
    setState('d', 'a', { n: 2 });
    flushSync();
    expect(log).toEqual(['1', '2']);
  });
  it('produce writes notify values() once per effect run', () => {
    const [state, setState] = createStore<any>({ d: { a: 1, b: 2 } });
    const log = watch(() => values(state.d).join(','));
    setState('d', produce((d: any) => { d.a = 10; d.b = 20; d.c = 30; }));
    flushSync();
    expect(log).toEqual(['1,2', '10,20,30']);
  });
  it('arrays: values() re-runs on any item write', () => {
    const [state, setState] = createStore<any>({ l: [1, 2] });
    const log = watch(() => values(state.l).join(','));
    setState('l', 0, 7);
    flushSync();
    expect(log).toEqual(['1,2', '7,2']);
  });
  it('keys() does not enumerate inherited or symbol keys', () => {
    const [state] = createStore<any>({ d: { a: 1, [Symbol('s')]: 2 } });
    expect(keys(state.d)).toEqual(['a']);
  });
});

describe('DEV: enumerating a very large store object through the proxy', () => {
  it('warns once, pointing at keys()/values()/entries()', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const big: Record<string, number> = {};
      for (let i = 0; i < 1500; i++) big[`k${i}`] = i;
      const [state] = createStore<any>({ big, small: { a: 1 } });
      Object.keys(state.small);
      expect(warn).not.toHaveBeenCalled();
      Object.keys(state.big);
      Object.keys(state.big);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/keys\(\)/);
      expect(keys(state.big).length).toBe(1500);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
