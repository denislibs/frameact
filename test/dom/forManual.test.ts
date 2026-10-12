import { createRoot, createSignal, untrack } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

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
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
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
  err.mockRestore();
});
