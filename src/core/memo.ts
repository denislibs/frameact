// The memo primitive and the option mapping it shares with signals, split out of `src/index.ts`
// so that core modules (derive.ts) can use `createMemo` without importing the package barrel.
import { createComputation, read } from './core';

export type Accessor<T> = () => T;
export interface SignalOptions<T> {
  equals?: ((prev: T, next: T) => boolean) | false;
  id?: string;
}

/** Maps the Solid-style `equals` option onto maverick's `dirty` (true = changed). `false` → always dirty. */
export function toDirty<T>(equals: SignalOptions<T>['equals']): ((prev: T, next: T) => boolean) | undefined {
  if (equals === false) return () => true;
  if (equals) return (a, b) => !equals(a, b);
  return undefined;
}

export function createMemo<T>(fn: () => T, options?: SignalOptions<T>): Accessor<T> {
  const node = createComputation<T>(
    undefined as T,
    fn,
    options && { id: options.id, dirty: toDirty(options.equals) },
  );
  return read.bind(node) as Accessor<T>;
}

