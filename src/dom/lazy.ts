// `lazy` in the spirit of Solid's (packages/solid/src/render/component.ts, MIT, © 2016-2025 Ryan
// Carniato) without Suspense: the component renders `placeholder` (nothing by default) until the
// module arrives, then the loaded component with the same props. Replaces teact's `*.async.tsx`
// + `useModuleLoader` pair (155 files in telegram-tt).
import { DEV } from '../env';
import { handleError } from '../core/core';
import { createMemo, createSignal, getOwner, untrack } from '../index';
import { createComponent, type Component } from './component';

export interface LazyOptions {
  /** Rendered while the module loads (created under the lazy component's owner, disposed when the component arrives). */
  placeholder?: () => unknown;
}

export interface LazyComponent<P> {
  (props: P): unknown;
  /** Start loading now (a hover, an idle moment); the returned promise resolves to the component. */
  preload(): Promise<Component<P>>;
}

/**
 * `lazy(() => import('./Settings'))`: a component that loads its implementation on first render
 * (or `preload()`). The module is cached per `lazy` call; a failed load is reported through the
 * owner's `onError` handlers (else the console), the placeholder stays, and the next instance
 * retries (a loader that throws synchronously counts as a failed load). The promise `preload()`
 * returns rejects on failure: handle it where you call it. Heavy first renders during an animation: wrap the instance in `deferUntilIdle`.
 */
export function lazy<P>(loader: () => Promise<{ default: Component<P> }>, options?: LazyOptions): LazyComponent<P> {
  let loaded: Component<P> | undefined;
  let pending: Promise<Component<P>> | undefined;
  const placeholder = options?.placeholder;

  function preload(): Promise<Component<P>> {
    if (loaded) return Promise.resolve(loaded);
    if (!pending) {
      pending = new Promise<{ default: Component<P> }>((resolve) => resolve(loader())).then(
        (m) => {
          loaded = m.default;
          return loaded;
        },
        (error) => {
          pending = undefined; // the next mount retries
          throw error;
        },
      );
    }
    return pending;
  }

  const Lazy = ((props: P) => {
    if (loaded) return createComponent(loaded, props);
    const owner = getOwner();
    const [comp, setComp] = createSignal<Component<P> | undefined>(undefined);
    preload().then(
      (c) => setComp(() => c),
      (error) => {
        try {
          handleError(owner, error);
        } catch (unhandled) {
          console.error('[frameact] lazy: loading the component failed', unhandled);
        }
      },
    );
    return createMemo(() => {
      const C = comp();
      // untracked: the loaded component's own reads must not subscribe this memo
      return C ? untrack(() => createComponent(C, props)) : placeholder ? untrack(placeholder) : undefined;
    });
  }) as LazyComponent<P>;
  Lazy.preload = preload;
  if (DEV) Object.defineProperty(Lazy, 'name', { value: 'Lazy' });
  return Lazy;
}
