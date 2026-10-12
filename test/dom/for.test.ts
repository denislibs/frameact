import { createRoot, createSignal } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

type Item = { id: number; text: string };

function li(content: unknown): HTMLLIElement {
  const el = document.createElement('li');
  insert(el, content);
  return el;
}

function mount(ul: HTMLElement, props: any) {
  return createRoot((dispose) => {
    insert(ul, createComponent(For as any, props));
    return dispose;
  });
}

it('keyed by reference (default): rows keep identity across reorders; removed rows are recreated when they return', async () => {
  const ul = container();
  const a = { id: 1, text: 'a' }, b = { id: 2, text: 'b' }, c = { id: 3, text: 'c' };
  const [list, setList] = createSignal([a, b, c]);
  mount(ul, { get each() { return list(); }, children: (item: Item) => li(item.text) });
  expect(ul.innerHTML).toBe('<li>a</li><li>b</li><li>c</li>');
  const [la, lb, lc] = Array.from(ul.children);
  setList([c, a]);
  await frame();
  expect(Array.from(ul.children)).toEqual([lc, la]);
  setList([c, a, b]);
  await frame();
  expect(ul.innerHTML).toBe('<li>c</li><li>a</li><li>b</li>');
  expect(ul.children[2]).not.toBe(lb);
});

it('index accessor updates in the same frame when rows move', async () => {
  const ul = container();
  const [list, setList] = createSignal(['x', 'y']);
  mount(ul, { get each() { return list(); }, children: (item: string, i: () => number) => li(() => `${i()}:${item}`) });
  expect(ul.textContent).toBe('0:x1:y');
  setList(['y', 'x']);
  await frame();
  expect(ul.textContent).toBe('0:y1:x');
});

it('keyed: false maps by index: items are accessors, rows are reused in place', async () => {
  const ul = container();
  const [list, setList] = createSignal(['x', 'y']);
  mount(ul, { get each() { return list(); }, keyed: false, children: (item: () => string, i: number) => li(() => `${i}:${item()}`) });
  const first = ul.children[0];
  setList(['y', 'x', 'z']);
  await frame();
  expect(ul.textContent).toBe('0:y1:x2:z');
  expect(ul.children[0]).toBe(first);
});

it('keyed by function: a replaced object with the same key updates the row in place; reorders move nodes', async () => {
  const ul = container();
  const [list, setList] = createSignal<Item[]>([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  mount(ul, { get each() { return list(); }, keyed: (i: Item) => i.id, children: (item: () => Item) => li(() => item().text) });
  const [la, lb] = Array.from(ul.children);
  const ins = vi.spyOn(ul, 'insertBefore');
  setList([{ id: 1, text: 'a' }, { id: 2, text: 'B' }]);
  await frame();
  expect(ul.innerHTML).toBe('<li>a</li><li>B</li>');
  expect(ins).not.toHaveBeenCalled();
  expect(ul.children[1]).toBe(lb);
  setList([{ id: 2, text: 'B' }, { id: 1, text: 'a' }]);
  await frame();
  expect(Array.from(ul.children)).toEqual([lb, la]);
});

it('fallback renders while the list is empty and is disposed when rows arrive', async () => {
  const ul = container();
  const [list, setList] = createSignal<string[]>([]);
  const fallback = vi.fn(() => {
    const i = document.createElement('i');
    i.textContent = 'none';
    return i;
  });
  mount(ul, { get each() { return list(); }, get fallback() { return fallback(); }, children: (item: string) => li(item) });
  expect(ul.innerHTML).toBe('<i>none</i>');
  setList(['a']);
  await frame();
  expect(ul.innerHTML).toBe('<li>a</li>');
  setList([]);
  await frame();
  expect(ul.innerHTML).toBe('<i>none</i>');
  expect(fallback).toHaveBeenCalledTimes(2);
});

it('a throwing row mapper renders nothing for that row and is reported; the others render', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const ul = container();
  const [list] = createSignal(['ok', 'boom', 'ok2']);
  mount(ul, {
    get each() { return list(); },
    children: (item: string) => {
      if (item === 'boom') throw new Error('boom');
      return li(item);
    },
  });
  expect(ul.innerHTML).toBe('<li>ok</li><li>ok2</li>');
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

it('disposing the owner disposes the rows (their effects stop)', async () => {
  const ul = container();
  const [list] = createSignal(['x']);
  const [s, set] = createSignal('1');
  const dispose = mount(ul, { get each() { return list(); }, children: () => li(s) });
  expect(ul.textContent).toBe('1');
  dispose();
  set('2');
  await frame();
  expect(ul.textContent).toBe('1');
});
