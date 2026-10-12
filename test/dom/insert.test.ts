import { createMemo, createRoot, createSignal, mapArray } from '../../src/index';
import { HOST_KEY, insert, insertExpression } from '../../src/dom/insert';
import { reconcileArrays, SLOT } from '../../src/dom/reconcile';
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
    const observer = new MutationObserver(() => {});
    observer.observe(ul, { childList: true });
    setList([{ id: 1, text: 'a' }, { id: 2, text: 'B' }]);
    await frame();
    expect(ul.innerHTML).toBe('<li>a</li><li>B</li>');
    expect(ins).not.toHaveBeenCalled();
    // remove() / replaceChild() / insertBefore() all surface as childList records
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
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
    try {
      const b = document.createElement('b');
      insert(el, ['a', (item: unknown) => item, { not: 'a node' }, b]);
      expect(el.innerHTML).toBe('a<b></b>');
      expect(el.childNodes.length).toBe(4); // 'a', two empty placeholders, <b>
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
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

describe('render: pre-existing children', () => {
  it('the disposer removes only what render inserted, and stops updating', async () => {
    const el = container();
    el.innerHTML = '<i>x</i>';
    const [s, set] = createSignal<unknown>('a');
    const dispose = render(() => s, el);
    expect(el.innerHTML).toBe('<i>x</i>a');
    set([document.createElement('b'), 'c']);
    await frame();
    expect(el.innerHTML).toBe('<i>x</i><b></b>c');
    dispose();
    expect(el.innerHTML).toBe('<i>x</i>');
    set('d');
    await frame();
    expect(el.innerHTML).toBe('<i>x</i>');
  });

  it('nodes appended by others after the mount survive the disposer', () => {
    const el = container();
    el.innerHTML = '<i>x</i>';
    const dispose = render(() => 'a', el);
    el.append(document.createElement('u'));
    dispose();
    expect(el.innerHTML).toBe('<i>x</i><u></u>');
  });

  it('renders a node into an empty container; the disposer empties it', () => {
    const el = container();
    const span = document.createElement('span');
    const dispose = render(() => span, el);
    expect(el.firstChild).toBe(span);
    dispose();
    expect(el.innerHTML).toBe('');
  });
});

describe('top-level parameterized function (a row mapper is a value, not an accessor)', () => {
  it.each([
    ['root mode', undefined],
    ['multi mode', null],
  ])('%s: warns and renders as nothing, clearing old content', (_name, marker) => {
    const el = container();
    el.innerHTML = 'old';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      insert(el, (item: unknown) => item, marker, marker === undefined ? 'old' : undefined);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(el.textContent).toBe(marker === undefined ? '' : 'old');
    } finally {
      warn.mockRestore();
    }
  });

  it('reactive: a signal switching to a row mapper clears the slot with a warning', async () => {
    const el = container();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const [v, set] = createSignal<unknown>('a');
      createRoot(() => insert(el, v));
      expect(el.innerHTML).toBe('a');
      set(() => (item: unknown) => item); // a function argument is an updater
      await frame();
      expect(el.innerHTML).toBe('');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('nested arrays', () => {
  it('flattens nested arrays in order and updates them', async () => {
    const el = container();
    const [a, b, c] = ['a', 'b', 'c'].map((t) => {
      const n = document.createElement(t);
      return n;
    });
    const [tail, setTail] = createSignal<unknown>(c);
    createRoot(() => insert(el, () => [[a, [b]], tail()]));
    expect(el.innerHTML).toBe('<a></a><b></b><c></c>');
    setTail(['x', [null, 'y']]);
    await frame();
    expect(el.innerHTML).toBe('<a></a><b></b>xy');
    expect(el.firstChild).toBe(a);
  });

  it('accessors inside nested arrays resolve through their own effect', async () => {
    const el = container();
    const [s, set] = createSignal('1');
    createRoot(() => insert(el, ['<', [s, ['>']]]));
    expect(el.textContent).toBe('<1>');
    set('2');
    await frame();
    expect(el.textContent).toBe('<2>');
  });
});

describe('reconcileArrays branches via keyed rows', () => {
  it('arbitrary permutation (map fallback) keeps the nodes and the order', async () => {
    const ul = container();
    const [list, setList] = createSignal([1, 2, 3, 4, 5]);
    createRoot(() => insert(ul, rowsFor(list)));
    const nodes = new Map(Array.from(ul.children).map((n) => [n.textContent, n]));
    setList([5, 3, 1, 4, 2]);
    await frame();
    expect(Array.from(ul.children).map((n) => n.textContent)).toEqual(['5', '3', '1', '4', '2']);
    for (const n of ul.children) expect(n).toBe(nodes.get(n.textContent));
  });

  it('long reverse and mixed insert/remove', async () => {
    const ul = container();
    const [list, setList] = createSignal([1, 2, 3, 4, 5, 6, 7, 8]);
    createRoot(() => insert(ul, rowsFor(list)));
    const nodes = new Map(Array.from(ul.children).map((n) => [n.textContent, n]));
    setList([8, 7, 6, 5, 4, 3, 2, 1]);
    await frame();
    expect(Array.from(ul.children).map((n) => n.textContent).join('')).toBe('87654321');
    for (const n of ul.children) expect(n).toBe(nodes.get(n.textContent));
    setList([9, 7, 5, 10, 3, 1]);
    await frame();
    expect(Array.from(ul.children).map((n) => n.textContent).join(',')).toBe('9,7,5,10,3,1');
    expect(ul.children[1]).toBe(nodes.get('7'));
  });

  it('randomized transitions land the exact order, stay inside the marker, and leave neighbours alone', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let iter = 0; iter < 400; iter++) {
      const marker = iter % 2 === 0 ? document.createTextNode('') : undefined;
      const el = container();
      el.append(document.createElement('hr'));
      if (marker) el.append(marker, document.createElement('br'));
      const pool = Array.from({ length: 10 }, (_, i) => {
        const s = document.createElement('s');
        s.id = `n${i}`;
        return s;
      });
      const pick = () => {
        const list = pool.filter(() => rnd() < 0.6);
        for (let i = list.length - 1; i > 0; i--) {
          const j = Math.floor(rnd() * (i + 1));
          [list[i], list[j]] = [list[j]!, list[i]!];
        }
        return list;
      };
      const a = pick();
      const b = pick();
      if (!a.length || !b.length) continue;
      for (const n of a) {
        el.insertBefore(n, marker ?? null);
        (n as any)[SLOT] = marker ?? null;
      }
      reconcileArrays(el, a, b, marker);
      expect(Array.from(el.children).filter((c) => c.tagName === 'S')).toEqual(b);
      if (marker) expect(b.at(-1)!.nextSibling).toBe(marker);
      expect(el.firstChild!.nodeName).toBe('HR');
    }
  });
});

describe('several slots in one parent', () => {
  it('each slot updates only its own nodes between its marker neighbours', async () => {
    const el = container();
    const m1 = document.createTextNode('');
    const m2 = document.createTextNode('');
    el.append('[', m1, '|', m2, ']');
    const [l1, setL1] = createSignal([1, 2]);
    const [l2, setL2] = createSignal([3]);
    createRoot(() => {
      insert(el, rowsFor(l1), m1);
      insert(el, rowsFor(l2), m2);
    });
    expect(el.innerHTML).toBe('[<li>1</li><li>2</li>|<li>3</li>]');
    setL1([2, 1, 4]);
    setL2([5, 3]);
    await frame();
    expect(el.innerHTML).toBe('[<li>2</li><li>1</li><li>4</li>|<li>5</li><li>3</li>]');
    setL1([]);
    await frame();
    expect(el.innerHTML).toBe('[|<li>5</li><li>3</li>]');
  });
});

describe('functions in multi mode with a marker', () => {
  it('a conditional list gets its own effect and stays before the marker', async () => {
    const el = container();
    const marker = document.createTextNode('');
    el.append('[', marker, ']');
    const [cond, setCond] = createSignal(true);
    const [list, setList] = createSignal([1, 2]);
    const rows = rowsFor(list);
    const outer = vi.fn(() => (cond() ? rows : 'none'));
    createRoot(() => insert(el, outer, marker));
    expect(el.innerHTML).toBe('[<li>1</li><li>2</li>]');
    setList([1, 2, 3]);
    await frame();
    expect(el.innerHTML).toBe('[<li>1</li><li>2</li><li>3</li>]');
    expect(outer).toHaveBeenCalledTimes(1);
    setCond(false);
    await frame();
    expect(el.textContent).toBe('[none]');
    setCond(true);
    await frame();
    expect(el.innerHTML).toBe('[<li>1</li><li>2</li><li>3</li>]');
  });

  it('a fragment (array) holding an accessor', async () => {
    const el = container();
    const marker = document.createTextNode('');
    el.append(marker);
    const [s, set] = createSignal('a');
    createRoot(() => insert(el, () => ['x', s], marker));
    expect(el.textContent).toBe('xa');
    set('b');
    await frame();
    expect(el.textContent).toBe('xb');
  });
});

describe('options', () => {
  it('host: top-level inserted nodes get a _$host getter (static and reactive), arrays included', async () => {
    const el = container();
    const logicalParent = document.createElement('section');
    const a = document.createElement('a');
    const b = document.createElement('b');
    insert(el, a, undefined, undefined, { host: () => logicalParent });
    expect((a as any)[HOST_KEY]).toBe(logicalParent);
    const [s, set] = createSignal<Node[]>([b]);
    createRoot(() => insert(el, () => s(), null, undefined, { host: () => logicalParent }));
    expect((b as any)[HOST_KEY]).toBe(logicalParent);
    const c = document.createElement('i');
    set([b, c]);
    await frame();
    expect((c as any)[HOST_KEY]).toBe(logicalParent);
  });

  it('name: accepted for reactive inserts, behaviour unchanged', async () => {
    const el = container();
    const [s, set] = createSignal('a');
    createRoot(() => insert(el, s, undefined, undefined, { name: 'div.children' }));
    set('b');
    await frame();
    expect(el.innerHTML).toBe('b');
  });
});

describe('falsy primitives in root mode', () => {
  it('0 and NaN render as text and are replaced like any text', async () => {
    const el = container();
    insert(el, 0);
    expect(el.innerHTML).toBe('0');
    const el2 = container();
    const span = document.createElement('span');
    const [v, set] = createSignal<unknown>(0);
    createRoot(() => insert(el2, v));
    expect(el2.innerHTML).toBe('0');
    set(Number.NaN);
    await frame();
    expect(el2.innerHTML).toBe('NaN');
    set(span);
    await frame();
    expect(el2.innerHTML).toBe('<span></span>');
    set(0);
    await frame();
    expect(el2.innerHTML).toBe('0');
  });
});

describe('render: disposer boundaries', () => {
  it('survives the removal of a pre-existing child (splash scenario)', () => {
    const el = container();
    const splash = document.createElement('div');
    el.append(splash);
    const dispose = render(() => 'app', el);
    expect(el.textContent).toBe('app');
    splash.remove();
    dispose();
    expect(el.innerHTML).toBe('');
  });

  it('a vanished end marker: only the markers go, never "to the end of the container", with a warning', () => {
    const el = container();
    el.innerHTML = '<i>x</i>';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const dispose = render(() => 'app', el);
      const tail = document.createElement('u');
      el.append(tail);
      // the end marker is the empty Text node right after 'app'
      el.lastChild!.previousSibling!.remove();
      dispose();
      expect(el.querySelector('u')).toBe(tail);
      expect(el.querySelector('i')).not.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
