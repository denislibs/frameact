// reconcile (keyed diff into the store), mapArray/For over store arrays ($TRACK: one shape link, item
// edits reach their row only) and zombie rows through the store (an id row whose entity went: disposed,
// not run — with and without a parked list update).
import {
  createEffect, createHeavyAnimationScope, createMutationEffect, createRoot, createSignal, flushSync, mapArray,
  provideHeavyAnimationScope,
} from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { For } from '../../src/dom/list';
import { createStore, produce, reconcile, unwrap, type Store } from 'frameact/store';
import { storeStats } from '../../src/store/store';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

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

/** 1000 messages with ids 0..999 and texts from `edit(i)` — always new objects, like a server chunk. */
function makeMessages(edit: (i: number) => string): Msg[] {
  return Array.from({ length: 1000 }, (_, i) => ({ id: i, text: edit(i) }));
}

/** A `<For>` over `each` into a fresh container; rows record the ids they were created for. */
function mount(each: () => readonly Store<Msg>[], keyed?: (m: Store<Msg>) => unknown) {
  const ul = container();
  const created: number[] = [];
  const ForC = For as (props: any) => unknown;
  createRoot(() => insert(ul, createComponent(ForC, {
    get each() { return each(); },
    ...(keyed ? { keyed } : {}),
    children: (item: any) => {
      const get = keyed ? item : () => item;
      created.push(get().id);
      const li = document.createElement('li');
      insert(li, () => get().text);
      return li;
    },
  })));
  flushSync();
  return { ul, created };
}

type S = { ids: number[]; chats: Record<number, { title: string }> };
const init = (): S => ({ ids: [1, 2], chats: { 1: { title: 'a' }, 2: { title: 'b' } } });

/** Id rows (frame effects) looking their entity up in the store, plus a frame effect reading the list. */
function mountRows(state: Store<S>, hover?: () => boolean) {
  const errors: unknown[] = [];
  const titles: string[] = [];
  createRoot(() => {
    const rows = mapArray(() => state.ids, (id: number) => {
      createMutationEffect(() => {
        try {
          const t = `${id}:${state.chats[id].title}${hover?.() ? '*' : ''}`;
          titles.push(t);
          return t;
        } catch (e) {
          errors.push(e);
          return 'error';
        }
      }, () => {});
      return id;
    });
    createMutationEffect(() => rows().join(), () => {});
  });
  flushSync();
  return { errors, titles };
}

describe('reconcile', () => {
  it('keyed array: matched items keep identity, only changed leaves notify, new items adopted, removed dropped, reorder follows the key', () => {
    const [state, setState] = createStore({ messages: [{ id: 1, text: 'one' }, { id: 2, text: 'two' }] as Msg[] });
    const p1 = state.messages[0];
    const p2 = state.messages[1];
    const t1 = createRoot(() => track(() => state.messages[0].text));
    const t2 = createRoot(() => track(() => p2.text));
    const r2 = createRoot(() => track(() => p2.reactions?.n));
    const server: Msg[] = [
      { id: 1, text: 'one' }, // unchanged (a new object, equal content)
      { id: 2, text: 'two (edited)', reactions: { n: 1 } },
      { id: 4, text: 'four' },
    ];
    setState('messages', reconcile(server));
    flushSync();
    expect(state.messages[0]).toBe(p1);
    expect(state.messages[1]).toBe(p2);
    expect(t1).toEqual(['one']); // unchanged leaf: no notification
    expect(t2).toEqual(['two', 'two (edited)']);
    expect(r2).toEqual([undefined, 1]);
    expect(unwrap(state.messages[2])).toBe(server[2]); // adopted as is
    expect(unwrap(state.messages[0])).not.toBe(server[0]); // the store keeps its own object
    setState('messages', reconcile([server[2], { id: 2, text: 'two (edited)', reactions: { n: 1 } }]));
    flushSync();
    expect(state.messages[1]).toBe(p2);
    expect(state.messages.length).toBe(2);
    expect(t2.length).toBe(2);
  });

  it('object tree: an unchanged branch does not notify; removed keys are deleted; key: null diffs arrays by index; a non-object at the path is replaced', () => {
    type R = { a: { x: number; y: { z: number } }; b?: number; list: number[]; n: unknown };
    const [state, setState] = createStore<R>({ a: { x: 1, y: { z: 1 } }, b: 1, list: [1, 2], n: 1 });
    const z = createRoot(() => track(() => state.a.y.z));
    const x = createRoot(() => track(() => state.a.x));
    const hasB = createRoot(() => track(() => 'b' in state));
    setState(reconcile<R>({ a: { x: 2, y: { z: 1 } }, list: [1, 2], n: 1 })); // (the root: the generic names the state type)
    flushSync();
    expect(z).toEqual([1]);
    expect(x).toEqual([1, 2]);
    expect(hasB).toEqual([true, false]);
    const list = state.list;
    setState('list', reconcile([1, 3, 4], { key: null }));
    expect(state.list).toBe(list);
    expect([...state.list]).toEqual([1, 3, 4]);
    setState('n', reconcile({ k: 1 }));
    expect(state.n).toEqual({ k: 1 });
  });

  it('an explicit undefined in next deletes that key AND the keys next lacks; an explicit undefined array element is a value, not a hole; a readonly chunk is accepted', () => {
    type U = { id: number; title: string; photo?: string; typing?: boolean };
    const [state, setState] = createStore<{ u: U; arr: (number | undefined)[]; list: Msg[] }>({ u: { id: 1, title: 't', photo: 'p', typing: true }, arr: [1, 2], list: [] });
    setState('u', reconcile<U>({ id: 1, title: 't', photo: undefined }));
    expect(Object.keys(state.u)).toEqual(['id', 'title']);
    setState('arr', reconcile([1, undefined], { key: null }));
    expect(1 in state.arr).toBe(true);
    expect(state.arr[1]).toBeUndefined();
    const chunk = [{ id: 1, text: 'ro' }] as const;
    setState('list', reconcile(chunk)); // Readonly / as const: Mutable<T> strips it
    expect(state.list[0].text).toBe('ro');
  });

  it('a frozen chunk (immer autoFreeze) reconciles: the frozen value is adopted raw and readable; the next chunk replaces it and its readers re-run', () => {
    const [state, setState] = createStore({ list: [] as Msg[] });
    const frozenChunk = Object.freeze([Object.freeze({ id: 1, text: 'a' })]) as unknown as Msg[];
    setState('list', reconcile(frozenChunk));
    const log = createRoot(() => track(() => state.list[0].text));
    expect(log).toEqual(['a']);
    setState('list', reconcile([{ id: 1, text: 'b' }]));
    flushSync();
    expect(log).toEqual(['a', 'b']);
  });

  it('1000 messages, all new objects, 10 changed: 10 row recomputes, the map does not run (spec §5)', () => {
    const [state, setState] = createStore({ messages: makeMessages((i) => `m${i}`) });
    let mapRuns = 0;
    let rowRuns = 0;
    createRoot(() => {
      const rows = mapArray(() => { mapRuns++; return state.messages; }, (m: Store<Msg>) => {
        createEffect(() => { rowRuns++; return m.text; }, () => {});
        return m.id;
      });
      createEffect(() => rows().length, () => {});
    });
    flushSync();
    expect(mapRuns).toBe(1);
    expect(rowRuns).toBe(1000);
    setState('messages', reconcile(makeMessages((i) => (i % 100 === 0 ? `edited${i}` : `m${i}`)))); // 10 changed, 990 equal but new objects
    flushSync();
    expect(rowRuns).toBe(1010);
    expect(mapRuns).toBe(1); // same identities at every index, same length: the shape did not notify
  });
});

describe('mapArray and For over store arrays', () => {
  it('mapArray: one shape link; an item content change re-runs only that row, not the map; new rows create only their own leaves', () => {
    const [state, setState] = createStore({ messages: [{ id: 1, text: 'one' }, { id: 2, text: 'two' }] as Msg[] });
    let mapRuns = 0;
    const rowRuns: number[] = [];
    createRoot(() => {
      const rows = mapArray(() => { mapRuns++; return state.messages; }, (m: Store<Msg>) => {
        createEffect(() => { rowRuns.push(m.id); return m.text; }, () => {});
        return m.id;
      });
      createEffect(() => rows().join(), () => {});
    });
    flushSync();
    const leafsBefore = storeStats.leafSignals;
    expect(mapRuns).toBe(1);
    expect(rowRuns).toEqual([1, 2]);
    setState('messages', 1, 'text', 'changed');
    flushSync();
    expect(mapRuns).toBe(1);
    expect(rowRuns).toEqual([1, 2, 2]);
    setState('messages', produce((l) => { l.unshift({ id: 0, text: 'zero' }); }));
    flushSync();
    expect(mapRuns).toBe(2);
    expect(rowRuns).toEqual([1, 2, 2, 0]); // kept rows are not re-created (keyed by item proxy)
    expect(storeStats.leafSignals - leafsBefore).toBe(2); // the new row's `id` and `text` (no per-index signals)
  });

  it('For, default keyed (by reference): reconcile and reorder keep rows; an edit updates one text node', () => {
    const [state, setState] = createStore({ list: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }, { id: 3, text: 'c' }] as Msg[] });
    const { ul, created } = mount(() => state.list);
    const li2 = ul.children[1];
    setState('list', reconcile([{ id: 3, text: 'c' }, { id: 2, text: 'B' }, { id: 1, text: 'a' }, { id: 4, text: 'd' }]));
    flushSync();
    expect([...ul.children].map((li) => li.textContent)).toEqual(['c', 'B', 'a', 'd']);
    expect(ul.children[1]).toBe(li2); // same row, moved, text updated in place
    expect(created).toEqual([1, 2, 3, 4]); // only the new item created a row
  });

  it('For keyed by id over a store array works too (keyFn runs untracked in the map: no id leaves)', () => {
    const [state, setState] = createStore({ list: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] as Msg[] });
    const before = storeStats.leafSignals;
    const { ul, created } = mount(() => state.list, (m) => m.id);
    const leafs = storeStats.leafSignals - before;
    setState('list', 1, 'text', 'B');
    flushSync();
    expect([...ul.children].map((li) => li.textContent)).toEqual(['a', 'B']);
    expect(created).toEqual([1, 2]);
    expect(leafs).toBe(1 /* list */ + 1 /* $TRACK shape */ + 2 /* text */);
  });
});

describe('zombie rows through the store (id list + entity lookup)', () => {
  it('no animation: deleting the entity and its id in one action never runs the removed row', () => {
    const [state, setState] = createStore(init());
    const { errors } = mountRows(state);
    setState('chats', produce((c) => { delete c[2]; })); // the entity first (worst order)
    setState('ids', (ids) => ids.filter((x) => x !== 2));
    flushSync();
    expect(errors).toEqual([]);
  });

  it('during an animation: a local change on a row whose entity was deleted (the list update is parked) does not run it stale', async () => {
    const [state, setState] = createStore(init());
    const [hover, setHover] = createSignal(false);
    const scope = createHeavyAnimationScope();
    const { errors, titles } = createRoot(() => { provideHeavyAnimationScope(scope); return mountRows(state, hover); });
    const end = scope.begin(Infinity);
    try {
      setState('chats', produce((c) => { delete c[2]; }));
      setState('ids', (ids) => ids.filter((x) => x !== 2));
      await flushMicrotasks();
      await frame();
      expect(titles).toEqual(['1:a', '2:b']); // parked: nothing ran
      setHover(true);
      await flushMicrotasks();
      await frame();
      expect(errors).toEqual([]);
      expect(titles).toEqual(['1:a', '2:b', '1:a*']); // row 1 ran on its local change; row 2 was disposed by the map pull
    } finally {
      end();
    }
  });
});

describe('reconcile at the top of a path (final review I3)', () => {
  it('another id replaces the object instead of merging into it (an aliased raw object stays intact)', () => {
    const [state, setState] = createStore<any>({
      chats: { a: { id: 'a', title: 'A' }, b: { id: 'b', title: 'B' } },
      current: null,
    });
    setState('current', state.chats.a);
    expect(unwrap(state.current)).toBe(unwrap(state.chats.a));
    setState('current', reconcile({ id: 'b', title: 'B2' }));
    expect(state.chats.a).toEqual({ id: 'a', title: 'A' });
    expect(state.current).toEqual({ id: 'b', title: 'B2' });
    // the same id still merges in place
    const cur = unwrap(state.current);
    setState('current', reconcile({ id: 'b', title: 'B3' }));
    expect(unwrap(state.current)).toBe(cur);
    expect(state.current.title).toBe('B3');
  });
  it('key: null merges whatever the ids are', () => {
    const [state, setState] = createStore<any>({ cur: { id: 1, t: 'x' } });
    const raw = unwrap(state.cur);
    setState('cur', reconcile({ id: 2, t: 'y' }, { key: null }));
    expect(unwrap(state.cur)).toBe(raw);
    expect(state.cur).toEqual({ id: 2, t: 'y' });
  });
});
