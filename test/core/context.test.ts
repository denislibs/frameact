import { createContext, provideContext, useContext } from '../../src/core/context';
import { onDispose, root } from '../../src/core/core';
import { createEffect } from '../../src/core/effects';
import { signal } from '../../src/core/signals';
import { flushMicrotasks } from '../helpers/micro';

it('returns the default outside any provider and the provided value inside, with nesting', () => {
  const Theme = createContext('light');
  expect(root(() => useContext(Theme))).toBe('light');
  root(() => {
    provideContext(Theme, 'dark');
    expect(useContext(Theme)).toBe('dark');
    root(() => {
      expect(useContext(Theme)).toBe('dark');
      provideContext(Theme, 'blue');
      expect(useContext(Theme)).toBe('blue');
    });
    expect(useContext(Theme)).toBe('dark');
  });
});

it('a reactive value is passed as an accessor and stays reactive in effects', async () => {
  const Count = createContext<() => number>(() => 0);
  const $n = signal(1);
  const applied: number[] = [];
  root(() => {
    provideContext(Count, $n);
    createEffect(() => useContext(Count)(), (v) => { applied.push(v); });
  });
  await flushMicrotasks();
  $n.set(2);
  await flushMicrotasks();
  expect(applied).toEqual([1, 2]);
});

it('Provider provides to its children only (siblings unaffected), honours undefined, nests', () => {
  const Ctx = createContext<string | undefined>('default');
  root(() => {
    let inside: unknown;
    let afterNested: unknown;
    let nested: unknown;
    let undef: unknown;
    (Ctx.Provider({
      value: 'a',
      get children() {
        inside = useContext(Ctx);
        (Ctx.Provider({
          value: 'b',
          get children() {
            nested = useContext(Ctx);
            return null;
          },
        }) as () => unknown)();
        afterNested = useContext(Ctx);
        return null;
      },
    }) as () => unknown)();
    const sibling = useContext(Ctx);
    (Ctx.Provider({
      value: undefined,
      get children() {
        undef = useContext(Ctx);
        return null;
      },
    }) as () => unknown)();
    expect(inside).toBe('a');
    expect(nested).toBe('b');
    expect(afterNested).toBe('a');
    expect(sibling).toBe('default');
    expect(undef).toBeUndefined();
  });
});

it('Provider returns the resolved children; what they create is disposed with the parent', () => {
  const Ctx = createContext(0);
  const log: string[] = [];
  const dispose = root((d) => {
    const out = Ctx.Provider({
      value: 1,
      get children() {
        onDispose(() => log.push('disposed'));
        return 'child';
      },
    });
    expect((out as () => unknown)()).toBe('child');
    return d;
  });
  expect(log).toEqual([]);
  dispose();
  expect(log).toEqual(['disposed']);
});

it('Provider children are tracked: a ternary child switches branches', () => {
  const Ctx = createContext('d');
  const $flag = signal(true);
  root(() => {
    const out = Ctx.Provider({
      value: 'v',
      get children() {
        return $flag() ? 'A' : 'B';
      },
    }) as () => unknown;
    expect(out()).toBe('A');
    $flag.set(false);
    expect(out()).toBe('B');
  });
});

it('Provider: a function child (and one inside an array) runs under the provider and sees its value', () => {
  const Ctx = createContext('default');
  root(() => {
    const out = Ctx.Provider({
      value: 'provided',
      get children() {
        return [() => useContext(Ctx), 'x'];
      },
    }) as () => unknown;
    expect(out()).toEqual(['provided', 'x']);
    const single = Ctx.Provider({
      value: 'p2',
      get children() {
        return () => useContext(Ctx);
      },
    }) as () => unknown;
    expect(single()).toBe('p2');
  });
});

it('Provider resolves functions inside nested arrays', () => {
  const C = createContext('d');
  root(() => {
    const out = C.Provider({
      value: 'v',
      get children() {
        return [['x', () => useContext(C)]];
      },
    }) as () => unknown;
    expect(out()).toEqual([['x', 'v']]);
  });
});

it('Provider warns in DEV when called without an owner', () => {
  const Ctx = createContext(0);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    Ctx.Provider({ value: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('Provider');
  } finally {
    warn.mockRestore();
  }
});
