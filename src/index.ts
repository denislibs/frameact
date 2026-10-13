import {
  createSignalNode, detachedRoot, getScope, onDispose, onError as onErrorRaw, peek,
  readSignal, scoped, write,
} from './core/core';
import { toDirty, type Accessor, type SignalOptions } from './core/memo';
import type { Scope } from './core/types';

export { createMemo, type Accessor, type SignalOptions } from './core/memo';
export type Setter<T> = (value: T | ((prev: T) => T)) => T;

/**
 * Solid-style tuple over a maverick signal node. `equals: false` → always notify. The signal is
 * not owned: it outlives the owner it was created under (readers unlink when they are disposed).
 */
export function createSignal<T>(value: T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  // One node + two bound functions + the tuple: no options object, no maverick wrapper function.
  const node = createSignalNode(value, options && { id: options.id, dirty: toDirty(options.equals) });
  return [readSignal.bind(node) as Accessor<T>, write.bind(node) as Setter<T>];
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
export { onMount, onDestroy, watchHeavyAnimation } from './core/lifecycle';
export { previous, currentOrPrev, frozenWhile, type PreviousOptions, type CurrentOrPrevOptions } from './core/derive';
export { flushSync } from './core/flush';
export type { Scope as Owner } from './core/types';
