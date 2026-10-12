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
    let nested: unknown;
    let undef: unknown;
    Ctx.Provider({
      value: 'a',
      get children() {
        inside = useContext(Ctx);
        Ctx.Provider({
          value: 'b',
          get children() {
            nested = useContext(Ctx);
            return null;
          },
        });
        return null;
      },
    });
    const sibling = useContext(Ctx);
    Ctx.Provider({
      value: undefined,
      get children() {
        undef = useContext(Ctx);
        return null;
      },
    });
    expect(inside).toBe('a');
    expect(nested).toBe('b');
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
    expect(out).toBe('child');
    return d;
  });
  expect(log).toEqual([]);
  dispose();
  expect(log).toEqual(['disposed']);
});
