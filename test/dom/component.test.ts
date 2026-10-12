import { children, claimElement, createComponent, effect, memo } from '../../src/dom/component';
import { mergeProps } from '../../src/dom/props';
import { createEffect, createRoot, createSignal, getOwner, onCleanup } from '../../src/index';
import { flushMicrotasks } from '../helpers/micro';
import { useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

it('createComponent runs the component once, untracked, under an owner that carries its name', async () => {
  const [n, setN] = createSignal(1);
  const log: string[] = [];
  const Child = (props: { x: number }) => {
    log.push('run');
    onCleanup(() => log.push('cleanup'));
    return props.x + n();
  };
  let outerRuns = 0;
  let ownerId: string | undefined;
  const Named = () => {
    ownerId = (getOwner() as { id?: string } | null)?.id;
    return null;
  };
  const dispose = createRoot((d) => {
    createEffect(
      () => {
        outerRuns++;
        createComponent(Named, {}, 'Named');
        return createComponent(Child, { x: 1 }) as number;
      },
      () => {},
    );
    return d;
  });
  await flushMicrotasks();
  expect(ownerId).toBe('Named');
  setN(2);
  await flushMicrotasks();
  expect(outerRuns).toBe(1); // the component's read of n() did not subscribe the enclosing effect
  dispose();
  expect(log).toEqual(['run', 'cleanup']);
});

it('effect is a render effect (first apply synchronous) and memo is createMemo', async () => {
  const [s, set] = createSignal(1);
  const applied: number[] = [];
  createRoot(() => effect(() => s(), (v) => { applied.push(v); }, { name: 'span.textContent' }));
  expect(applied).toEqual([1]);
  set(2);
  expect(applied).toEqual([1]);
  await frame();
  expect(applied).toEqual([1, 2]);
  const m = createRoot(() => memo(() => s() * 10));
  expect(m()).toBe(20);
});

it('children() resolves nested accessors and arrays; toArray()', () => {
  const [v] = createSignal('a');
  createRoot(() => {
    const c = children(() => [() => v(), ['b', null, () => () => 'c']]);
    expect(c()).toEqual(['a', 'b', 'c']);
    expect(c.toArray()).toEqual(['a', 'b', 'c']);
    expect(children(() => 'x').toArray()).toEqual(['x']);
    expect(children(() => null).toArray()).toEqual([]);
  });
});

it('claimElement returns the node (link claims are out of scope)', () => {
  const d = document.createElement('div');
  expect(claimElement(d)).toBe(d);
});

describe('mergeProps', () => {
  it('later sources win, undefined falls through, getters stay lazy', () => {
    const [n, set] = createSignal(1);
    let calls = 0;
    const merged = mergeProps({ a: 1, b: 1, get c() { calls++; return n(); } }, { a: 2, b: undefined });
    expect(calls).toBe(0); // merging alone never reads a getter
    expect(Object.keys(merged)).toContain('c');
    expect(calls).toBe(0); // neither does listing the keys
    expect(merged.a).toBe(2);
    expect(merged.b).toBe(1);
    expect(merged.c).toBe(1);
    expect(calls).toBe(1);
    set(5);
    expect(merged.c).toBe(5);
    expect(new Set(Object.keys(merged))).toEqual(new Set(['a', 'b', 'c']));
    expect('a' in merged).toBe(true);
    expect('zzz' in merged).toBe(false);
  });

  it('a function source is resolved on every access (dynamic keys)', () => {
    const [src, set] = createSignal<Record<string, unknown>>({ x: 1 });
    const merged = mergeProps({ y: 0 }, () => src());
    expect(merged.x).toBe(1);
    expect(merged.y).toBe(0);
    set({ x: 2, y: 3, z: 4 });
    expect(merged.x).toBe(2);
    expect(merged.y).toBe(3);
    expect(merged.z).toBe(4);
    expect(new Set(Object.keys(merged))).toEqual(new Set(['x', 'y', 'z']));
    expect('z' in merged).toBe(true);
  });

  it('ignores null/false sources', () => {
    expect(Object.keys(mergeProps(null, { a: 1 }, false))).toEqual(['a']);
  });

  it('only own keys count: inherited keys are not props and never override an earlier own value', () => {
    const proto = Object.create({ a: 'inherited', toString: 1 });
    for (const merged of [
      mergeProps({ a: 'own' }, proto),
      mergeProps({ a: 'own' }, () => proto),
    ]) {
      expect(merged.a).toBe('own');
      expect(Object.hasOwn(merged, 'toString')).toBe(false);
      expect(Object.hasOwn(merged, 'constructor')).toBe(false);
      expect(Object.keys(merged)).toEqual(['a']);
    }
  });

  it('symbol keys survive in both branches', () => {
    const sym = Symbol('marker');
    const hidden = Symbol('hidden');
    const src = { a: 1, [sym]: 'x' };
    Object.defineProperty(src, hidden, { value: 'h', enumerable: false });
    for (const merged of [mergeProps(src, { b: 2 }), mergeProps(src, () => ({ b: 2 }))]) {
      expect(merged[sym]).toBe('x');
      expect(Reflect.ownKeys(merged)).toEqual(expect.arrayContaining(['a', 'b', sym]));
      expect(Reflect.ownKeys(merged)).not.toContain(hidden);
      expect(Object.getOwnPropertySymbols(merged)).toEqual([sym]);
    }
  });

  it('an own __proto__ key of a source never changes the prototype (own data property only)', () => {
    const hostile = JSON.parse('{"__proto__":{"polluted":1},"a":1}');
    for (const merged of [mergeProps(hostile), mergeProps(hostile, () => ({}))]) {
      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
      expect(merged.polluted).toBeUndefined();
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(Object.keys(merged)).toContain('__proto__');
    }
  });
});

it('children() recomputes when a nested accessor changes', () => {
  const [v, set] = createSignal('a');
  createRoot(() => {
    const c = children(() => [() => v(), 'b']);
    expect(c()).toEqual(['a', 'b']);
    set('z');
    expect(c()).toEqual(['z', 'b']);
    expect(c.toArray()).toEqual(['z', 'b']);
  });
});

it('children() holds a thrown error and recovers once the source is fixed', () => {
  const [ok, setOk] = createSignal(true);
  createRoot(() => {
    const c = children(() => {
      if (!ok()) throw new Error('boom');
      return ['a', 'b'];
    });
    expect(c()).toEqual(['a', 'b']);
    setOk(false);
    expect(() => c()).toThrow('boom');
    expect(() => c.toArray()).toThrow('boom');
    setOk(true);
    expect(c()).toEqual(['a', 'b']);
  });
});
