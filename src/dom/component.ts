import { DEV } from '../env';
import { compute, createScope, getScope } from '../core/core';
import { createRenderEffect } from '../core/frame';
import type { Computation } from '../core/types';
import { createMemo, untrack } from '../index';
import { flatten } from './insert';

export type Component<P = Record<string, never>> = (props: P) => unknown;

/**
 * Compiler primitive: `createComponent(Comp, props, name)`. Runs the component once, untracked
 * (reads inside the body never subscribe the caller). In DEV every component gets its own owner
 * scope labelled with `name` (the tag as written, from the compiler's sourceNames) — the
 * attribution path `Message > MessageMeta > span.textContent` (plan 4) walks these labels.
 */
export function createComponent<P>(Comp: Component<P>, props: P, name?: string): unknown {
  if (DEV) {
    if (typeof Comp !== 'function') {
      throw new Error(`[frameact] createComponent: <${name ?? String(Comp)}> is not a component function`);
    }
    const scope = createScope();
    (scope as Computation).id = name ?? (Comp.name || 'component');
    return compute(scope, () => Comp(props || ({} as P)), null);
  }
  return untrack(() => Comp(props || ({} as P)));
}

/** Compiler primitive: a binding effect. `options.name` is the compiler's binding label (`div.class`). */
export function effect<T>(
  computeFn: (prev: T | undefined) => T,
  apply: (value: T, prev: T | undefined) => void | (() => void),
  options?: { name?: string },
): void {
  createRenderEffect(computeFn, apply, options);
}

/** Compiler primitive: `memo(fn)` — a plain memo (`===` equality). */
export function memo<T>(fn: () => T): () => T {
  return createMemo(fn);
}

/** Compiler primitive: `_el._$owner = getOwner()` on custom elements. */
export const getOwner = getScope;

/** Compiler primitive for link/form claims (router integration). No consumer in frameact: identity. */
export function claimElement<T extends Node>(node: T, _owner?: unknown): T {
  return node;
}

export interface ChildrenReturn {
  (): unknown;
  toArray(): unknown[];
}

/** Resolve `props.children` once (nested accessors called, arrays flattened, non-rendered values dropped). */
export function children(fn: () => unknown): ChildrenReturn {
  const c = createMemo(fn);
  const resolved = createMemo(() => flatten(c(), true, false)) as ChildrenReturn;
  resolved.toArray = () => {
    const v = resolved();
    return Array.isArray(v) ? v : v != null ? [v] : [];
  };
  return resolved;
}
