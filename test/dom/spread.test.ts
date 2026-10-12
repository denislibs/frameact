import { createRoot, createSignal } from '../../src/index';
import { defineDirective } from '../../src/dom/directives';
import { setAttribute } from '../../src/dom/attributes';
import { applyRef, assign, mergeProps, readShallow, ref, spread } from '../../src/dom/props';
import { For } from '../../src/dom/list';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { Dynamic } from '../../src/dom/flow';
import { flushMicrotasks } from '../helpers/micro';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

const attrNames = (el: Element) => Array.from(el.attributes).map((a) => a.name);
const hidden = () => Object.defineProperty({ shown: 1 }, 'hidden', { value: 'secret', enumerable: false });

// DEV diagnostics are recorded, not silenced: a test that expects one calls `expectDevErrors()`;
// every other test fails if the runtime logged anything.
let errors: ReturnType<typeof vi.spyOn>;
let warnings: ReturnType<typeof vi.spyOn>;
let devErrorsExpected = false;
const expectDevErrors = () => {
  devErrorsExpected = true;
};
beforeEach(() => {
  devErrorsExpected = false;
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  const unexpected = [...errors.mock.calls, ...warnings.mock.calls];
  vi.restoreAllMocks();
  if (!devErrorsExpected) expect(unexpected).toEqual([]);
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
  beforeEach(expectDevErrors);

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

  it('is-mode checks the FINAL property name: form-action / formAction never reach an instance property', () => {
    const button = document.createElement('button');
    const writes: unknown[] = [];
    Object.defineProperty(button, 'formAction', { configurable: true, set: (v) => void writes.push(v), get: () => '' });
    createRoot(() => spread(button, { is: 'x-b', 'form-action': 'javascript:alert(1)', 'FORM-ACTION': 'javascript:alert(2)' }, true));
    createRoot(() => spread(button, { is: 'x-b', formAction: 'javascript:alert(3)' }, true));
    expect(writes).toEqual([]);
    expect(button.hasAttribute('formaction')).toBe(false);
    // a safe value is still applied, as the attribute (the property reflects it in browsers)
    createRoot(() => spread(button, { is: 'x-b', 'form-action': 'https://ok.example/' }, true));
    expect(writes).toEqual([]);
    expect(button.getAttribute('formaction')).toBe('https://ok.example/');
  });

  it.each(['outerHTML', 'outer-h-t-m-l', 'inner-h-t-m-l'])('%s is never written as a property (is-mode and custom elements)', (name) => {
    const host = container();
    const child = document.createElement('div');
    host.appendChild(child);
    createRoot(() => spread(child, { is: 'x-d', [name]: '<img src=x onerror=alert(1)>' }, true));
    expect(host.innerHTML).toBe('<div></div>');
    const ce = document.createElement('my-el');
    host.appendChild(ce);
    createRoot(() => spread(ce, { [name]: '<img src=x onerror=alert(1)>' }, true));
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('my-el')).toBe(ce);
    expect(ce.innerHTML).toBe('');
  });

  it('innerHTML by its exact explicit name stays an explicit opt-in', () => {
    const div = document.createElement('div');
    createRoot(() => spread(div, { innerHTML: '<b>trusted</b>' }, true));
    expect(div.innerHTML).toBe('<b>trusted</b>');
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
    expectDevErrors(); // prop:__proto__ is refused with a diagnostic
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
    expect(Object.getPrototypeOf(applied)).toBe(null); // a null-prototype bag: no `__proto__` setter to reach
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
    setProps({});
    await frame();
    expect(seen).toEqual([5, 6, null]); // removal reaches the directive as null
    const input = document.createElement('input');
    createRoot(() => spread(input, { 'use:value': 'hello' }, true));
    expect(input.value).toBe('hello');
    expectDevErrors();
    createRoot(() => spread(el, { 'use:nope': 1 }, true));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('unknown directive use:nope'));
  });
});

describe('events through a spread', () => {
  it('a handleEvent object keeps its options: once fires once, capture is removed with capture', async () => {
    const el = container();
    const onceCalls: string[] = [];
    const captured: string[] = [];
    const [props, setProps] = createSignal<Record<string, unknown>>({
      onCustomone: { once: true, handleEvent: () => onceCalls.push('once') },
      onCustomcap: { capture: true, handleEvent: () => captured.push('cap') },
    });
    createRoot(() => spread(el, () => props(), true));
    el.dispatchEvent(new Event('customone'));
    el.dispatchEvent(new Event('customone'));
    expect(onceCalls).toEqual(['once']);
    el.dispatchEvent(new Event('customcap'));
    expect(captured).toEqual(['cap']);
    setProps({});
    await frame();
    el.dispatchEvent(new Event('customcap'));
    expect(captured).toEqual(['cap']);
  });

  it('a delegated handler that is replaced by a refused value stops firing', async () => {
    expectDevErrors();
    const el = container();
    const clicks: number[] = [];
    const [props, setProps] = createSignal<Record<string, unknown>>({ onClick: () => clicks.push(1) });
    createRoot(() => spread(el, () => props(), true));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    setProps({ onClick: 'alert(1)' });
    await frame();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toEqual([1]);
  });

  it('a delegated onClick that disappears from the bag stops firing', async () => {
    const el = container();
    const clicks: number[] = [];
    const [props, setProps] = createSignal<Record<string, unknown>>({ onClick: () => clicks.push(1) });
    createRoot(() => spread(el, () => props(), true));
    setProps({});
    await frame();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicks).toEqual([]);
  });
});

describe('sources', () => {
  it('in an array of sources a later undefined falls through to an earlier one, like mergeProps', () => {
    const el = container();
    createRoot(() => spread(el, [{ title: 'a', id: 'i' }, { title: undefined }], true));
    expect(el.getAttribute('title')).toBe('a');
    expect(el.id).toBe('i');
    const other = container();
    createRoot(() => spread(other, [{ title: undefined }], true));
    expect(other.hasAttribute('title')).toBe(false);
  });

  it('a getter shadowed by a later defined value is neither called nor tracked', async () => {
    const el = container();
    let calls = 0;
    const [n, setN] = createSignal(0);
    createRoot(() =>
      spread(el, [{ get title() { calls++; return String(n()); } }, { title: 'later' }], true),
    );
    expect(el.getAttribute('title')).toBe('later');
    expect(calls).toBe(0);
    setN(1);
    await frame();
    expect(calls).toBe(0);
  });

  it('keeps first-seen key order and own-enumerable semantics', () => {
    const el = container();
    const order: string[] = [];
    createRoot(() =>
      spread(
        el,
        [
          { get a() { order.push('a'); return '1'; }, get b() { order.push('b'); return '2'; } },
          Object.defineProperty({}, 'c', { value: '3', enumerable: false }),
        ],
        true,
      ),
    );
    expect(order).toEqual(['a', 'b']);
    expect(el.hasAttribute('c')).toBe(false);
  });

  it('a function source is called once per pass and unrelated changes do not rebuild the children', async () => {
    const el = container();
    let calls = 0;
    const [title, setTitle] = createSignal('a');
    createRoot(() =>
      spread(el, () => {
        calls++;
        return { title: title(), children: 'kid' };
      }),
    );
    expect(calls).toBe(1);
    const text = el.firstChild;
    expect(el.textContent).toBe('kid');
    setTitle('b');
    await frame();
    expect(calls).toBe(2);
    expect(el.getAttribute('title')).toBe('b');
    expect(el.firstChild).toBe(text);
  });

  it('class and className in one bag are combined into one channel; a DEV hint suggests class', async () => {
    expectDevErrors();
    const el = container();
    const [n, setN] = createSignal(0);
    createRoot(() => spread(el, { class: 'a', className: 'b', get title() { return String(n()); } }, true));
    expect(new Set(el.classList)).toEqual(new Set(['a', 'b']));
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('use class'));
    setN(1);
    await frame();
    expect(new Set(el.classList)).toEqual(new Set(['a', 'b']));
  });

  it('class alone, then className alone, then both', async () => {
    expectDevErrors();
    const el = container();
    const [props, setProps] = createSignal<Record<string, unknown>>({ class: 'a' });
    createRoot(() => spread(el, () => props(), true));
    setProps({ className: 'b' });
    await frame();
    expect(Array.from(el.classList)).toEqual(['b']);
    setProps({ class: 'a', className: 'c' });
    await frame();
    expect(new Set(el.classList)).toEqual(new Set(['a', 'c']));
    setProps({ class: 'a' });
    await frame();
    expect(Array.from(el.classList)).toEqual(['a']);
  });
});

describe('children, skip, classList, ref', () => {
  it('skipChildren=true leaves a children key alone; false inserts it', () => {
    const skipped = container();
    skipped.textContent = 'old';
    createRoot(() => spread(skipped, { children: 'new', id: 'x' }, true));
    expect(skipped.textContent).toBe('old');
    expect(skipped.id).toBe('x');
    const inserted = container();
    createRoot(() => spread(inserted, { children: 'new' }, false));
    expect(inserted.textContent).toBe('new');
  });

  it('the skip callback drops keys, and skip("children") drops the children slot', () => {
    const el = container();
    el.textContent = 'old';
    createRoot(() => spread(el, { id: 'x', title: 't', children: 'new' }, false, (key) => key === 'title' || key === 'children'));
    expect(el.id).toBe('x');
    expect(el.hasAttribute('title')).toBe(false);
    expect(el.textContent).toBe('old');
  });

  it('classList through a spread diffs and is cleaned up on removal', async () => {
    const el = container();
    el.classList.add('imperative');
    const [props, setProps] = createSignal<Record<string, unknown>>({ classList: { a: true, b: true } });
    createRoot(() => spread(el, () => props(), true));
    expect(new Set(el.classList)).toEqual(new Set(['imperative', 'a', 'b']));
    setProps({ classList: { a: true, b: false } });
    await frame();
    expect(new Set(el.classList)).toEqual(new Set(['imperative', 'a']));
    setProps({});
    await frame();
    expect(Array.from(el.classList)).toEqual(['imperative']);
  });

  it('a changed ref identity is called again; the same one is not; a disappearing ref is not called', async () => {
    const el = container();
    const first = vi.fn();
    const second = vi.fn();
    const [props, setProps] = createSignal<Record<string, unknown>>({ ref: first, title: 'a' });
    createRoot(() => spread(el, () => props(), true));
    setProps({ ref: first, title: 'b' });
    await frame();
    expect(first).toHaveBeenCalledTimes(1);
    setProps({ ref: second, title: 'b' });
    await frame();
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(el);
    setProps({ title: 'c' });
    await frame();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('spread onX and on:x use separate listener slots', () => {
  it('coexist and both fire; removing either leaves the other working', async () => {
    const el = container();
    const log: string[] = [];
    const [props, setProps] = createSignal<Record<string, unknown>>({ onScroll: () => log.push('spread') });
    createRoot(() => spread(el, () => props(), true));
    setAttribute(el, 'on:scroll', () => log.push('local'));
    el.dispatchEvent(new Event('scroll'));
    expect(log).toEqual(['spread', 'local']);
    log.length = 0;
    setProps({});
    await frame();
    el.dispatchEvent(new Event('scroll'));
    expect(log).toEqual(['local']);
    log.length = 0;
    setProps({ onScroll: () => log.push('spread2') });
    await frame();
    setAttribute(el, 'on:scroll', null);
    el.dispatchEvent(new Event('scroll'));
    expect(log).toEqual(['spread2']);
  });

  it('onChange and on:change in one bag both attach', () => {
    const el = container();
    const log: string[] = [];
    createRoot(() => spread(el, { onChange: () => log.push('x'), 'on:change': () => log.push('y') }, true));
    el.dispatchEvent(new Event('change'));
    expect(new Set(log)).toEqual(new Set(['x', 'y']));
    expect(log).toHaveLength(2);
  });
});

describe('is-mode on customized built-ins: native names keep the policy (URL component setters)', () => {
  beforeEach(expectDevErrors);

  it.each(['a', 'area'])('<%s is>: href with a custom scheme + protocol=javascript never yields a javascript: URL', (tag) => {
    const el = document.createElement(tag);
    createRoot(() => spread(el, { is: 'x-link', href: 'x:alert(1)', protocol: 'javascript' }, true));
    expect(el.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
    expect((el as HTMLAnchorElement).protocol).not.toBe('javascript:');
  });

  it.each(['protocol', 'host', 'hostname', 'pathname', 'search', 'hash', 'port', 'username', 'password', 'origin'])(
    '<a is>: %s is never written as a property',
    (name) => {
      const a = document.createElement('a');
      const writes: unknown[] = [];
      Object.defineProperty(a, name, { configurable: true, set: (v) => void writes.push(v), get: () => '' });
      createRoot(() => spread(a, { is: 'x-link', [name]: 'javascript' }, true));
      expect(writes).toEqual([]);
    },
  );

  it('a name on the native prototype goes the attribute path; a non-native name stays a property', () => {
    const b = document.createElement('button');
    const writes: unknown[] = [];
    Object.defineProperty(Object.getPrototypeOf(b), 't9Native', { configurable: true, set: (v) => void writes.push(v), get: () => '' });
    try {
      createRoot(() => spread(b, { is: 'x-b', t9Native: 'v', myOwn: 5 }, true));
      expect(writes).toEqual([]);
      expect((b as any).myOwn).toBe(5);
    } finally {
      delete (Object.getPrototypeOf(b) as any).t9Native;
    }
  });
});

describe('is-mode details', () => {
  beforeEach(expectDevErrors);

  it('a native name goes through the aliases: htmlFor → for', () => {
    const label = document.createElement('label');
    createRoot(() => spread(label, { is: 'x-label', htmlFor: 'field' }, true));
    expect(label.getAttribute('for')).toBe('field');
  });

  it('a failing native-prototype probe routes the name through setAttribute', () => {
    const el = document.createElement('section');
    const doc = el.ownerDocument;
    const spy = vi.spyOn(doc, 'createElementNS').mockImplementation(() => {
      throw new Error('probe failed');
    });
    try {
      createRoot(() => spread(el, { is: 'x-s', someName: 'v' }, true));
    } finally {
      spy.mockRestore();
    }
    expect(el.getAttribute('someName')).toBe('v');
    expect((el as any).someName).toBeUndefined();
  });

  it('the spread slot cannot collide with an event literally named s:scroll via on:', async () => {
    const el = container();
    const log: string[] = [];
    const [props, setProps] = createSignal<Record<string, unknown>>({ onScroll: () => log.push('spread') });
    createRoot(() => spread(el, () => props(), true));
    setAttribute(el, 'on:s:scroll', () => log.push('colon'));
    el.dispatchEvent(new Event('s:scroll'));
    expect(log).toEqual(['colon']);
    setProps({}); // must find and remove its own listener
    await frame();
    el.dispatchEvent(new Event('scroll'));
    expect(log).toEqual(['colon']);
  });
});

const option = (v: string) => {
  const o = document.createElement('option');
  o.value = v;
  o.textContent = v;
  return o;
};

describe('<select value> through spread and Dynamic ends on the value, whatever inserts the options', () => {
  it('spread: children are inserted before the attribute effect (static options)', async () => {
    const root = container();
    const select = document.createElement('select');
    createRoot(() => spread(select, { value: 'b', children: [option('a'), option('b')] }, false));
    root.appendChild(select);
    await flushMicrotasks();
    expect(select.value).toBe('b');
  });

  it('spread: options produced by a mapping function child', async () => {
    const root = container();
    const select = document.createElement('select');
    const [opts] = createSignal(['a', 'b', 'c']);
    createRoot(() => spread(select, { value: 'b', get children() { return opts().map(option); } }, false));
    root.appendChild(select);
    await flushMicrotasks();
    expect(select.value).toBe('b');
  });

  it('spread: options inserted by <For> as a sibling insert after the spread', async () => {
    const root = container();
    const select = document.createElement('select');
    const [opts] = createSignal(['a', 'b', 'c']);
    createRoot(() => {
      spread(select, { value: 'c' }, true); // what the compiler emits for <select {...p}>{children}</select>
      insert(select, createComponent(() => For({ get each() { return opts(); }, children: (v: string) => option(v) }), {}));
    });
    root.appendChild(select);
    await flushMicrotasks();
    expect(select.value).toBe('c');
  });

  it('Dynamic component="select" value="b" with options', async () => {
    const root = container();
    createRoot(() => {
      insert(root, createComponent(Dynamic, { component: 'select', value: 'b', children: [option('a'), option('b')] }));
    });
    await flushMicrotasks();
    expect((root.firstElementChild as HTMLSelectElement).value).toBe('b');
  });

  it('Dynamic select with options from <For>', async () => {
    const root = container();
    const [opts] = createSignal(['a', 'b', 'c']);
    createRoot(() => {
      insert(
        root,
        createComponent(Dynamic, {
          component: 'select',
          value: 'b',
          get children() {
            return createComponent(() => For({ get each() { return opts(); }, children: (v: string) => option(v) }), {});
          },
        }),
      );
    });
    await flushMicrotasks();
    expect((root.firstElementChild as HTMLSelectElement).value).toBe('b');
  });

  it('assign: value on a select whose options arrive later in the same turn is reapplied', async () => {
    const select = document.createElement('select');
    container().appendChild(select);
    createRoot(() => assign(select, { value: 'b' }));
    select.append(option('a'), option('b'));
    await flushMicrotasks();
    expect(select.value).toBe('b');
  });
});

describe('unchanged class/style values are not re-applied', () => {
  it('an identical class string / style object on a later pass is left alone; a changed one is applied', async () => {
    const el = container();
    const style = { color: 'red' };
    const [title, setTitle] = createSignal('a');
    const [cls, setCls] = createSignal('x');
    createRoot(() =>
      spread(el, () => ({ get title() { return title(); }, class: cls(), style }), true),
    );
    expect(el.className).toBe('x');
    expect(el.style.color).toBe('red');
    // outside tampering that a re-application would repair:
    el.classList.remove('x');
    el.style.color = 'blue';
    setTitle('b'); // the whole bag re-evaluates, class/style are the identical values
    await frame();
    expect(el.getAttribute('title')).toBe('b');
    expect(el.className).toBe('');
    expect(el.style.color).toBe('blue');
    setCls('y');
    await frame();
    expect(el.className).toBe('y');
  });

  it('props that disappear are removed on the next pass (the key set is rebuilt each pass)', async () => {
    const el = container();
    const [bag, setBag] = createSignal<Record<string, unknown>>({ id: 'a', title: 't', 'data-x': '1' });
    createRoot(() => spread(el, () => bag(), true));
    setBag({ id: 'a' });
    await frame();
    expect(attrNames(el)).toEqual(['id']);
    setBag({ title: 'u' });
    await frame();
    expect(attrNames(el)).toEqual(['title']);
  });
});
