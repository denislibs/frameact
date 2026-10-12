// Prototype pollution from data (appsec H1): a `__proto__` key in server JSON must never reach
// Object.prototype / Array.prototype, nor change the prototype of a store object; the DOM class/style
// bindings must not read inherited keys either.
import { createEffect, createRoot, flushSync } from '../../src/index';
import { createStore, merge, produce, reconcile, snapshot, unwrap } from 'frameact/store';
import { classTokens } from '../../src/dom/classes';
import { style } from '../../src/dom/styles';

const evil = (json: string) => JSON.parse(json);

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  // belt and braces: whatever a failing test polluted must not leak into the next one
  for (const k of Object.keys(Object.prototype)) delete (Object.prototype as any)[k];
  for (const k of Object.keys(Array.prototype)) delete (Array.prototype as any)[k];
});

function clean() {
  expect(Object.keys(Object.prototype)).toEqual([]);
  expect(Object.keys(Array.prototype)).toEqual([]);
  expect(({} as any).isAdmin).toBeUndefined();
  expect(({} as any).count).toBeUndefined();
  expect(({} as any).p).toBeUndefined();
  expect(([] as any).p).toBeUndefined();
}

type S = { chats: Record<string, any>; list: any[]; users: Record<string, any>; x: Record<string, any>; items: any[] };
function make(): [S, (...a: any[]) => void] {
  const [state, setState] = createStore<any>({
    chats: { c1: { id: 'c1', title: 'a' } },
    list: [{ id: 1, v: 1 }],
    users: { u1: { id: 'u1', name: 'n' } },
    x: {},
    items: [{ id: 1, title: 'a' }, { id: 2, title: 'b' }],
  });
  return [state, setState as any];
}

describe('reconcile with an own __proto__ key', () => {
  it('on an existing object', () => {
    const [state, setState] = make();
    setState('chats', 'c1', reconcile(evil('{"id":"c1","title":"b","__proto__":{"isAdmin":true}}')));
    clean();
    expect(state.chats.c1.title).toBe('b');
    expect(state.chats.c1.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(unwrapRaw(state.chats.c1))).toBe(Object.prototype);
  });
  it('on an existing item of a keyed array', () => {
    const [state, setState] = make();
    setState('items', reconcile(evil('[{"id":1,"title":"z","__proto__":{"isAdmin":true}},{"id":2,"title":"b"}]')));
    clean();
    expect(state.items[0].title).toBe('z');
    expect(state.items[0].isAdmin).toBeUndefined();
  });
  it('at the root', () => {
    const [state, setState] = make();
    setState(reconcile(evil('{"__proto__":{"isAdmin":true},"chats":{}}')));
    clean();
    expect((state as any).isAdmin).toBeUndefined();
  });
  it('nested deeper in the payload', () => {
    const [, setState] = make();
    setState('chats', reconcile(evil('{"c1":{"id":"c1","title":"a","meta":{"__proto__":{"count":7}}}}')));
    setState('chats', reconcile(evil('{"c1":{"id":"c1","title":"a","meta":{"__proto__":{"count":8},"k":1}}}')));
    clean();
  });
  it('a new object keeps no own __proto__ key (a later spread must not turn it into a prototype change)', () => {
    const [state, setState] = make();
    setState('chats', 'c2', evil('{"id":"c2","__proto__":{"isAdmin":true}}'));
    const raw = unwrapRaw(state.chats.c2);
    expect(Object.hasOwn(raw, '__proto__')).toBe(false);
    expect(({ ...raw } as any).isAdmin).toBeUndefined();
    clean();
  });
  it('a new object whose item carries it (array, nested)', () => {
    const [state, setState] = make();
    setState('list', (l: any[]) => [...l, evil('{"id":2,"deep":{"__proto__":{"p":1}}}')]);
    const raw = unwrapRaw(state.list[1].deep);
    expect(Object.hasOwn(raw, '__proto__')).toBe(false);
    clean();
  });
});

describe('path form', () => {
  it("setState('x', '__proto__', 'count', 7) does not descend into Object.prototype", () => {
    const [, setState] = make();
    expect(() => setState('x', '__proto__', 'count', 7)).toThrow(TypeError);
    clean();
  });
  it("setState('list', '__proto__', 'p', 1) does not descend into Array.prototype", () => {
    const [, setState] = make();
    expect(() => setState('list', '__proto__', 'p', 1)).toThrow(TypeError);
    clean();
  });
  it("setState('x', '__proto__', obj) neither changes the prototype of the dictionary nor leaks", () => {
    const [state, setState] = make();
    setState('x', '__proto__', { isAdmin: true });
    expect(state.x.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(unwrapRaw(state.x))).toBe(Object.prototype);
    expect(errorSpy).toHaveBeenCalled(); // DEV message
    clean();
  });
  it('fan-out keys are checked too', () => {
    const [, setState] = make();
    expect(() => setState('x', ['__proto__'], 'count', 7)).toThrow(TypeError);
    clean();
  });
  it('a replaced value carrying __proto__ (P18)', () => {
    const [state, setState] = make();
    setState('users', 'u1', evil('{"id":"u1","__proto__":{"isAdmin":true}}'));
    expect(state.users.u1.isAdmin).toBeUndefined();
    clean();
  });
});

describe('merge', () => {
  it('skips an own __proto__ key and keeps the prototype', () => {
    const [state, setState] = make();
    setState('users', 'u1', merge(evil('{"__proto__":{"isVerified":true},"name":"m"}')));
    expect(state.users.u1.isVerified).toBeUndefined();
    expect(state.users.u1.name).toBe('m');
    // the object is still a plain store object: later merges and produce keep working
    setState('users', 'u1', merge({ name: 'm2' }));
    setState('users', 'u1', produce((u: any) => { u.name = 'm3'; }));
    expect(state.users.u1.name).toBe('m3');
    clean();
  });
  it('at the root', () => {
    const [state, setState] = make();
    setState(merge(evil('{"__proto__":{"isAdmin":true}}')));
    expect((state as any).isAdmin).toBeUndefined();
    clean();
  });
});

describe('produce', () => {
  it('a draft never hands out Object.prototype / Array.prototype', () => {
    const [state, setState] = make();
    expect(() => setState('x', produce((d: any) => { d.__proto__.count = 7; }))).toThrow();
    expect(() => setState('list', produce((d: any) => { d.__proto__.p = 1; }))).toThrow();
    clean();
    expect(state.x.count).toBeUndefined();
  });
  it('assigning __proto__ on a draft (deepAssign-style) is dropped', () => {
    const [state, setState] = make();
    setState('x', produce((d: any) => { Object.assign(d, evil('{"__proto__":{"isAdmin":true},"a":1}')); }));
    expect(state.x.a).toBe(1);
    expect(state.x.isAdmin).toBeUndefined();
    expect(Object.getPrototypeOf(unwrapRaw(state.x))).toBe(Object.prototype);
    clean();
  });
  it('delete draft.__proto__ and setPrototypeOf on a draft do nothing harmful', () => {
    const [state, setState] = make();
    setState('x', produce((d: any) => { delete d.__proto__; }));
    expect(() => setState('x', produce((d: any) => { Object.setPrototypeOf(d, { isAdmin: true }); }))).toThrow(TypeError);
    expect(state.x.isAdmin).toBeUndefined();
    clean();
  });
  it('produce on an unwrappable target throws instead of silently doing nothing', () => {
    const [, setState] = make();
    setState('x', 'date', new Date(0));
    expect(() => setState('x', 'date', produce(() => {}))).toThrow(TypeError);
    setState('x', 'n', 1);
    expect(() => setState('x', 'n', produce(() => {}))).toThrow(TypeError);
  });
});

describe('createStore initial / read side', () => {
  it('createStore strips an own __proto__ key of the initial data', () => {
    const [state] = createStore<any>(evil('{"a":{"__proto__":{"isAdmin":true}}}'));
    expect(state.a.isAdmin).toBeUndefined();
    expect(Object.hasOwn(unwrapRaw(state.a), '__proto__')).toBe(false);
    clean();
  });
  it('reading __proto__ through the proxy hands out nothing', () => {
    const [state] = make();
    expect((state.x as any).__proto__).toBeUndefined();
    expect((state.list as any).__proto__).toBeUndefined();
  });
  it('snapshot of data survives', () => {
    const [state, setState] = make();
    setState('chats', 'c1', reconcile(evil('{"id":"c1","title":"s","__proto__":{"a":1}}')));
    expect(snapshot(state.chats.c1)).toEqual({ id: 'c1', title: 's' });
  });
});

describe('DOM gadgets: inherited keys never become classes / styles', () => {
  it('classTokens ignores inherited keys', () => {
    (Object.prototype as any).evilClass = true;
    const out = new Set<string>();
    classTokens({ own: true }, out);
    expect([...out]).toEqual(['own']);
  });
  it('style object ignores inherited keys', () => {
    (Object.prototype as any).position = 'fixed';
    (Object.prototype as any)['z-index'] = '99';
    const el = document.createElement('div');
    style(el, { color: 'red' });
    expect(el.style.position).toBe('');
    expect(el.style.color).toBe('red');
    style(el, { color: 'blue' });
    expect(el.style.position).toBe('');
    expect(el.style.color).toBe('blue');
    style(el, null);
    expect(el.style.color).toBe('');
  });
  it('style: a key only on the prototype of the next object is not applied and the old own key is removed', () => {
    const el = document.createElement('div');
    style(el, { color: 'red', top: '1px' });
    const next = Object.create({ top: '2px' });
    next.color = 'blue';
    style(el, next);
    expect(el.style.top).toBe('');
    expect(el.style.color).toBe('blue');
  });
});

// effects over polluted-like data stay reactive and unaffected
it('a store read in an effect is unaffected by the dropped key', () => {
  const [state, setState] = make();
  const seen: unknown[] = [];
  createRoot(() => {
    createEffect(() => state.chats.c1.title, (v) => { seen.push(v); });
  });
  flushSync();
  setState('chats', 'c1', reconcile(evil('{"id":"c1","title":"t2","__proto__":{"isAdmin":true}}')));
  flushSync();
  expect(seen).toEqual(['a', 't2']);
});

function unwrapRaw<T>(v: T): any {
  return unwrap(v);
}

// N1: a path key that is not a string/number/symbol but coerces to "__proto__" (an array from JSON, an
// object with toString / Symbol.toPrimitive) must never reach `raw[key] = value`.
const mk = () => createStore<any>({ x: {}, list: [1], deep: { y: {} } });
const intact = (s: any) => {
  const raw = unwrap(s);
  expect(Object.getPrototypeOf(raw.x)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(raw.list)).toBe(Array.prototype);
  expect(Object.getPrototypeOf(raw.deep.y)).toBe(Object.prototype);
  clean();
};
describe('path keys that coerce to __proto__', () => {
  const coercing: [string, () => any][] = [
    ['nested array', () => [['__proto__']]],
    ['toString', () => ({ toString: () => '__proto__' })],
    ['Symbol.toPrimitive', () => ({ [Symbol.toPrimitive]: () => '__proto__' })],
  ];

  it.each(coercing)('%s as the last key (object, array), fanned out, and as a descent key: TypeError', (_n, k) => {
    const [s, set0] = mk();
    const set = set0 as (...a: any[]) => void;
    expect(() => set('x', k(), evil('{"p":1}'))).toThrow(TypeError);
    expect(() => set('list', k(), evil('{"p":1}'))).toThrow(TypeError);
    expect(() => set('x', [k()], evil('{"p":1}'))).toThrow(TypeError);
    expect(() => set('list', [k()], evil('{"p":1}'))).toThrow(TypeError);
    expect(() => set('x', [0, k()] as any, 1)).toThrow(TypeError);
    expect(() => set(k(), 'y', 1)).toThrow(TypeError);
    expect(() => set('deep', [k()], 'p', 1)).toThrow(TypeError);
    expect(() => set('x', k(), merge({ p: 1 }))).toThrow(TypeError);
    intact(s);
    expect((s as any).x.p).toBeUndefined();
  });
  it('a bad key in a fan-out applies nothing', () => {
    const [s, set] = createStore<any>({ a: { v: 0 }, b: { v: 0 } });
    expect(() => set(['a', ['b'] as any], 'v', 1)).toThrow(TypeError);
    expect((s as any).a.v).toBe(0);
  });
  it('numbers, strings and symbols still work as keys', () => {
    const sym = Symbol('s');
    const [s, set] = createStore<any>({ o: {}, l: [1, 2] });
    set('o', sym, 1);
    set('o', 'k', 2);
    set('l', 1, 9);
    expect((s as any).o[sym]).toBe(1);
    expect((s as any).o.k).toBe(2);
    expect((s as any).l[1]).toBe(9);
  });
});
