import { compute, createScope, getScope, setContext } from './core';

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
  /** `<Ctx.Provider value>`: provides `value` to everything created in `children` (a child scope of the current owner). */
  readonly Provider: (props: { value: T; children?: unknown }) => unknown;
}

export function createContext<T>(defaultValue: T, name = 'context'): Context<T> {
  const id = Symbol(name);
  return {
    id,
    defaultValue,
    Provider(props) {
      const scope = createScope();
      return compute(
        scope,
        () => {
          setContext(id, props.value);
          return props.children;
        },
        null,
      );
    },
  };
}

/** Provide `value` to every owner created under the current one. */
export function provideContext<T>(ctx: Context<T>, value: T): void {
  setContext(ctx.id, value);
}

/** Nearest provided value for `ctx` (a provided `undefined` counts), or its default. */
export function useContext<T>(ctx: Context<T>): T {
  const record = getScope()?._context;
  if (record && ctx.id in record) return record[ctx.id] as T;
  return ctx.defaultValue;
}
