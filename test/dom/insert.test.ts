import { createMemo, createRoot, createSignal, mapArray } from '../../src/index';
import { insert, insertExpression } from '../../src/dom/insert';
import { SLOT } from '../../src/dom/reconcile';
import { render } from '../../src/dom/render';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

function rowsFor(list: () => number[]) {
  return mapArray(list, (n: number) => {
    const li = document.createElement('li');
    li.textContent = String(n);
    return li;
  });
}

describe('static values', () => {
  it('inserts primitives, nodes and arrays; null/booleans render nothing', () => {
    const el = container();
    insert(el, 'hi');
    expect(el.innerHTML).toBe('hi');
    const span = document.createElement('span');
    insert(el, ['a', span, 1, null, true, false, undefined], undefined, 'hi');
    expect(el.innerHTML).toBe('a<span></span>1');
    insert(el, null, undefined, el.childNodes);
    expect(el.innerHTML).toBe('');
  });
});

describe('reactive text', () => {
  it('first apply is synchronous; later updates land in the next frame, in place', async () => {
    const el = container();
    const [s, set] = createSignal('a');
    createRoot(() => insert(el, s));
    expect(el.innerHTML).toBe('a');
    const node = el.firstChild;
    set('b');
    expect(el.innerHTML).toBe('a');
    await frame();
    expect(el.innerHTML).toBe('b');
    expect(el.firstChild).toBe(node);
  });

  it('multi mode (marker): primitives become positional text nodes that are reused', async () => {
    const el = container();
    const marker = document.createTextNode('');
    el.append('x', marker, 'y');
    const [s, set] = createSignal<string | null>('a');
    createRoot(() => insert(el, s, marker));
    expect(el.textContent).toBe('xay');
    const text = marker.previousSibling!;
    set('b');
    await frame();
    expect(el.textContent).toBe('xby');
    expect(marker.previousSibling).toBe(text);
    set(null);
    await frame();
    expect(el.textContent).toBe('xy');
    expect(el.childNodes.length).toBe(4); // 'x', placeholder, marker, 'y'
  });

  it('marker null appends after existing static children', () => {
    const el = container();
    el.innerHTML = '<b>s</b>';
    insert(el, 'tail', null);
    expect(el.innerHTML).toBe('<b>s</b>tail');
  });
});

describe('arrays and function values', () => {
  it('a function value gets its own effect: the outer accessor does not track the inner list', async () => {
    const ul = container();
    const [cond, setCond] = createSignal(true);
    const [list, setList] = createSignal([1, 2]);
    const rows = rowsFor(list);
    const outer = vi.fn(() => (cond() ? rows : null));
    createRoot(() => insert(ul, outer));
    expect(ul.innerHTML).toBe('<li>1</li><li>2</li>');
    const first = ul.children[0];
    setList([1, 2, 3]);
    await frame();
    expect(ul.innerHTML).toBe('<li>1</li><li>2</li><li>3</li>');
    expect(ul.children[0]).toBe(first);
    expect(outer).toHaveBeenCalledTimes(1);
    setCond(false);
    await frame();
    expect(ul.innerHTML).toBe('');
    setCond(true);
    await frame();
    expect(ul.children.length).toBe(3);
    expect(outer).toHaveBeenCalledTimes(3);
  });

  it('reconciles keyed moves with existing nodes (one insertBefore for a swap)', async () => {
    const ul = container();
    const [list, setList] = createSignal([1, 2, 3]);
    createRoot(() => insert(ul, rowsFor(list)));
    const [a, b, c] = Array.from(ul.children);
    const spy = vi.spyOn(ul, 'insertBefore');
    setList([2, 1, 3]);
    await frame();
    expect(Array.from(ul.children)).toEqual([b, a, c]);
    expect(spy).toHaveBeenCalledTimes(1);
    setList([3]);
    await frame();
    expect(Array.from(ul.children)).toEqual([c]);
  });

  it('keyed-by-function map: an in-place item update touches no DOM structure and updates text in the same frame', async () => {
    const ul = container();
    type Item = { id: number; text: string };
    const [list, setList] = createSignal<Item[]>([{ id: 1, text: 'a' }, { id: 2, text: 'b' }]);
    const rows = mapArray(list, (item: () => Item) => {
      const li = document.createElement('li');
      insert(li, () => item().text);
      return li;
    }, { keyed: (i: Item) => i.id });
    createRoot(() => insert(ul, rows));
    expect(ul.innerHTML).toBe('<li>a</li><li>b</li>');
    const ins = vi.spyOn(ul, 'insertBefore');
    const rem = vi.spyOn(ul, 'removeChild');
    setList([{ id: 1, text: 'a' }, { id: 2, text: 'B' }]);
    await frame();
    expect(ul.innerHTML).toBe('<li>a</li><li>B</li>');
    expect(ins).not.toHaveBeenCalled();
    expect(rem).not.toHaveBeenCalled();
  });

  it('a static array containing a memo updates through the memo', async () => {
    const el = container();
    const [s, set] = createSignal('m');
    const b = document.createElement('b');
    createRoot(() => insert(el, [b, createMemo(() => s())]));
    expect(el.innerHTML).toBe('<b></b>m');
    set('n');
    await frame();
    expect(el.innerHTML).toBe('<b></b>n');
  });

  it('array items that are not nodes (row-mapper functions, plain objects) render as nothing, with a dev warning', () => {
    const el = container();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const b = document.createElement('b');
    insert(el, ['a', (item: unknown) => item, { not: 'a node' }, b]);
    expect(el.innerHTML).toBe('a<b></b>');
    expect(el.childNodes.length).toBe(4); // 'a', two empty placeholders, <b>
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('switching between a node, text and an array', async () => {
    const el = container();
    const span = document.createElement('span');
    const [v, set] = createSignal<unknown>(span);
    createRoot(() => insert(el, v));
    expect(el.firstChild).toBe(span);
    set('t');
    await frame();
    expect(el.innerHTML).toBe('t');
    set([1, 2]);
    await frame();
    expect(el.innerHTML).toBe('12');
    set(span);
    await frame();
    expect(el.innerHTML).toBe('<span></span>');
  });

  it('disposing the owner stops updates (nodes stay until the parent removes them)', async () => {
    const el = container();
    const [s, set] = createSignal('a');
    const dispose = createRoot((d) => {
      insert(el, s);
      return d;
    });
    dispose();
    set('b');
    await frame();
    expect(el.innerHTML).toBe('a');
  });
});

describe('render', () => {
  it('mounts synchronously into an attached container and the disposer clears it', async () => {
    const el = container();
    const [s, set] = createSignal('a');
    const dispose = render(() => s, el);
    expect(el.innerHTML).toBe('a');
    set('b');
    await frame();
    expect(el.innerHTML).toBe('b');
    dispose();
    expect(el.innerHTML).toBe('');
    set('c');
    await frame();
    expect(el.innerHTML).toBe('');
  });

  it('appends after existing children', () => {
    const el = container();
    el.innerHTML = '<i>x</i>';
    render(() => 'y', el);
    expect(el.innerHTML).toBe('<i>x</i>y');
  });
});

describe('foreign text nodes', () => {
  it('a Text node supplied by the user is never reused (or mutated) as a positional text slot', () => {
    const el = container();
    const marker = document.createTextNode('');
    el.append(marker);
    const t1 = document.createTextNode('row1');
    const t2 = document.createTextNode('row2');
    let current = insertExpression(el, [t1, t2], [], marker);
    expect(el.textContent).toBe('row1row2');
    current = insertExpression(el, ['header', t1, t2], current, marker);
    expect(el.textContent).toBe('headerrow1row2');
    expect(t1.data).toBe('row1');
    expect(current).toHaveLength(3);
  });
});

describe('slot ownership tags', () => {
  it('(a) a node moving into the last (marker null) slot is not removed by the slot it left', async () => {
    const el = container();
    const m = document.createTextNode('');
    el.append(m);
    const x = document.createElement('i');
    const [a, setA] = createSignal(true);
    createRoot(() => {
      insert(el, () => (a() ? null : [x, 'tail']), null);
      insert(el, () => (a() ? x : null), m);
    });
    expect(el.innerHTML).toBe('<i></i>');
    setA(false);
    await frame();
    expect(el.innerHTML).toBe('<i></i>tail');
    expect((x as any)[SLOT]).toBeNull();
    setA(true);
    await frame();
    expect(el.innerHTML).toBe('<i></i>');
  });

  it('(b) a node that lived in a multi slot of another parent is reconciled normally in root mode', async () => {
    const p1 = container();
    const m = document.createTextNode('');
    p1.append(m);
    const x = document.createElement('i');
    insert(p1, [x], m);
    const p2 = container();
    const y = document.createElement('b');
    const [l, setL] = createSignal<Node[]>([x, y]);
    createRoot(() => insert(p2, () => l()));
    expect(p2.innerHTML).toBe('<i></i><b></b>');
    setL([y]);
    await frame();
    expect(p2.innerHTML).toBe('<b></b>');
  });
});
