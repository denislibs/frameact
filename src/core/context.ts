import { getContext, setContext } from './core';

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
}

export function createContext<T>(defaultValue: T, name = 'context'): Context<T> {
  return { id: Symbol(name), defaultValue };
}

/** Provide `value` to every owner created under the current one (the Provider component calls this). */
export function provideContext<T>(ctx: Context<T>, value: T): void {
  setContext(ctx.id, value);
}

/** Nearest provided value for `ctx`, or its default when no ancestor provided one. */
export function useContext<T>(ctx: Context<T>): T {
  const value = getContext<T>(ctx.id);
  return value === undefined ? ctx.defaultValue : value;
}
