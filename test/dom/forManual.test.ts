import { createRoot, createSignal, onError, untrack } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { reconcileManual } from '../../src/dom/reconcile';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

afterEach(() => {
  vi.restoreAllMocks();
});

type Chat = { id: number; rank: number };

function row(item: () => Chat): HTMLLIElement {
  const el = document.createElement('li');
  el.dataset.id = String(untrack(() => item().id));
  return el;
}

function mount(ul: HTMLElement, list: () => Chat[], orderKey?: (c: Chat) => unknown) {
  return createRoot((dispose) => {
    insert(
      ul,
      createComponent(
        () =>
          For({
            get each() { return list(); },
            keyed: (c: Chat) => c.id,
            order: 'manual',
            orderKey,
            children: row,
          }),
        {},
      ),
    );
    return dispose;
  });
}

const ids = (ul: HTMLElement) => Array.from(ul.children).map((e) => (e as HTMLElement).dataset.id);

it('kept rows do not move when only the list order changes', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>([{ id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }]);
  mount(ul, list, (c) => c.rank);
  expect(ids(ul)).toEqual(['1', '2', '3']);
  const ins = vi.spyOn(ul, 'insertBefore');
  const [c1, c2, c3] = list();
  setList([c3, c1, c2]);
  await frame();
  expect(ids(ul)).toEqual(['1', '2', '3']);
  expect(ins).not.toHaveBeenCalled();
});

it('a kept row whose orderKey changed moves to its list position', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>([{ id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }]);
  mount(ul, list, (c) => c.rank);
  const [c1, c2] = list();
  const [l1, l2, l3] = Array.from(ul.children);
  setList([{ id: 3, rank: 0 }, c1, c2]);
  await frame();
  expect(ids(ul)).toEqual(['3', '1', '2']);
  expect(Array.from(ul.children)).toEqual([l3, l1, l2]); // same row nodes, one move
});

it('an orderKey change at unchanged list positions moves the row on that same recompute', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>([{ id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }]);
  mount(ul, list, (c) => c.rank);
  const [c1, c2, c3] = list();
  setList([c3, c1, c2]); // the list order changes, the DOM order does not
  await frame();
  expect(ids(ul)).toEqual(['1', '2', '3']);
  const [l1, l2, l3] = Array.from(ul.children);
  // Same ids at the same list positions (mapArray yields the very same rows array); only row 1's orderKey differs.
  setList([c3, { id: 1, rank: 9 }, c2]);
  await frame();
  // Row 1 now sits at its list index (1); the kept rows 2 and 3 fill the other slots in their DOM order.
  expect(ids(ul)).toEqual(['2', '1', '3']);
  expect(Array.from(ul.children)).toEqual([l2, l1, l3]);
});

it('prepend/append batches insert new rows around kept ones; removals drop rows', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>([{ id: 1, rank: 1 }, { id: 2, rank: 2 }, { id: 3, rank: 3 }]);
  mount(ul, list, (c) => c.rank);
  const kept = Array.from(ul.children);
  const ins = vi.spyOn(ul, 'insertBefore');
  setList([{ id: 10, rank: 0 }, { id: 11, rank: 0 }, ...list()]);
  await frame();
  expect(ids(ul)).toEqual(['10', '11', '1', '2', '3']);
  expect(ins).toHaveBeenCalledTimes(2);
  expect(Array.from(ul.children).slice(2)).toEqual(kept);
  ins.mockClear();
  setList([...list(), { id: 12, rank: 9 }]);
  await frame();
  expect(ids(ul)).toEqual(['10', '11', '1', '2', '3', '12']);
  expect(ins).toHaveBeenCalledTimes(1);
  ins.mockClear();
  setList(list().filter((c) => c.id !== 1));
  await frame();
  expect(ids(ul)).toEqual(['10', '11', '2', '3', '12']);
  expect(ins).not.toHaveBeenCalled();
});

it('without orderKey, kept rows never move; new rows still take their list index', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>([{ id: 1, rank: 1 }, { id: 2, rank: 2 }]);
  mount(ul, list);
  const [c1, c2] = list();
  setList([c2, { id: 9, rank: 0 }, c1]);
  await frame();
  expect(ids(ul)).toEqual(['1', '9', '2']);
});

it('works with fallback: shown for an empty list, rows take their list indexes, the fallback returns', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>([]);
  createRoot(() => {
    insert(
      ul,
      createComponent(
        () =>
          For({
            get each() { return list(); },
            keyed: (c: Chat) => c.id,
            order: 'manual',
            orderKey: (c: Chat) => c.rank,
            get fallback() {
              const i = document.createElement('i');
              i.textContent = 'none';
              return i;
            },
            children: row,
          }),
        {},
      ),
    );
  });
  expect(ul.innerHTML).toBe('<i>none</i>');
  setList([{ id: 1, rank: 1 }, { id: 2, rank: 2 }]);
  await frame();
  expect(ids(ul)).toEqual(['1', '2']);
  expect(ul.querySelector('i')).toBeNull();
  const [c1, c2] = list();
  setList([{ id: 3, rank: 0 }, c1, c2]);
  await frame();
  expect(ids(ul)).toEqual(['3', '1', '2']);
  setList([]);
  await frame();
  expect(ul.innerHTML).toBe('<i>none</i>');
});

it('a row whose mapper threw is skipped without disturbing the order of the others', async () => {
  const ul = container();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const [list, setList] = createSignal<Chat[]>([{ id: 1, rank: 1 }, { id: 2, rank: 2 }]);
  createRoot(() => {
    insert(
      ul,
      createComponent(
        () =>
          For({
            get each() { return list(); },
            keyed: (c: Chat) => c.id,
            order: 'manual',
            orderKey: (c: Chat) => c.rank,
            children: (item: () => Chat) => {
              if (untrack(() => item().id) === 2) throw new Error('boom');
              return row(item);
            },
          }),
        {},
      ),
    );
  });
  expect(ids(ul)).toEqual(['1']);
  const [c1] = list();
  setList([{ id: 3, rank: 0 }, { id: 2, rank: 2 }, c1]);
  await frame();
  expect(ids(ul)).toEqual(['3', '1']);
  setList([{ id: 4, rank: 0 }, { id: 3, rank: 0 }, { id: 2, rank: 2 }, c1]);
  await frame();
  expect(ids(ul)).toEqual(['4', '3', '1']);
});

// --- insert-only reconcile: kept rows are never detached or moved -----------------------------------

/** Counts DOM writes on `ul`; `touched` = nodes that appeared in any childList record (added or removed). */
function watch(ul: HTMLElement) {
  const spies = {
    insertBefore: vi.spyOn(ul, 'insertBefore'),
    replaceChild: vi.spyOn(ul, 'replaceChild'),
    removeChild: vi.spyOn(ul, 'removeChild'),
    appendChild: vi.spyOn(ul, 'appendChild'),
  };
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(ul, { childList: true });
  return {
    spies,
    /** nodes added or removed since the last call, one entry per record side */
    touched(): Node[] {
      const out: Node[] = [];
      records.push(...observer.takeRecords());
      for (const r of records.splice(0)) out.push(...Array.from(r.removedNodes), ...Array.from(r.addedNodes));
      return out;
    },
    stop: () => observer.disconnect(),
  };
}

const rows = (...cs: Chat[]) => cs;
const chat = (id: number, rank = id): Chat => ({ id, rank });

it('[1,2,3] -> [100,1,3]: no replaceChild, kept rows 1 and 3 are never detached', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2), chat(3)));
  mount(ul, list, (c) => c.rank);
  const [l1, l2, l3] = Array.from(ul.children);
  const [c1, , c3] = list();
  const w = watch(ul);
  setList([chat(100, 0), c1, c3]);
  await frame();
  expect(ids(ul)).toEqual(['100', '1', '3']);
  expect(w.spies.replaceChild).not.toHaveBeenCalled();
  expect(w.spies.insertBefore).toHaveBeenCalledTimes(1);
  expect(w.spies.insertBefore.mock.calls[0][1]).toBe(l1);
  const touched = w.touched();
  expect(touched).toContain(l2); // removed
  expect(touched).not.toContain(l1);
  expect(touched).not.toContain(l3);
  w.stop();
});

it('[1,2,3] -> [100,101,1,102,3]: every contiguous run goes before one anchor, kept rows untouched', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2), chat(3)));
  mount(ul, list, (c) => c.rank);
  const [l1, l2, l3] = Array.from(ul.children);
  const [c1, , c3] = list();
  const w = watch(ul);
  setList([chat(100, 0), chat(101, 0), c1, chat(102, 0), c3]);
  await frame();
  expect(ids(ul)).toEqual(['100', '101', '1', '102', '3']);
  expect(w.spies.replaceChild).not.toHaveBeenCalled();
  expect(w.spies.insertBefore.mock.calls.map((c) => c[1])).toEqual([l1, l1, l3]);
  const touched = w.touched();
  expect(touched).toContain(l2);
  expect(touched).not.toContain(l1);
  expect(touched).not.toContain(l3);
  w.stop();
});

it('prepending 50 rows to 100: 50 insertions on one anchor, no kept row touched', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>(Array.from({ length: 100 }, (_, i) => chat(i + 1)));
  mount(ul, list, (c) => c.rank);
  const first = ul.firstElementChild;
  const keptNodes = Array.from(ul.children);
  const w = watch(ul);
  setList([...Array.from({ length: 50 }, (_, i) => chat(1000 + i, 0)), ...list()]);
  await frame();
  expect(ul.children.length).toBe(150);
  expect(w.spies.insertBefore).toHaveBeenCalledTimes(50);
  expect(w.spies.insertBefore.mock.calls.every((c) => c[1] === first)).toBe(true);
  expect(w.spies.replaceChild).not.toHaveBeenCalled();
  const touched = new Set(w.touched());
  expect(keptNodes.some((n) => touched.has(n))).toBe(false);
  w.stop();
});

it('an orderKey change moves exactly that one row, once, and nothing else is touched (up and down)', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2), chat(3), chat(4)));
  mount(ul, list, (c) => c.rank);
  const [l1, l2, l3, l4] = Array.from(ul.children);
  const [c1, c2, c3] = list();
  const w = watch(ul);
  setList([chat(4, 0), c1, c2, c3]); // row 4 jumps to the top
  await frame();
  expect(Array.from(ul.children)).toEqual([l4, l1, l2, l3]);
  expect(w.spies.insertBefore).toHaveBeenCalledTimes(1);
  expect(w.touched().filter((n) => n !== l4)).toEqual([]);
  w.spies.insertBefore.mockClear();
  const [d4, d1, d2, d3] = list();
  setList([d4, d2, d3, { ...d1, rank: 99 }]); // row 1 goes to the bottom
  await frame();
  expect(Array.from(ul.children)).toEqual([l4, l2, l3, l1]);
  expect(w.spies.insertBefore).toHaveBeenCalledTimes(1);
  expect(w.touched().filter((n) => n !== l1)).toEqual([]);
  w.stop();
});

it('removals mixed with inserts around kept rows', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>(Array.from({ length: 6 }, (_, i) => chat(i + 1)));
  mount(ul, list, (c) => c.rank);
  const l = Array.from(ul.children);
  const cs = list();
  const w = watch(ul);
  setList([chat(7, 0), cs[1], chat(8, 0), cs[4], chat(9, 0)]);
  await frame();
  expect(ids(ul)).toEqual(['7', '2', '8', '5', '9']);
  expect(w.spies.replaceChild).not.toHaveBeenCalled();
  expect(w.spies.insertBefore).toHaveBeenCalledTimes(3);
  const touched = w.touched();
  expect(touched).not.toContain(l[1]);
  expect(touched).not.toContain(l[4]);
  for (const i of [0, 2, 3, 5]) expect(touched).toContain(l[i]);
  w.stop();
});

it('inside a slot with a marker, siblings stay put and rows stay before the marker', async () => {
  const ul = container();
  const head = document.createElement('b');
  const tail = document.createElement('u');
  ul.append(head, tail);
  const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2)));
  createRoot(() => {
    insert(
      ul,
      createComponent(() => For({ get each() { return list(); }, keyed: (c: Chat) => c.id, order: 'manual', orderKey: (c: Chat) => c.rank, children: row }), {}),
      tail,
    );
  });
  const names = () => Array.from(ul.children).map((e) => e.tagName === 'LI' ? (e as HTMLElement).dataset.id : e.tagName);
  expect(names()).toEqual(['B', '1', '2', 'U']);
  const [c1] = list();
  setList([chat(5, 0), c1, chat(6, 0)]);
  await frame();
  expect(names()).toEqual(['B', '5', '1', '6', 'U']);
  setList([]);
  await frame();
  expect(names()).toEqual(['B', 'U']);
  setList([chat(7)]);
  await frame();
  expect(names()).toEqual(['B', '7', 'U']);
});

it('two failed rows: removing one of them does not drop the kept row (no orderKey)', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const ul = container();
  const [list, setList] = createSignal<Chat[]>([]);
  createRoot(() => {
    insert(
      ul,
      createComponent(
        () =>
          For({
            get each() { return list(); },
            keyed: (c: Chat) => c.id,
            order: 'manual',
            children: (item: () => Chat) => {
              if (untrack(() => item().id) !== 1) throw new Error('boom');
              return row(item);
            },
          }),
        {},
      ),
    );
  });
  const [c2, c3, c1] = [chat(2), chat(3), chat(1)];
  setList([c2, c3, c1]);
  await frame();
  expect(ids(ul)).toEqual(['1']);
  setList([c2, c1]);
  await frame();
  expect(ids(ul)).toEqual(['1']);
  setList([c1]);
  await frame();
  expect(ids(ul)).toEqual(['1']);
});

it('a throwing orderKey is logged; the list update is not lost and the row keeps its place', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const ul = container();
  const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2)));
  mount(ul, list, (c) => {
    if (c.rank === 66) throw new Error('bad key');
    return c.rank;
  });
  const [c1, c2] = list();
  setList([chat(5, 0), c1, { ...c2, rank: 66 }]);
  await frame();
  expect(ids(ul)).toEqual(['5', '1', '2']);
  expect(err.mock.calls.some((c) => String(c[0]).includes('orderKey failed'))).toBe(true);
});

it('orderKey values are compared with Object.is: a stable NaN key never moves a row', async () => {
  const ul = container();
  const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2), chat(3)));
  mount(ul, list, () => NaN);
  const [c1, c2, c3] = list();
  const ins = vi.spyOn(ul, 'insertBefore');
  setList([c3, c2, c1]);
  await frame();
  expect(ids(ul)).toEqual(['1', '2', '3']);
  expect(ins).not.toHaveBeenCalled();
});

it('DEV: a row that is not a DOM node is reported once', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ul = container();
  const [list, setList] = createSignal<Chat[]>(rows(chat(1)));
  createRoot(() => {
    insert(
      ul,
      createComponent(
        () =>
          For({
            get each() { return list(); },
            keyed: (c: Chat) => c.id,
            order: 'manual',
            children: (item: () => Chat) => ({ notANode: untrack(() => item().id) }),
          }),
        {},
      ),
    );
  });
  setList([chat(1), chat(2)]);
  await frame();
  const calls = err.mock.calls.filter((c) => String(c[0]).includes('must be a single DOM node'));
  expect(calls).toHaveLength(1);
});

it('reconcileManual moves a kept node that is out of DOM order but not listed as moved (memo ran ahead)', () => {
  const parent = document.createElement('div');
  const [a, b, c] = ['a', 'b', 'c'].map((t) => {
    const el = document.createElement('i');
    el.textContent = t;
    return el;
  });
  parent.append(a, b, c);
  const ins = vi.spyOn(parent, 'insertBefore');
  reconcileManual(parent, [a, b, c], [b, c, a], null, new Set());
  expect(parent.textContent).toBe('bca');
  expect(ins).toHaveBeenCalledTimes(1);
  expect(ins.mock.calls[0][0]).toBe(a);
});

it('a throwing orderKey reaches onError (no console fallback)', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const ul = container();
  const handler = vi.fn();
  const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2)));
  createRoot(() => {
    onError(handler);
    insert(
      ul,
      createComponent(
        () =>
          For({
            get each() { return list(); },
            keyed: (c: Chat) => c.id,
            order: 'manual',
            orderKey: (c: Chat) => {
              if (c.rank === 66) throw new Error('bad key');
              return c.rank;
            },
            children: row,
          }),
        {},
      ),
    );
  });
  const [c1] = list();
  setList([chat(5, 0), c1, chat(2, 66)]);
  await frame();
  expect(ids(ul)).toEqual(['5', '1', '2']);
  expect(handler).toHaveBeenCalledTimes(1);
  expect((handler.mock.calls[0][0] as Error).message).toBe('bad key');
  expect(err.mock.calls.some((c) => String(c[0]).includes('orderKey failed'))).toBe(false);
});

it('DEV: For order="manual" nested in a larger array warns once and still renders (ordinary diff)', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ul = container();
  const header = document.createElement('h1');
  const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2)));
  createRoot(() => {
    insert(
      ul,
      createComponent(
        () => [
          header,
          For({ get each() { return list(); }, keyed: (c: Chat) => c.id, order: 'manual', orderKey: (c: Chat) => c.rank, children: row }),
        ],
        {},
      ),
    );
  });
  const [c1] = list();
  setList([chat(3, 0), c1]);
  await frame();
  expect(Array.from(ul.children).map((e) => (e as HTMLElement).dataset.id ?? e.tagName)).toEqual(['H1', '3', '1']);
  expect(warn.mock.calls.filter((c) => String(c[0]).includes('nested in a larger array'))).toHaveLength(1);
});

function mountRows(list: () => Chat[], orderKey: ((c: Chat) => unknown) | undefined) {
  const ul = container();
  let order!: () => unknown[];
  createRoot(() => {
    order = For({
      get each() { return list(); },
      keyed: (c: Chat) => c.id,
      order: 'manual',
      orderKey,
      children: row,
    }) as () => unknown[];
    insert(ul, order);
  });
  return { ul, order };
}

describe('fast path: same rows, same order keys', () => {
  it('editing a non-order field of one item hands insert the very same array and touches no DOM', async () => {
    const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2), chat(3)));
    const keyFn = vi.fn((c: Chat) => c.rank);
    const { ul, order } = mountRows(list, keyFn);
    const before = order();
    const spies = (['insertBefore', 'appendChild', 'removeChild', 'replaceChild'] as const).map((m) => vi.spyOn(ul, m));
    const observer = new MutationObserver(() => {});
    observer.observe(ul, { childList: true, subtree: true, characterData: true, attributes: true });
    const [c1, c2, c3] = list();
    setList([c1, { ...c2 }, c3]);
    await frame();
    expect(order()).toBe(before);
    expect(observer.takeRecords()).toEqual([]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(ids(ul)).toEqual(['1', '2', '3']);
    observer.disconnect();
  });

  it('without an orderKey the array identity is kept too', async () => {
    const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2)));
    const { order } = mountRows(list, undefined);
    const before = order();
    const [c1, c2] = list();
    setList([c1, { ...c2 }]);
    await frame();
    expect(order()).toBe(before);
  });

  it('a changed orderKey is not the fast path: a new array, the row moves', async () => {
    const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2), chat(3)));
    const { ul, order } = mountRows(list, (c) => c.rank);
    const before = order();
    const [c1, c2, c3] = list();
    setList([c1, c2, { ...c3, rank: 0 }]);
    await frame();
    expect(order()).not.toBe(before);
    expect(ids(ul)).toEqual(['1', '2', '3']); // kept rows stay; only a MOVE to its list index is (re)applied
  });

  it('a new array after a structural change, then the fast path again on the next edit', async () => {
    const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2)));
    const { ul, order } = mountRows(list, (c) => c.rank);
    const [c1, c2] = list();
    setList([c1, c2, chat(3)]);
    await frame();
    const before = order();
    expect(ids(ul)).toEqual(['1', '2', '3']);
    setList([c1, { ...c2 }, list()[2]]);
    await frame();
    expect(order()).toBe(before);
  });

  it('a throwing orderKey on an unchanged row keeps the fast path and is reported each time it is evaluated', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [list, setList] = createSignal<Chat[]>(rows(chat(1), chat(2)));
    const { order } = mountRows(list, (c) => {
      if (c.rank === 2) throw new Error('bad key');
      return c.rank;
    });
    const before = order();
    const [c1, c2] = list();
    setList([c1, { ...c2 }]);
    await frame();
    expect(order()).toBe(before);
    expect(err.mock.calls.filter((c) => String(c[0]).includes('orderKey failed')).length).toBeGreaterThanOrEqual(2);
  });
});
