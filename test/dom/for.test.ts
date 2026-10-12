import { createRoot, createSignal, onCleanup } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

type Item = { id: number; text: string };

const read = (item: string | (() => string)) => (typeof item === 'function' ? item() : item);

const throwingRow = (item: string | (() => string)) => {
  if (read(item) === 'boom') throw new Error('boom');
  return li(read(item));
};

function li(content: unknown): HTMLLIElement {
  const el = document.createElement('li');
  insert(el, content);
  return el;
}

// `render` calls `For({...})` directly so the props are checked against the overloads.
function mount(ul: HTMLElement, render: () => unknown) {
  return createRoot((dispose) => {
    insert(ul, createComponent(render, {}));
    return dispose;
  });
}

it('keyed by reference (default): rows keep identity across reorders; removed rows are recreated when they return', async () => {
  const ul = container();
  const a = { id: 1, text: 'a' }, b = { id: 2, text: 'b' }, c = { id: 3, text: 'c' };
  const [list, setList] = createSignal([a, b, c]);
  mount(ul, () => For({ get each() { return list(); }, children: (item: Item) => li(item.text) }));
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
  mount(ul, () => For({ get each() { return list(); }, children: (item: string, i: () => number) => li(() => `${i()}:${item}`) }));
  expect(ul.textContent).toBe('0:x1:y');
  setList(['y', 'x']);
  await frame();
  expect(ul.textContent).toBe('0:y1:x');
});

it('keyed: false maps by index: items are accessors, rows are reused in place', async () => {
  const ul = container();
  const [list, setList] = createSignal(['x', 'y']);
  mount(ul, () => For({ get each() { return list(); }, keyed: false, children: (item: () => string, i: number) => li(() => `${i}:${item()}`) }));
  const first = ul.children[0];
  setList(['y', 'x', 'z']);
  await frame();
  expect(ul.textContent).toBe('0:y1:x2:z');
  expect(ul.children[0]).toBe(first);
});

it('keyed by function: a replaced object with the same key updates the row in place; reorders move nodes', async () => {
  const ul = container();
  const [list, setList] = createSignal<Item[]>([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  mount(ul, () => For({ get each() { return list(); }, keyed: (i: Item) => i.id, children: (item: () => Item) => li(() => item().text) }));
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
  let cleaned = 0;
  const fallback = vi.fn(() => {
    onCleanup(() => cleaned++);
    const i = document.createElement('i');
    i.textContent = 'none';
    return i;
  });
  mount(ul, () => For({ get each() { return list(); }, get fallback() { return fallback(); }, children: (item: string) => li(item) }));
  expect(ul.innerHTML).toBe('<i>none</i>');
  setList(['a']);
  await frame();
  expect(ul.innerHTML).toBe('<li>a</li>');
  expect(cleaned).toBe(1);
  setList([]);
  await frame();
  expect(ul.innerHTML).toBe('<i>none</i>');
  expect(fallback).toHaveBeenCalledTimes(2);
});

it.each([
  ['by reference', undefined],
  ['by index', false],
  ['by key', (s: string) => s],
] as const)('a throwing row mapper (%s) renders nothing for that row and is reported; the others render', (_mode, keyed) => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const ul = container();
  const [list] = createSignal(['ok', 'boom', 'ok2']);
  mount(ul, () => For({ get each() { return list(); }, keyed, children: throwingRow } as any));
  expect(ul.innerHTML).toBe('<li>ok</li><li>ok2</li>');
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

it('disposing the owner disposes the rows (their effects stop)', async () => {
  const ul = container();
  const [list] = createSignal(['x']);
  const [s, set] = createSignal('1');
  const dispose = mount(ul, () => For({ get each() { return list(); }, children: () => li(s) }));
  expect(ul.textContent).toBe('1');
  dispose();
  set('2');
  await frame();
  expect(ul.textContent).toBe('1');
});

it('empty to empty does not recreate the fallback', async () => {
  const ul = container();
  const [list, setList] = createSignal<string[]>([]);
  const fallback = vi.fn(() => document.createElement('i'));
  mount(ul, () => For({ get each() { return list(); }, get fallback() { return fallback(); }, children: (item: string) => li(item) }));
  const el = ul.firstChild;
  setList([]);
  await frame();
  expect(ul.firstChild).toBe(el);
  expect(fallback).toHaveBeenCalledTimes(1);
});

it.each([null, false, undefined] as const)('each = %s renders the fallback and no rows', (value) => {
  const ul = container();
  mount(ul, () => For({ each: value, fallback: 'none', children: (item: string) => li(item) }));
  expect(ul.textContent).toBe('none');
});

it('keyed by function: the index accessor shifts in the same frame on prepend', async () => {
  const ul = container();
  const [list, setList] = createSignal<Item[]>([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
  mount(ul, () => For({
    get each() { return list(); },
    keyed: (i: Item) => i.id,
    children: (item: () => Item, i: () => number) => li(() => `${i()}${item().text}`),
  }));
  expect(ul.textContent).toBe('0a1b');
  const [la] = Array.from(ul.children);
  setList([{ id: 0, text: 'z' }, { id: 1, text: 'a' }, { id: 2, text: 'B' }]);
  await frame();
  expect(ul.textContent).toBe('0z1a2B');
  expect(ul.children[1]).toBe(la);
});

it('keyed by function: duplicate keys warn (DEV) and every row still renders', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ul = container();
  const [list] = createSignal<Item[]>([{ id: 1, text: 'a' }, { id: 1, text: 'a2' }, { id: 2, text: 'b' }]);
  mount(ul, () => For({ get each() { return list(); }, keyed: (i: Item) => i.id, children: (item: () => Item) => li(() => item().text) }));
  expect(ul.textContent).toBe('aa2b');
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate key'), 1, expect.anything());
  warn.mockRestore();
});

it('removed rows are disposed in every mode (cleanup runs, their effects stop)', async () => {
  const cases = [
    (children: (item: any) => unknown, each: () => string[]) => For({ get each() { return each(); }, keyed: false, children } as any),
    (children: (item: any) => unknown, each: () => string[]) => For({ get each() { return each(); }, keyed: (s: string) => s, children } as any),
    (children: (item: any) => unknown, each: () => string[]) => For({ get each() { return each(); }, children } as any),
  ];
  for (const make of cases) {
    const ul = container();
    const [list, setList] = createSignal(['x', 'y']);
    const [s, set] = createSignal('1');
    let cleaned = 0;
    const dispose = mount(ul, () => make(() => {
      onCleanup(() => cleaned++);
      return li(s);
    }, list));
    setList(['x']);
    await frame();
    expect(cleaned).toBe(1);
    expect(ul.children.length).toBe(1);
    set('2');
    await frame();
    expect(ul.textContent).toBe('2');
    dispose();
    expect(cleaned).toBe(2);
  }
});

// Type contract of the three overloads (compile-time only; never called).
export function typeContract() {
  For({ each: [1], children: (item: number, i: () => number) => item + i() });
  For({ each: [1], keyed: false, children: (item: () => number, i: number) => item() + i });
  For({ each: [1], keyed: (n: number) => n, children: (item: () => number, i: () => number) => item() + i() });
  // @ts-expect-error default mode: item is a value and index is an accessor
  For({ each: [1], children: (item: () => number, i: number) => item() + i });
  // @ts-expect-error keyed: false: item is an accessor and index is a number
  For({ each: [1], keyed: false, children: (item: number, i: () => number) => item + i() });
  // @ts-expect-error keyed by function: item is an accessor
  For({ each: [1], keyed: (n: number) => n, children: (item: number) => item });
}
