// Adapted from dom-expressions / solid-js mergeProps semantics (MIT, © 2017 Ryan Carniato).

export type PropsSource =
  | Record<PropertyKey, any>
  | (() => Record<PropertyKey, any> | null | undefined | false)
  | null
  | undefined
  | false;

/** A function source is resolved on every access (its key set may change). */
export function resolveSource(source: PropsSource): Record<PropertyKey, any> | null {
  const resolved = typeof source === 'function' ? source() : source;
  return resolved || null;
}

function getFrom(sources: PropsSource[], key: PropertyKey): unknown {
  for (let i = sources.length - 1; i >= 0; i--) {
    const s = resolveSource(sources[i]);
    if (s && key in s) {
      const v = s[key];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function hasIn(sources: PropsSource[], key: PropertyKey): boolean {
  for (let i = sources.length - 1; i >= 0; i--) {
    const s = resolveSource(sources[i]);
    if (s && key in s) return true;
  }
  return false;
}

function keysOf(sources: PropsSource[]): string[] {
  const keys = new Set<string>();
  for (const source of sources) {
    const s = resolveSource(source);
    if (s) for (const key of Object.keys(s)) keys.add(key);
  }
  return [...keys];
}

/**
 * Compiler primitive: merge props objects right-to-left (later wins, `undefined` falls through to an
 * earlier source), keeping getters lazy. With a function source the result is a Proxy whose key set
 * follows the source; otherwise a plain object of getters.
 */
export function mergeProps(...sources: PropsSource[]): any {
  if (sources.some((s) => typeof s === 'function')) {
    return new Proxy({} as Record<PropertyKey, unknown>, {
      get: (_target, key) => getFrom(sources, key),
      has: (_target, key) => hasIn(sources, key),
      ownKeys: () => keysOf(sources),
      getOwnPropertyDescriptor: (_target, key) =>
        hasIn(sources, key)
          ? { configurable: true, enumerable: true, get: () => getFrom(sources, key) }
          : undefined,
    });
  }
  const target: Record<string, unknown> = {};
  for (const key of keysOf(sources)) {
    Object.defineProperty(target, key, { configurable: true, enumerable: true, get: () => getFrom(sources, key) });
  }
  return target;
}
