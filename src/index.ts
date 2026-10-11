import {
  createComputation, detachedRoot, getScope, onDispose, onError as onErrorRaw, peek, read, scoped, write,
} from './core/core';
import type { Scope } from './core/types';

export type Accessor<T> = () => T;
export type Setter<T> = (value: T | ((prev: T) => T)) => T;

export interface SignalOptions<T> {
  equals?: ((prev: T, next: T) => boolean) | false;
  id?: string;
}

/** Maps the Solid-style `equals` option onto maverick's `dirty` (true = changed). `false` → always dirty. */
function toDirty<T>(equals: SignalOptions<T>['equals']): ((prev: T, next: T) => boolean) | undefined {
  if (equals === false) return () => true;
  if (equals) return (a, b) => !equals(a, b);
  return undefined;
}

/** Solid-style tuple over a maverick signal node. `equals: false` → always notify. */
export function createSignal<T>(value: T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  // One node + two bound functions + the tuple: no options object, no maverick wrapper function.
  const node = createComputation(
    value,
    null,
    options && { id: options.id, dirty: toDirty(options.equals) },
  );
  return [read.bind(node) as Accessor<T>, write.bind(node) as Setter<T>];
}

export function createMemo<T>(fn: () => T, options?: SignalOptions<T>): Accessor<T> {
  const node = createComputation<T>(
    undefined as T,
    fn,
    options && { id: options.id, dirty: toDirty(options.equals) },
  );
  return read.bind(node) as Accessor<T>;
}

/**
 * Solid semantics: the new root is detached — it is not disposed with the enclosing owner — but it
 * inherits that owner's context and error handlers.
 */
export const createRoot = detachedRoot;
export const onCleanup = onDispose;
/** Solid semantics: reads inside `fn` are not tracked, but the owner is kept (context, cleanup). */
export const untrack: <T>(fn: () => T) => T = peek;
export const getOwner = getScope;
export const onError = onErrorRaw;
export function runWithOwner<T>(owner: Scope | null, fn: () => T): T | undefined {
  return scoped(fn, owner);
}

export { selector as createSelector } from './core/selector';
export { mapArray, type MapArrayOptions } from './core/map';
export { createContext, provideContext, useContext, type Context } from './core/context';

export {
  createEffect, tickEnd, type Schedule, type EffectNode, type EffectOptions,
} from './core/effects';
export {
  createMeasureEffect, createMutationEffect, createRenderEffect, createIdleEffect,
  frameMeasure, frameMutation, frameForcedReflow, idle, gateOnHeavyAnimation, deferUntilIdle,
} from './core/frame';

export {
  requestMeasure, requestMutation, requestNextMutation, requestForcedReflow, getPhase,
} from './scheduler/fasterdom';
export { onTickEnd, onIdle, throttleWith } from './scheduler/schedulers';
export {
  beginHeavyAnimation, getIsHeavyAnimating, getIsBlockingAnimating, createHeavyAnimationScope, rootScope,
  provideHeavyAnimationScope, currentHeavyAnimationScope, onHeavyAnimation, onFullyIdle,
  type HeavyAnimationScope, type OnceSignal,
} from './scheduler/heavyAnimation';
export { flushSync } from './core/flush';
export type { Scope as Owner } from './core/types';
