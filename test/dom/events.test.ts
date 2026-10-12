import { addEvent, clearDelegatedEvents, delegateEvents, EVENT_KEY, setListener } from '../../src/dom/events';
import { HOST_KEY } from '../../src/dom/insert';
import { useDomHarness, container } from '../helpers/dom';

useDomHarness();

function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
}

it('delegated handlers run with the compiler keys, data tuples, simulated currentTarget, bubbling and cancelBubble', () => {
  const outer = container();
  const inner = document.createElement('button');
  outer.appendChild(inner);
  const log: string[] = [];
  addEvent(inner, 'click', [(data: number, e: Event) => log.push(`inner:${data}:${(e.currentTarget as Element).tagName}`), 42], true);
  addEvent(outer, 'click', (e: Event) => log.push(`outer:${(e.currentTarget as Element).tagName}`), true);
  expect((inner as any)[EVENT_KEY + 'click']).toBeTypeOf('function');
  expect((inner as any)[EVENT_KEY + 'clickData']).toBe(42);
  delegateEvents(['click']);
  delegateEvents(['click']); // idempotent
  click(inner);
  expect(log).toEqual(['inner:42:BUTTON', 'outer:DIV']);
  log.length = 0;
  addEvent(inner, 'click', (e: Event) => { log.push('stop'); e.stopPropagation(); }, true);
  click(inner);
  expect(log).toEqual(['stop']);
  (inner as HTMLButtonElement).disabled = true;
  log.length = 0;
  click(inner);
  expect(log).toEqual(['outer:DIV']);
});

it('clearDelegatedEvents detaches the document listeners', () => {
  const el = container();
  const handler = vi.fn();
  addEvent(el, 'click', handler, true);
  delegateEvents(['click']);
  clearDelegatedEvents();
  click(el);
  expect(handler).not.toHaveBeenCalled();
});

it('non-delegated addEvent attaches listeners (plain, tuple, listener object with options)', () => {
  const el = container();
  const log: string[] = [];
  addEvent(el, 'custom', () => log.push('plain'));
  addEvent(el, 'custom', [(data: string) => log.push(`tuple:${data}`), 'd']);
  addEvent(el, 'custom', { handleEvent: () => log.push('object'), once: true });
  el.dispatchEvent(new Event('custom'));
  el.dispatchEvent(new Event('custom'));
  expect(log).toEqual(['plain', 'tuple:d', 'object', 'plain', 'tuple:d']);
});

it('setListener (on:/oncapture:) replaces and removes', () => {
  const el = container();
  const a = vi.fn();
  const b = vi.fn();
  setListener(el, 'ping', a, false);
  el.dispatchEvent(new Event('ping'));
  setListener(el, 'ping', b, false);
  el.dispatchEvent(new Event('ping'));
  setListener(el, 'ping', null, false);
  el.dispatchEvent(new Event('ping'));
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(1);
  const order: string[] = [];
  const child = document.createElement('i');
  el.appendChild(child);
  setListener(el, 'ping', () => order.push('capture'), true);
  child.addEventListener('ping', () => order.push('target'));
  child.dispatchEvent(new Event('ping', { bubbles: true }));
  expect(order).toEqual(['capture', 'target']);
});

// jsdom has no named properties on forms. `<form><input name="x">` makes `form.x` the input
// (LegacyOverrideBuiltIns: even built-ins like parentNode); a non-writable own property is the same.
function clobber(form: Element, prop: string, value: unknown) {
  Object.defineProperty(form, prop, { value, configurable: true });
}

/** A handler that cuts the walk after `limit` calls, so a regression fails instead of hanging. */
function counting(limit = 20) {
  const counter = { calls: 0 };
  const handler = (e: Event) => {
    if (++counter.calls > limit) e.stopPropagation();
  };
  return { counter, handler };
}

function formWithInput() {
  const outer = container();
  const form = document.createElement('form');
  const input = document.createElement('input');
  form.appendChild(input);
  outer.appendChild(form);
  return { outer, form, input };
}

function silence(e: ErrorEvent) {
  e.preventDefault();
}

describe('delegation survives DOM clobbering (forms with named inputs)', () => {
  let errors: unknown[];
  const onError = (e: ErrorEvent) => {
    errors.push(e.error);
    e.preventDefault();
  };
  beforeEach(() => {
    errors = [];
    window.addEventListener('error', onError);
  });
  afterEach(() => {
    window.removeEventListener('error', onError);
  });

  it('an element named _$host is not a portal host', () => {
    const { outer, form, input } = formWithInput();
    const { counter, handler } = counting();
    const outerCalls = vi.fn();
    clobber(form, HOST_KEY, input);
    addEvent(form, 'click', handler, true);
    addEvent(outer, 'click', outerCalls, true);
    delegateEvents(['click']);
    click(input);
    expect(counter.calls).toBe(1);
    expect(outerCalls).toHaveBeenCalledTimes(1);
  });

  it('an element named _$$click is not a handler', () => {
    const { outer, form, input } = formWithInput();
    const outerCalls = vi.fn();
    clobber(form, EVENT_KEY + 'click', input);
    addEvent(outer, 'click', outerCalls, true);
    delegateEvents(['click']);
    click(input);
    expect(errors).toEqual([]);
    expect(outerCalls).toHaveBeenCalledTimes(1);
  });

  it('a handler that is neither a function nor has handleEvent is skipped (also with data)', () => {
    const outer = container();
    const inner = document.createElement('i');
    outer.appendChild(inner);
    const outerCalls = vi.fn();
    (inner as any)[EVENT_KEY + 'click'] = { handleEvent: 1 };
    (inner as any)[EVENT_KEY + 'clickData'] = 5;
    addEvent(outer, 'click', outerCalls, true);
    delegateEvents(['click']);
    click(inner);
    expect(errors).toEqual([]);
    expect(outerCalls).toHaveBeenCalledTimes(1);
  });

  it('an element named parentNode does not loop the walk through a portal', () => {
    const { outer, form, input } = formWithInput();
    const logicalParent = document.createElement('div');
    form.appendChild(logicalParent);
    const portalMount = container();
    Object.defineProperty(portalMount, HOST_KEY, { get: () => logicalParent, configurable: true });
    const inside = document.createElement('b');
    portalMount.appendChild(inside);
    const { counter, handler } = counting();
    const outerCalls = vi.fn();
    clobber(form, 'parentNode', input);
    addEvent(form, 'click', handler, true);
    addEvent(outer, 'click', outerCalls, true);
    delegateEvents(['click']);
    click(inside);
    expect(counter.calls).toBe(1);
    expect(outerCalls).toHaveBeenCalledTimes(1);
  });

  it('an element named disabled does not silence the form handler', () => {
    const { form, input } = formWithInput();
    const calls = vi.fn();
    clobber(form, 'disabled', input);
    addEvent(form, 'click', calls, true);
    delegateEvents(['click']);
    click(input);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it('an element named host does not retarget the event', () => {
    const { outer, form, input } = formWithInput();
    const targets: unknown[] = [];
    clobber(form, 'host', document.createElement('section'));
    addEvent(outer, 'click', (e: Event) => targets.push(e.target), true);
    delegateEvents(['click']);
    click(input);
    expect(targets).toEqual([input]);
  });
});

describe('delegation: retargeting, portals, removal, disabled ancestors, cleanup', () => {
  it('currentTarget is restored: document listeners added later see document', () => {
    const el = container();
    let seen: unknown;
    addEvent(el, 'click', () => {}, true);
    delegateEvents(['click']);
    document.addEventListener('click', (e) => (seen = e.currentTarget), { once: true });
    click(el);
    expect(seen).toBe(document);
  });

  it('currentTarget and target are restored even when a handler throws', () => {
    const el = container();
    const child = document.createElement('i');
    el.appendChild(child);
    const seen: unknown[] = [];
    window.addEventListener('error', silence);
    addEvent(child, 'click', () => {
      throw new Error('boom');
    }, true);
    delegateEvents(['click']);
    document.addEventListener('click', (e) => seen.push(e.currentTarget, e.target), { once: true });
    click(child);
    window.removeEventListener('error', silence);
    expect(seen).toEqual([document, child]);
  });

  it('shadow DOM: handlers inside see the real target, light-DOM ancestors see the host', () => {
    const outer = container();
    const host = document.createElement('div');
    outer.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    root.appendChild(button);
    const log: string[] = [];
    addEvent(button, 'click', (e: Event) => log.push(`button:${(e.target as Element).tagName}`), true);
    addEvent(host, 'click', (e: Event) => log.push(`host:${(e.target as Element).tagName}`), true);
    addEvent(outer, 'click', (e: Event) => log.push(`outer:${(e.target as Element).tagName}`), true);
    delegateEvents(['click']);
    click(button);
    expect(log).toEqual(['button:BUTTON', 'host:DIV', 'outer:DIV']);
  });

  it('portal: the event bubbles from the mount to the logical parent chain', () => {
    const logicalOuter = container();
    const logicalParent = document.createElement('section');
    logicalOuter.appendChild(logicalParent);
    const mount = container(); // a sibling, not inside the logical parent
    Object.defineProperty(mount, HOST_KEY, { get: () => logicalParent, configurable: true });
    const inside = document.createElement('b');
    mount.appendChild(inside);
    const log: string[] = [];
    addEvent(inside, 'click', () => log.push('inside'), true);
    addEvent(mount, 'click', () => log.push('mount'), true);
    addEvent(logicalParent, 'click', () => log.push('logicalParent'), true);
    addEvent(logicalOuter, 'click', () => log.push('logicalOuter'), true);
    delegateEvents(['click']);
    click(inside);
    expect(log).toEqual(['inside', 'mount', 'logicalParent', 'logicalOuter']);
  });

  it('a delegated handler is removed with undefined, and a tuple is replaced by a plain function', () => {
    const el = container();
    const handler = vi.fn();
    const plain = vi.fn();
    delegateEvents(['click']);
    addEvent(el, 'click', handler, true);
    click(el);
    addEvent(el, 'click', undefined, true);
    click(el);
    expect(handler).toHaveBeenCalledTimes(1);
    addEvent(el, 'click', [handler, 7], true);
    addEvent(el, 'click', plain, true);
    click(el);
    expect(plain).toHaveBeenCalledWith(expect.any(Event));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a disabled ancestor skips its own handler, not the others', () => {
    const outer = container();
    const fieldset = document.createElement('fieldset');
    const button = document.createElement('button');
    fieldset.appendChild(button);
    outer.appendChild(fieldset);
    fieldset.disabled = true;
    const log: string[] = [];
    addEvent(button, 'click', () => log.push('button'), true);
    addEvent(fieldset, 'click', () => log.push('fieldset'), true);
    addEvent(outer, 'click', () => log.push('outer'), true);
    delegateEvents(['click']);
    click(button);
    expect(log).toEqual(['button', 'outer']);
  });
});

describe('handler validation and caller data', () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('on:click="string" is refused without being stored: later updates keep working', () => {
    const el = container();
    const fn = vi.fn();
    setListener(el, 'ping', 'alert(1)', false);
    expect(errors).toHaveBeenCalledTimes(1);
    setListener(el, 'ping', fn, false);
    el.dispatchEvent(new Event('ping'));
    setListener(el, 'ping', null, false);
    el.dispatchEvent(new Event('ping'));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(() => setListener(el, 'ping', { handleEvent: 1 }, true)).not.toThrow();
  });

  it('addEvent refuses a non-function handler (DEV error), delegated or not', () => {
    const el = container();
    expect(() => addEvent(el, 'ping', 'alert(1)')).not.toThrow();
    addEvent(el, 'click', 'alert(1)', true);
    expect((el as any)[EVENT_KEY + 'click']).toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it('addEvent does not mutate the caller\'s tuple (a shared tuple works on two elements)', () => {
    const a = container();
    const b = container();
    const seen: unknown[] = [];
    const tuple: [(data: string, e: Event) => void, string] = [(data, e) => seen.push([data, e.type]), 'd'];
    const fn = tuple[0];
    addEvent(a, 'custom', tuple);
    addEvent(b, 'custom', tuple);
    expect(tuple[0]).toBe(fn);
    a.dispatchEvent(new Event('custom'));
    b.dispatchEvent(new Event('custom'));
    expect(seen).toEqual([['d', 'custom'], ['d', 'custom']]);
  });
});
