import { createRoot, createSignal } from '../../src/index';
import { defineDirective } from '../../src/dom/directives';
import { setAttribute } from '../../src/dom/attributes';
import { applyRef, assign, mergeProps, readShallow, ref, spread } from '../../src/dom/props';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

const attrNames = (el: Element) => Array.from(el.attributes).map((a) => a.name);
const hidden = () => Object.defineProperty({ shown: 1 }, 'hidden', { value: 'secret', enumerable: false });

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

it('applies attributes, properties, class/style diffs, delegated events and children; later sources win', async () => {
  const el = container();
  const [title, setTitle] = createSignal('t1');
  const clicks: number[] = [];
  createRoot(() =>
    spread(
      el,
      [
        {
          id: 'a',
          get title() { return title(); },
          class: 'x',
          style: { color: 'red' },
          tabIndex: 3,
          onClick: () => clicks.push(1),
          children: 'kid',
        },
        { id: 'b' },
      ],
      false,
    ),
  );
  expect(el.id).toBe('b');
  expect(el.getAttribute('title')).toBe('t1');
  expect(el.classList.contains('x')).toBe(true);
  expect(el.style.color).toBe('red');
  expect(el.tabIndex).toBe(3);
  expect(el.textContent).toBe('kid');
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(clicks).toEqual([1]);
  setTitle('t2');
  await frame();
  expect(el.getAttribute('title')).toBe('t2');
});

it('a function source re-applies on change and removes keys that disappeared', async () => {
  const el = container();
  const [props, setProps] = createSignal<Record<string, unknown>>({ title: 'a', 'data-x': '1', class: 'c1' });
  createRoot(() => spread(el, () => props(), true));
  expect(el.getAttribute('data-x')).toBe('1');
  setProps({ title: 'b', class: 'c2' });
  await frame();
  expect(el.getAttribute('title')).toBe('b');
  expect(el.hasAttribute('data-x')).toBe(false);
  expect(Array.from(el.classList)).toEqual(['c2']);
});

it('ref runs once per identity; prop:/attr:/bool:/on: namespaces; xlink on SVG', async () => {
  const el = container();
  const refFn = vi.fn();
  const [n, setN] = createSignal(1);
  createRoot(() =>
    spread(
      el,
      {
        ref: refFn,
        'prop:foo': 'f',
        'attr:bar': 'b',
        'bool:hidden': true,
        'on:ping': () => setN(n() + 1),
        get title() { return String(n()); },
      },
      true,
    ),
  );
  expect(refFn).toHaveBeenCalledTimes(1);
  expect(refFn).toHaveBeenCalledWith(el);
  expect((el as any).foo).toBe('f');
  expect(el.getAttribute('bar')).toBe('b');
  expect(el.hasAttribute('hidden')).toBe(true);
  el.dispatchEvent(new Event('ping'));
  await frame();
  expect(el.getAttribute('title')).toBe('2');
  expect(refFn).toHaveBeenCalledTimes(1);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  createRoot(() => spread(use, { 'xlink:href': '#id' }, true));
  expect(use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#id');
});

it('non-delegated events are replaced on change; input value nullish → empty; custom-element props are properties', async () => {
  const el = container();
  const first = vi.fn();
  const second = vi.fn();
  const [handler, setHandler] = createSignal<() => void>(first);
  createRoot(() => spread(el, { get onCustomthing() { return handler(); } }, true));
  el.dispatchEvent(new Event('customthing'));
  setHandler(() => second);
  await frame();
  el.dispatchEvent(new Event('customthing'));
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  const input = document.createElement('input');
  createRoot(() => spread(input, { value: null }, true));
  expect(input.value).toBe('');
  const ce = document.createElement('my-el');
  createRoot(() => spread(ce, { someProp: { a: 1 } }, true));
  expect((ce as any).someProp).toEqual({ a: 1 });
});

it('a non-delegated [fn, data] tuple handler is removed when it changes or disappears', async () => {
  const el = container();
  const seen: unknown[] = [];
  const [props, setProps] = createSignal<Record<string, unknown>>({ onCustomthing: [(d: unknown) => seen.push(['a', d]), 1] });
  createRoot(() => spread(el, () => props(), true));
  el.dispatchEvent(new Event('customthing'));
  setProps({ onCustomthing: [(d: unknown) => seen.push(['b', d]), 2] });
  await frame();
  el.dispatchEvent(new Event('customthing'));
  setProps({});
  await frame();
  el.dispatchEvent(new Event('customthing'));
  expect(seen).toEqual([['a', 1], ['b', 2]]);
});

it('ref/applyRef accept functions and nested arrays, tolerate undefined, and own nothing', () => {
  const el = document.createElement('div');
  const a = vi.fn();
  const b = vi.fn();
  applyRef([a, [b]], el);
  expect(a).toHaveBeenCalledWith(el);
  expect(b).toHaveBeenCalledWith(el);
  applyRef(undefined, el);
  const c = vi.fn();
  ref(() => c, el);
  expect(c).toHaveBeenCalledWith(el);
});

it('assign writes once; readShallow is identity', () => {
  const el = document.createElement('div');
  assign(el, { title: 'x', children: 'c' });
  expect(el.getAttribute('title')).toBe('x');
  expect(el.textContent).toBe('c');
  const o = {};
  expect(readShallow(o)).toBe(o);
});

describe('security: every attribute write in a spread goes through the policy', () => {
  it.each(['ONCLICK', 'onclick', 'OnMouseOver', 'attr:ONCLICK', 'attr:onerror'])('a string handler under %s is refused', (name) => {
    const el = container();
    createRoot(() => spread(el, { [name]: 'alert(1)' }, true));
    expect(attrNames(el)).toEqual([]);
    expect(errors).toHaveBeenCalled();
  });

  it('a string under onClick (delegated) and onCustomthing (not delegated) attaches nothing', () => {
    const el = container();
    createRoot(() => spread(el, { onClick: 'alert(1)', onCustomthing: 'alert(1)' }, true));
    expect(attrNames(el)).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it.each(['href', 'HREF', 'Href', 'attr:href'])('a javascript: URL under %s is refused', (name) => {
    const a = document.createElement('a');
    createRoot(() => spread(a, { [name]: 'javascript:alert(1)' }, true));
    expect(a.hasAttribute('href')).toBe(false);
    expect(errors).toHaveBeenCalled();
  });

  it('a javascript: URL under xlink:href on SVG is refused', () => {
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    createRoot(() => spread(use, { 'xlink:href': 'javascript:alert(1)' }, true));
    expect(use.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBeNull();
  });

  it('srcdoc is an HTML sink: refused as srcdoc/SRCDOC, allowed only through prop:srcdoc', () => {
    const f = document.createElement('iframe');
    createRoot(() => spread(f, { srcdoc: '<script>1</script>', SRCDOC: '<b>x</b>' }, true));
    expect(attrNames(f)).toEqual([]);
    createRoot(() => spread(f, { 'prop:srcdoc': '<b>trusted</b>' }, true));
    expect(f.srcdoc).toBe('<b>trusted</b>');
  });

  it('an object with toString is stringified once and the checked string is the written one', () => {
    const a = document.createElement('a');
    createRoot(() => spread(a, { href: { toString: () => 'javascript:alert(1)' } }, true));
    expect(a.hasAttribute('href')).toBe(false);
    const b = document.createElement('a');
    let calls = 0;
    createRoot(() => spread(b, { href: { toString: () => (calls++ === 0 ? 'https://ok.example/' : 'javascript:alert(1)') } }, true));
    expect(b.getAttribute('href')).toBe('https://ok.example/');
    expect(calls).toBe(1);
  });

  it('with `is`, every prop is a property EXCEPT policed names, which stay attributes under the policy', () => {
    const f = document.createElement('iframe');
    createRoot(() => spread(f, { is: 'x-frame', srcdoc: '<b>x</b>', src: 'javascript:alert(1)', onclick: 'alert(1)', someProp: 5 }, true));
    expect(f.hasAttribute('srcdoc')).toBe(false);
    expect(f.hasAttribute('src')).toBe(false);
    expect(f.hasAttribute('onclick')).toBe(false);
    expect((f as any).someProp).toBe(5);
    const a = document.createElement('a');
    createRoot(() => spread(a, { is: 'x-a', href: { toString: () => 'javascript:alert(1)' } }, true));
    expect(a.hasAttribute('href')).toBe(false);
  });

  it('a removed policed prop is removed (null), not stringified', async () => {
    const a = document.createElement('a');
    const [props, setProps] = createSignal<Record<string, unknown>>({ href: 'https://a.example/' });
    createRoot(() => spread(a, () => props(), true));
    expect(a.getAttribute('href')).toBe('https://a.example/');
    setProps({});
    await frame();
    expect(a.hasAttribute('href')).toBe(false);
  });
});

describe('props are never [[Set]]-copied', () => {
  it('a source with an own __proto__ key changes no prototype', async () => {
    const el = container();
    const source = JSON.parse('{"__proto__": {"polluted": "yes"}, "title": "t", "prop:__proto__": {"polluted": "yes"}}');
    expect(Object.hasOwn(source, '__proto__')).toBe(true);
    const elProto = Object.getPrototypeOf(el);
    let applied!: Record<string, unknown>;
    createRoot(() => {
      applied = spread(el, [source], true);
    });
    expect(el.getAttribute('title')).toBe('t');
    expect(Object.getPrototypeOf(el)).toBe(elProto);
    expect((el as any).polluted).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(applied)).toBe(Object.prototype);
    expect((applied as any).polluted).toBeUndefined();
    expect(Object.hasOwn(applied, '__proto__')).toBe(true);
  });

  it('assign with a hostile bag and prevProps changes no prototype either', () => {
    const el = document.createElement('div');
    const bag = JSON.parse('{"__proto__": {"polluted": "yes"}, "id": "x"}');
    const prev: Record<string, unknown> = {};
    assign(el, bag, true, prev);
    expect(el.id).toBe('x');
    expect(Object.getPrototypeOf(prev)).toBe(Object.prototype);
    expect(({} as any).polluted).toBeUndefined();
    assign(el, {}, true, prev);
    expect(Object.keys(prev)).toEqual([]);
  });

  it('inherited enumerable keys of a bag are not props', () => {
    const el = document.createElement('div');
    const bag = Object.create({ title: 'inherited' });
    bag.id = 'own';
    assign(el, bag);
    expect(el.id).toBe('own');
    expect(el.hasAttribute('title')).toBe(false);
  });
});

describe('mergeProps: own enumerable keys only, in both branches', () => {
  it('a non-enumerable own key is undefined in the plain branch', () => {
    const merged = mergeProps(hidden());
    expect(merged.shown).toBe(1);
    expect(merged.hidden).toBeUndefined();
    expect('hidden' in merged).toBe(false);
    expect(Object.keys(merged)).toEqual(['shown']);
  });

  it('... and in the Proxy branch (function source)', () => {
    const merged = mergeProps(hidden(), () => ({ other: 2 }));
    expect(merged.shown).toBe(1);
    expect(merged.other).toBe(2);
    expect(merged.hidden).toBeUndefined();
    expect('hidden' in merged).toBe(false);
    expect(new Set(Object.keys(merged))).toEqual(new Set(['other', 'shown']));
  });

  it('class-prototype getters are not props', () => {
    class Model {
      own = 1;
      get computed() { return 2; }
    }
    expect(mergeProps(new Model()).computed).toBeUndefined();
    expect(mergeProps(new Model(), () => ({})).computed).toBeUndefined();
  });
});

describe('style and directives through a spread', () => {
  it('style:x and imperative styles survive an unrelated update (string style)', async () => {
    const el = container();
    const [title, setTitle] = createSignal('a');
    createRoot(() => spread(el, { style: 'color: red', get title() { return title(); } }, true));
    setAttribute(el, 'style:width', '10px');
    el.style.setProperty('background-color', 'blue');
    setTitle('b');
    await frame();
    expect(el.getAttribute('title')).toBe('b');
    expect(el.style.color).toBe('red');
    expect(el.style.width).toBe('10px');
    expect(el.style.backgroundColor).toBe('blue');
  });

  it('style:x and imperative styles survive an unrelated update (object style), and a changed object diffs', async () => {
    const el = container();
    const [n, setN] = createSignal(0);
    const [color, setColor] = createSignal('red');
    createRoot(() => spread(el, { get style() { return { color: color() }; }, get title() { return String(n()); } }, true));
    setAttribute(el, 'style:width', '10px');
    el.style.setProperty('background-color', 'blue');
    setN(1);
    await frame();
    expect(el.style.width).toBe('10px');
    expect(el.style.backgroundColor).toBe('blue');
    expect(el.style.color).toBe('red');
    setColor('green');
    await frame();
    expect(el.style.color).toBe('green');
    expect(el.style.width).toBe('10px');
  });

  it('use: goes through the directive registry (user directive, built-in use:value, removal)', async () => {
    const el = container();
    const seen: unknown[] = [];
    defineDirective('t9spy', (_el, v) => void seen.push(v));
    const [props, setProps] = createSignal<Record<string, unknown>>({ 'use:t9spy': 5 });
    createRoot(() => spread(el, () => props(), true));
    expect(seen).toEqual([5]);
    setProps({ 'use:t9spy': 6 });
    await frame();
    expect(seen).toEqual([5, 6]);
    const input = document.createElement('input');
    createRoot(() => spread(input, { 'use:value': 'hello' }, true));
    expect(input.value).toBe('hello');
    createRoot(() => spread(el, { 'use:nope': 1 }, true));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('unknown directive use:nope'));
  });
});
