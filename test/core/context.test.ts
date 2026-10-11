import { createContext, provideContext, useContext } from '../../src/core/context';
import { root } from '../../src/core/core';
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
