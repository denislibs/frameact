import { DEV } from '../env';
import { compute, createScope, getScope, setContext } from './core';
import { computed } from './signals';

export interface Context<T> {
  readonly id: symbol;
  readonly defaultValue: T;
  /**
   * `<Ctx.Provider value>`: provides `value` to everything created in `children`, which are resolved
   * inside the provider's own child scope of the current owner. Returns an accessor of the resolved
   * children (accessor children are called there, so they see `value`; a reactive `children` getter
   * stays reactive). `value` is read once, as a snapshot (like Solid 1.x): pass an accessor as the
   * value for reactivity. It must be called under an owner (DEV warns otherwise).
   */
  readonly Provider: (props: { value: T; children?: unknown }) => unknown;
}

/** Call zero-arity accessor children (and ones inside an array) so they run under the provider's scope. */
function resolveChildren(value: unknown): unknown {
  while (typeof value === 'function' && !value.length) value = value();
  if (Array.isArray(value) && value.some((v) => typeof v === 'function' && !v.length)) {
    return value.map(resolveChildren);
  }
  return value;
}

export function createContext<T>(defaultValue: T, name = 'context'): Context<T> {
  const id = Symbol(name);
  return {
    id,
    defaultValue,
    Provider(props) {
      if (DEV && getScope() === null) {
        console.warn('[frameact] Context.Provider called without an owner (or inside an effect apply): what its children create is never disposed. Render it inside a component or root.');
      }
      const scope = createScope();
      return compute(
        scope,
        () => {
          setContext(id, props.value);
          const raw = computed(() => props.children);
          return computed(() => resolveChildren(raw()));
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
