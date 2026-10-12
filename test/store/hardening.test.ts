// Store hardening from the final review: Object.prototype member names as dictionary keys (I2),
// createStore adopting `initial`, cyclic/deep new data, atomic fan-out, holes by index, the read-only
// view's remaining traps, drafts that outlive their produce().
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

describe('keys named like Object.prototype members (I2)', () => {
  it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])('%s: adding the key notifies Object.keys, `in` and get readers', (name) => {
    const [state, setState] = createStore<any>({ users: {} });
    const keyLog = watch(() => Object.keys(state.users).join(','));
    const read = watch(() => typeof state.users[name]);
    const has = watch(() => Object.hasOwn(state.users, name) || name in state.users);
    setState('users', name, 2);
    flushSync();
    expect(keyLog).toEqual(['', name]);
    expect(read).toEqual(['function', 'number']);
    expect(state.users[name]).toBe(2);
    expect(has.length).toBeGreaterThanOrEqual(1);
    setState('users', name, 3);
    flushSync();
    expect(read).toEqual(['function', 'number']); // (same type: the effect value did not change)
    expect(state.users[name]).toBe(3);
    setState('users', name, undefined);
    flushSync();
    expect(keyLog).toEqual(['', name, '']);
    expect(read).toEqual(['function', 'number', 'function']);
  });
  it('the own value tracks and updates', () => {
    const [state, setState] = createStore<any>({ users: { constructor: 1 } });
    const log = watch(() => state.users.constructor);
    setState('users', 'constructor', 5);
    flushSync();
    expect(log).toEqual([1, 5]);
  });
  it('an inherited array method read does not subscribe to the shape', () => {
    const [state, setState] = createStore<any>({ list: [1] });
    let runs = 0;
    watch(() => { runs++; return typeof state.list.map; });
    setState('list', produce((l: any[]) => { l.push(2); }));
    flushSync();
    expect(runs).toBe(1);
  });
  it('the value of an own key written through setProperty is found by hasOwn, not by the chain', () => {
    const [state, setState] = createStore<any>({ d: {} });
    setState('d', 'toString', undefined); // nothing to delete: a no-op
    expect(Object.keys(unwrap(state.d))).toEqual([]);
    setState('d', 'toString', 1);
    expect(Object.keys(unwrap(state.d))).toEqual(['toString']);
  });
});

describe('new data', () => {
  it('createStore adopts `initial`: a proxy of another store inside it is unwrapped', () => {
    const [a] = createStore<any>({ chat: { id: 1 } });
    const [b, setB] = createStore<any>({ held: a.chat });
    expect(unwrap(b.held)).toBe(unwrap(a.chat));
    setB('held', 'id', 2); // would throw "read-only" on a proxy over a proxy
    expect(b.held.id).toBe(2);
  });
  it('a cyclic new graph is adopted, not recursed forever', () => {
    const [state, setState] = createStore<any>({ x: null });
    const a: any = { name: 'a' };
    const b: any = { name: 'b', a };
    a.b = b;
    setState('x', a);
    expect(state.x.b.a.name).toBe('a');
  });
  it('a very deep new object does not overflow the stack', () => {
    const [state, setState] = createStore<any>({ x: null });
    let deep: any = { leaf: 1 };
    for (let i = 0; i < 50_000; i++) deep = { c: deep };
    setState('x', deep);
    expect(state.x.c).toBeDefined();
  });
  it('a proxy inside new data is unwrapped, nested', () => {
    const [state, setState] = createStore<any>({ a: { n: { v: 1 } }, y: null });
    setState('y', { wrap: { inner: state.a.n } });
    expect(unwrap(state.y.wrap.inner)).toBe(unwrap(state.a.n));
  });
});

describe('path form', () => {
  it('a fan-out into a missing element is a store error and applies nothing', () => {
    const [state, setState] = createStore<any>({ chats: { a: { title: 'A' }, b: { title: 'B' } } });
    expect(() => setState('chats', ['a', 'zzz', 'b'], 'title', 'T')).toThrow(/\[frameact\/store\].*nothing to descend into/);
    expect(state.chats.a.title).toBe('A');
    expect(state.chats.b.title).toBe('B');
  });
  it('a nested fan-out is validated before anything is applied', () => {
    const [state, setState] = createStore<any>({ g: { a: { x: { v: 1 } }, b: {} } });
    expect(() => setState('g', ['a', 'b'], 'x', 'v', 9)).toThrow(/nothing to descend into/);
    expect(state.g.a.x.v).toBe(1);
  });
  it('a fan-out onto array indexes refuses holes before writing', () => {
    const [state, setState] = createStore<any>({ list: [1, 2, 3] });
    expect(() => setState('list', [0, 1], undefined)).toThrow(TypeError);
    expect(() => setState('list', [0, 7], 9)).toThrow(TypeError);
    expect([...state.list]).toEqual([1, 2, 3]);
  });
  it('an index beyond the length is a TypeError like a hole; length itself appends', () => {
    const [state, setState] = createStore<any>({ list: [{ id: 1 }] });
    expect(() => setState('list', 3, { id: 9 })).toThrow(TypeError);
    expect(() => setState('list', '5', { id: 9 })).toThrow(TypeError);
    expect(state.list.length).toBe(1);
    setState('list', 1, { id: 2 }); // == length: an append
    expect(state.list.length).toBe(2);
  });
});

describe('read-only view and drafts (L2)', () => {
  it('setPrototypeOf / preventExtensions / freeze on the read-only proxy throw', () => {
    const [state] = createStore<any>({ chat: { id: 1 } });
    expect(() => Object.setPrototypeOf(state.chat, { isAdmin: true })).toThrow(TypeError);
    expect(() => Object.preventExtensions(state.chat)).toThrow(TypeError);
    expect(() => Object.freeze(state.chat)).toThrow(TypeError);
    expect(Object.isExtensible(unwrap(state.chat))).toBe(true);
    expect(state.chat.isAdmin).toBeUndefined();
  });
  it('a draft kept past produce() cannot write (DEV: throws)', () => {
    const [state, setState] = createStore<any>({ chat: { n: 1 } });
    let leaked: any;
    setState('chat', produce((d: any) => { leaked = d; d.n = 2; }));
    expect(state.chat.n).toBe(2);
    expect(() => { leaked.n = 3; }).toThrow(TypeError);
    expect(() => { delete leaked.n; }).toThrow(TypeError);
    expect(state.chat.n).toBe(2);
  });
  it('a draft used after an await in an async produce callback cannot write', async () => {
    const [state, setState] = createStore<any>({ chat: { n: 1 } });
    let late: Promise<void> | undefined;
    setState('chat', produce((d: any) => {
      late = Promise.resolve().then(() => { d.n = 99; });
    }));
    await expect(late).rejects.toBeInstanceOf(TypeError);
    expect(state.chat.n).toBe(1);
  });
  it('nested produce calls keep drafts valid until the outer one returns', () => {
    const [state, setState] = createStore<any>({ a: { n: 1 }, b: { n: 1 } });
    setState('a', produce((a: any) => {
      setState('b', produce((b: any) => { b.n = 2; }));
      a.n = 3;
    }));
    expect(state.a.n).toBe(3);
    expect(state.b.n).toBe(2);
  });
});

describe('a leaked draft is valid in its own produce() invocation only (N4)', () => {
  it('a draft kept from produce #1 cannot write while a DIFFERENT produce runs', () => {
    const [state, setState] = createStore<any>({ chat: { t: 1 }, nest: { a: 1 } });
    let leaked: any;
    setState('chat', produce((d: any) => { leaked = d; }));
    let threw = false;
    setState('nest', produce(() => {
      try { leaked.t = 77; } catch (e) { threw = e instanceof TypeError; }
    }));
    expect(threw).toBe(true);
    expect(state.chat.t).toBe(1);
  });
  it('...nor delete, nor run an array mutator', () => {
    const [state, setState] = createStore<any>({ list: [1], nest: { a: 1 }, chat: { t: 1 } });
    let list: any;
    let chat: any;
    setState('list', produce((d: any) => { list = d; }));
    setState('chat', produce((d: any) => { chat = d; }));
    const errors: unknown[] = [];
    setState('nest', produce(() => {
      for (const f of [() => list.push(2), () => delete chat.t]) {
        try { f(); } catch (e) { errors.push(e); }
      }
    }));
    expect(errors).toHaveLength(2);
    expect(state.list).toEqual([1]);
    expect(state.chat.t).toBe(1);
  });
  it('...nor in a later produce() of the SAME object (a new invocation, a new draft)', () => {
    const [state, setState] = createStore<any>({ chat: { t: 1 } });
    let leaked: any;
    setState('chat', produce((d: any) => { leaked = d; }));
    let threw = false;
    setState('chat', produce(() => {
      try { leaked.t = 5; } catch { threw = true; }
    }));
    expect(threw).toBe(true);
    expect(state.chat.t).toBe(1);
  });
  it('a produce nested in another (via setState in the callback) keeps both drafts valid while they run', () => {
    const [state, setState] = createStore<any>({ a: { n: 0 }, b: { n: 0 } });
    setState('a', produce((da: any) => {
      setState('b', produce((db: any) => { db.n = 1; da.n = 2; }));
      da.n++;
    }));
    expect(state.a.n).toBe(3);
    expect(state.b.n).toBe(1);
  });
});

describe('keys() / values() / entries() on a produce() draft (N5)', () => {
  it('work in a tracked context (no subscription, no TypeError) and list the keys', () => {
    const [state, setState] = createStore<any>({ nest: { a: { x: 1, y: 2 } } });
    let got: unknown;
    let threw: unknown = null;
    const runs: number[] = [];
    createRoot(() => {
      createEffect(
        () => {
          runs.push(1);
          try { setState('nest', produce((d: any) => { got = [keys(d.a), values(d.a), entries(d.a)]; })); } catch (e) { threw = e; }
        },
        () => {},
        (r) => r(),
      );
    });
    flushSync();
    expect(threw).toBeNull();
    expect(got).toEqual([['x', 'y'], [1, 2], [['x', 1], ['y', 2]]]);
    setState('nest', 'a', 'z', 3); // the effect did not subscribe to the draft's object
    flushSync();
    expect(runs).toHaveLength(1);
    expect(state.nest.a.z).toBe(3);
  });
  it('values() / entries() hand out drafts: items can be written', () => {
    const [state, setState] = createStore<any>({ by: { a: { read: false }, b: { read: false } }, list: [{ n: 0 }, { n: 0 }] });
    setState('by', produce((d: any) => {
      for (const m of values(d)) (m as any).read = true;
    }));
    setState('by', produce((d: any) => {
      for (const [, m] of entries(d)) (m as any).seen = true;
    }));
    setState('list', produce((d: any) => {
      for (const m of values(d)) (m as any).n = 5;
    }));
    expect(unwrap(state).by).toEqual({ a: { read: true, seen: true }, b: { read: true, seen: true } });
    expect(unwrap(state).list).toEqual([{ n: 5 }, { n: 5 }]);
  });
});
