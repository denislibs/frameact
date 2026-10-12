// The store tree (spec §3.5): lazy leaves, path writes (replace / merge() / undefined deletes), arrays,
// produce, snapshots, the read-only proxy, and the interplay with the core (memos holding errors, the
// missed-wake latch, createSelector, local signals). Lists and reconcile: lists.test.ts (Task 5).
import {
  createEffect, createMemo, createRoot, createSelector, createSignal, flushSync, onError, untrack,
} from '../../src/index';
import { $TRACK, createStore, merge, produce, snapshot, unwrap, type Store, type Updater } from 'frameact/store';
import { storeStats } from '../../src/store/store';

/** A tickEnd effect counting its compute runs; returns the log of computed values. */
function track<T>(fn: () => T): T[] {
  const log: T[] = [];
  createEffect(() => {
    const v = fn();
    log.push(v);
    return v;
  }, () => {});
  return log;
}

type Msg = { id: number; text: string; reactions?: { n: number } };
type Chat = { id: string; title: string; unread: number; draft?: string };
type State = {
  chats: Record<string, Chat>;
  messages: Record<string, Msg[]>;
  currentChatId: string | null;
};

function initial(): State {
  return {
    chats: { a: { id: 'a', title: 'A', unread: 0 }, b: { id: 'b', title: 'B', unread: 2 } },
    messages: { a: [{ id: 1, text: 'one' }, { id: 2, text: 'two' }] },
    currentChatId: 'a',
  };
}

describe('lazy leaf signals', () => {
  it('untracked reads create no signals; a tracked read creates one per segment read', () => {
    const [state] = createStore(initial());
    const before = storeStats.leafSignals;
    expect(state.chats.a.title).toBe('A');
    expect(untrack(() => state.chats.b.unread)).toBe(2);
    expect(storeStats.leafSignals).toBe(before);
    createRoot(() => track(() => state.chats.a.title));
    expect(storeStats.leafSignals - before).toBe(3); // chats (root key), a (chats key), title (chat key)
  });

  it('a path write notifies only the readers of that leaf; same value: nothing', () => {
    const [state, setState] = createStore(initial());
    const titleA = createRoot(() => track(() => state.chats.a.title));
    const unreadA = createRoot(() => track(() => state.chats.a.unread));
    const titleB = createRoot(() => track(() => state.chats.b.title));
    setState('chats', 'a', 'title', 'A!');
    flushSync();
    expect(titleA).toEqual(['A', 'A!']);
    expect(unreadA).toEqual([0]);
    expect(titleB).toEqual(['B']);
    setState('chats', 'a', 'unread', (n) => n + 5); // updater
    flushSync();
    expect(unreadA).toEqual([0, 5]);
    expect(titleA).toEqual(['A', 'A!']);
    setState('chats', 'a', 'unread', 5);
    flushSync();
    expect(unreadA).toEqual([0, 5]);
  });

  it('a value at a path REPLACES (objects too); readers below re-read through the new object; merge() is explicit', () => {
    const [state, setState] = createStore(initial());
    const title = createRoot(() => track(() => state.chats.a.title));
    setState('chats', 'a', { id: 'a', title: 'replaced', unread: 9 });
    flushSync();
    expect(title).toEqual(['A', 'replaced']);
    expect(state.chats.a.unread).toBe(9);
    const keys = createRoot(() => track(() => Object.keys(state.chats.a).join()));
    setState('chats', 'a', merge({ title: 'merged' }));
    flushSync();
    expect(title).toEqual(['A', 'replaced', 'merged']);
    expect(state.chats.a.unread).toBe(9); // kept: a shallow merge
    expect(keys).toEqual(['id,title,unread']); // no key added or removed: the shape did not notify
    setState('chats', 'a', merge({ draft: 'd' }));
    flushSync();
    expect(keys).toEqual(['id,title,unread', 'id,title,unread,draft']);
    setState('chats', 'a', merge({ draft: undefined })); // undefined inside merge deletes the key too
    flushSync();
    expect('draft' in state.chats.a).toBe(false);
    expect(keys.at(-1)).toBe('id,title,unread');
    expect(() => setState('currentChatId', merge({ x: 1 }) as any)).toThrow(/merge/);
    // @ts-expect-error — `nope` is not a key of Chat
    merge({ nope: 1 }) satisfies Updater<Chat>;
    // @ts-expect-error — a number is not a string
    merge({ title: 5 }) satisfies Updater<Chat>;
  });

  it('undefined at the end of a path deletes the key: `in`, Object.keys and iteration track the shape', () => {
    const [state, setState] = createStore<{ map: Record<string, number>; list: (number | undefined)[] }>({ map: { x: 1 }, list: [1, 2, 3] });
    const hasY = createRoot(() => track(() => 'y' in state.map));
    const keys = createRoot(() => track(() => Object.keys(state.map).join()));
    const sum = createRoot(() => track(() => Object.values(state.map).reduce((a, b) => a + b, 0)));
    setState('map', 'y', 2);
    flushSync();
    expect(hasY).toEqual([false, true]);
    expect(keys).toEqual(['x', 'x,y']);
    expect(sum).toEqual([1, 3]);
    setState('map', 'x', 5); // value change: keys unchanged
    flushSync();
    expect(keys).toEqual(['x', 'x,y']);
    expect(sum).toEqual([1, 3, 7]);
    setState('map', 'y', undefined);
    flushSync();
    expect(hasY).toEqual([false, true, false]);
    expect(keys).toEqual(['x', 'x,y', 'x']);
    expect(Object.hasOwn(unwrap(state.map), 'y')).toBe(false);
    // at an array index the path form refuses (a hole is never what is wanted): produce + splice removes
    expect(() => setState('list', 1, undefined)).toThrow(/splice/);
    expect(state.list.length).toBe(3);
  });

  it('produce keeps JS array semantics: `draft[i] = undefined` stores the value, `delete draft[i]` leaves a hole, splice shifts', () => {
    const [state, setState] = createStore({ list: [1, 2, 3] as (number | undefined)[] });
    setState('list', produce((l) => { l[1] = undefined; }));
    expect(1 in state.list).toBe(true);
    expect(state.list[1]).toBeUndefined();
    setState('list', produce((l) => { delete l[1]; }));
    expect(1 in state.list).toBe(false);
    expect(state.list.length).toBe(3);
    setState('list', produce((l) => { l.splice(1, 1); }));
    expect([...state.list]).toEqual([1, 3]);
  });

  it('the leaf of a deleted key stays while it has a reader (and is reused by a re-added key); it leaves the table with its last reader', () => {
    const [state, setState] = createStore({ byId: {} as Record<string, number> });
    setState('byId', 'k', 1);
    const log = createRoot(() => track(() => state.byId.k));
    const n = storeStats.leafSignals;
    setState('byId', 'k', undefined);
    flushSync();
    expect(log).toEqual([1, undefined]);
    setState('byId', 'k', 2);
    createRoot(() => track(() => state.byId.k));
    expect(storeStats.leafSignals - n).toBe(0); // the leaf of `k` is reused (its first reader never let go of it)
    flushSync();
    expect(log).toEqual([1, undefined, 2]);
  });

  it('the root accepts merge/produce (and reconcile) only', () => {
    const [state, setState] = createStore(initial());
    setState(merge({ currentChatId: 'b' }));
    expect(state.currentChatId).toBe('b');
    setState(produce((s) => { s.currentChatId = null; }));
    expect(state.currentChatId).toBeNull();
    expect(() => setState({ currentChatId: 'a' } as any)).toThrow(/root/);
    expect(() => setState(() => initial())).toThrow(/root/);
  });

  it('frozen objects are immutable values: readable raw, replaceable, never written into (DEV: a clear TypeError); a frozen root and produce on a frozen value are TypeErrors', () => {
    const frozen = Object.freeze({ b: Object.freeze({ c: 1 }) });
    const [state, setState] = createStore<{ a: { b: { c: number } } }>({ a: frozen });
    const log = createRoot(() => track(() => state.a.b.c));
    expect(log).toEqual([1]);
    expect(state.a).toBe(frozen); // a value, not a proxy (a proxy could not honour the non-configurable property)
    expect(() => setState('a', 'b', { c: 2 })).toThrow(/frozen/); // DEV message; production: the native strict-mode TypeError
    setState('a', { b: { c: 2 } }); // replaced by a plain object
    flushSync();
    expect(log).toEqual([1, 2]);
    setState('a', 'b', produce((b) => { b.c = 3; }));
    expect(state.a.b.c).toBe(3);
    const [, set2] = createStore<{ f: { n: number } }>({ f: Object.freeze({ n: 1 }) });
    expect(() => set2('f', produce((f) => { f.n = 2; }))).toThrow(/frozen/);
    expect(() => createStore(Object.freeze({ n: 1 }))).toThrow(/frozen/);
  });

  it('proxies written into the store are adopted (unwrapped deeply): a spread replacement and a merge with a nested proxy, then path writes and snapshot work', () => {
    type ChatP = { title: string; photo: { url: string } };
    const [state, setState] = createStore<{ chats: Record<number, ChatP>; x: { y: Record<string, unknown> } }>({ chats: { 1: { title: 'a', photo: { url: 'u' } } }, x: { y: {} } });
    setState('chats', 1, { ...state.chats[1], title: 'b' }); // the spread copies the `photo` PROXY
    setState('chats', 1, 'photo', 'url', 'v'); // without adoption: "the state is read-only" (the write would hit the proxy)
    expect(state.chats[1].photo.url).toBe('v');
    setState('x', merge({ y: state.chats[1].photo })); // (aliases the raw photo object: one object under two paths, one set of leaves)
    setState('x', 'y', 'url', 'w');
    expect(snapshot(state)).toEqual({ chats: { 1: { title: 'b', photo: { url: 'w' } } }, x: { y: { url: 'w' } } }); // without adoption: DataCloneError
  });
});

describe('arrays', () => {
  it('index, length and iteration; produce push/splice; item proxies are stable', () => {
    const [state, setState] = createStore(initial());
    const len = createRoot(() => track(() => state.messages.a.length));
    const texts = createRoot(() => track(() => state.messages.a.map((m) => m.text).join()));
    const first = state.messages.a[0];
    expect(first).toBe(state.messages.a[0]); // one proxy per raw object
    setState('messages', 'a', produce((list) => { list.push({ id: 3, text: 'three' }); }));
    flushSync();
    expect(len).toEqual([2, 3]);
    expect(texts).toEqual(['one,two', 'one,two,three']);
    setState('messages', 'a', 1, 'text', 'TWO');
    flushSync();
    expect(len).toEqual([2, 3]);
    expect(texts.at(-1)).toBe('one,TWO,three');
    setState('messages', 'a', produce((list) => { list.splice(0, 1); }));
    flushSync();
    expect(len.at(-1)).toBe(2);
    expect(texts.at(-1)).toBe('TWO,three');
    expect(state.messages.a[0].text).toBe('TWO');
    expect(state.messages.a[0]).toBe(state.messages.a[0]);
  });

  it('filter-function and key-array path parts fan out', () => {
    const [state, setState] = createStore({ todos: [{ done: false, t: 'a' }, { done: true, t: 'b' }, { done: false, t: 'c' }] });
    setState('todos', (t) => !t.done, 'done', true);
    expect(state.todos.map((t) => t.done)).toEqual([true, true, true]);
    setState('todos', [0, 2], 't', (t) => t.toUpperCase());
    expect(state.todos.map((t) => t.t)).toEqual(['A', 'b', 'C']);
  });

  it('$TRACK: one shape link; a plain array of item proxies; item edits do not fire it, index/length writes do', () => {
    const [state, setState] = createStore(initial());
    let runs = 0;
    const items = createRoot(() => createMemo(() => { runs++; return state.messages.a[$TRACK]; }));
    const before = storeStats.leafSignals;
    expect(items().map((m) => m.text)).toEqual(['one', 'two']);
    expect(storeStats.leafSignals - before).toBe(3); // `messages`, `a` and the shape signal — no per-index leaves
    expect(items()[0]).toBe(state.messages.a[0]);
    expect(Array.isArray(items())).toBe(true);
    setState('messages', 'a', 0, 'text', 'ONE');
    expect(runs).toBe(1); // content: the map is not told
    setState('messages', 'a', produce((l) => { l.push({ id: 3, text: 'three' }); }));
    expect(items().length).toBe(3);
    expect(runs).toBe(2);
    expect(storeStats.leafSignals - before).toBe(3); // the recompute created nothing new
  });
});

describe('snapshots and user objects (req. 8)', () => {
  it('no service fields on raw objects; toEqual/JSON work on the proxy; structuredClone via unwrap/snapshot', () => {
    const init = initial();
    const keysBefore = Reflect.ownKeys(init.chats.a);
    const [state, setState] = createStore(init);
    createRoot(() => track(() => state.chats.a.title));
    expect(Reflect.ownKeys(init.chats.a)).toEqual(keysBefore);
    expect(state.chats.a).toEqual({ id: 'a', title: 'A', unread: 0 });
    expect(JSON.parse(JSON.stringify(state.chats))).toEqual(initial().chats);
    expect(() => structuredClone(state)).toThrow(); // a Proxy is not cloneable (same in dev and prod)
    expect(structuredClone(unwrap(state)).chats.a.title).toBe('A');
    const snap = snapshot(state.chats.a);
    setState('chats', 'a', 'title', 'changed');
    expect(snap.title).toBe('A'); // a deep copy
    expect(unwrap(state.chats.a)).toBe(init.chats.a); // the live raw object (mutated in place)
    expect(init.chats.a.title).toBe('changed');
  });

  it('the state is read-only; a proxy written into the store is unwrapped', () => {
    const [state, setState] = createStore(initial());
    expect(() => { (state as any).currentChatId = 'b'; }).toThrow(/read-only/);
    expect(() => { delete (state as any).chats; }).toThrow(/read-only/);
    setState('chats', 'c', state.chats.a as Chat); // aliasing the raw object, not the proxy
    expect(unwrap(state.chats.c)).toBe(unwrap(state.chats.a));
  });
});

describe('core interplay', () => {
  it('untrack inside a computation does not subscribe; the store outlives the owner that created it', () => {
    let state!: Store<State>, setState!: ReturnType<typeof createStore<State>>[1];
    const dispose = createRoot((d) => {
      [state, setState] = createStore(initial());
      return d;
    });
    const log = createRoot(() => track(() => state.chats.a.title + untrack(() => state.chats.a.unread)));
    dispose();
    setState('chats', 'a', 'unread', 1);
    flushSync();
    expect(log).toEqual(['A0']);
    setState('chats', 'a', 'title', 'X');
    flushSync();
    expect(log).toEqual(['A0', 'X1']);
  });

  it('a memo over the store holds its error and recovers on the next store write', () => {
    const [state, setState] = createStore({ n: 1 });
    const errors: unknown[] = [];
    const seen: unknown[] = [];
    createRoot(() => {
      const m = createMemo(() => {
        if (state.n < 0) throw new Error('negative');
        return state.n * 2;
      });
      createEffect(() => {
        try {
          return m();
        } catch (e) {
          errors.push(e);
          return 'err';
        }
      }, (v) => { seen.push(v); });
    });
    flushSync();
    setState('n', -1);
    flushSync();
    setState('n', 3);
    flushSync();
    expect(seen).toEqual([2, 'err', 6]);
    expect(errors).toHaveLength(1);
  });

  it('a store write inside a memo compute is not lost (missed-wake latch)', () => {
    const [state, setState] = createStore({ a: 1, b: 0 });
    const log = createRoot(() => {
      const m = createMemo(() => {
        const a = state.a;
        if (untrack(() => state.b) !== a * 10) setState('b', a * 10);
        return a;
      });
      return track(() => `${m()}:${state.b}`);
    });
    flushSync();
    setState('a', 2);
    flushSync();
    expect(log.at(-1)).toBe('2:20');
  });

  it('createSelector over a store leaf: switching re-runs exactly the two rows', () => {
    const [state, setState] = createStore({ current: 1, ids: [1, 2, 3, 4] });
    const runs: number[] = [];
    createRoot(() => {
      const isSel = createSelector(() => state.current);
      for (const id of untrack(() => [...state.ids])) {
        createEffect(() => { runs.push(id); return isSel(id)(); }, () => {});
      }
    });
    flushSync();
    runs.length = 0;
    setState('current', 3);
    flushSync();
    expect(runs).toHaveLength(2);
    expect(runs).toContain(1);
    expect(runs).toContain(3);
  });

  it('a local signal and a store leaf in one effect: both drive it; onError-handled errors do not break the store', () => {
    const [state, setState] = createStore({ x: 1 });
    const [l, setL] = createSignal(10);
    const log = createRoot(() => track(() => state.x + l()));
    setState('x', 2);
    flushSync();
    setL(20);
    flushSync();
    expect(log).toEqual([11, 12, 22]);

    const caught: unknown[] = [];
    createRoot(() => {
      onError((e) => caught.push(e));
      createEffect(() => { if (state.x === 3) throw new Error('boom'); return state.x; }, () => {});
    });
    setState('x', 3);
    flushSync();
    setState('x', 4);
    flushSync();
    expect(caught).toHaveLength(1);
    expect(state.x).toBe(4);
  });
});

it('types: paths are checked against the state type', () => {
  const [, setState] = createStore(initial());
  // @ts-expect-error — `nope` is not a key of Chat
  setState('chats', 'a', 'nope', 1);
  // @ts-expect-error — a string is not a number
  setState('chats', 'a', 'unread', 'x');
  setState('chats', 'a', 'draft', undefined); // deletes the optional key
  // @ts-expect-error — an updater sees the read-only view: a mutation it would return goes unnoticed, so it does not type-check
  setState('messages', 'a', (l) => { l.push({ id: 9, text: 'x' }); return l; });
  const [, deep] = createStore({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } });
  deep('a', 'b', 'c', 'd', 'e', 'f', 'g', 2); // 7 keys
});
