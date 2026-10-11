import {
  getContext, getScope, onDispose, onError as onErrorRaw, peek as peekRaw, root, scoped, setContext, untrack as untrackRaw,
} from './core/core';
import { computed, signal } from './core/signals';
import type { ReadSignal, Scope, WriteSignal } from './core/types';

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

/** Solid-style tuple over maverick's `signal`. `equals: false` → always notify. */
export function createSignal<T>(value: T, options?: SignalOptions<T>): [Accessor<T>, Setter<T>] {
  const $s: WriteSignal<T> = signal(value, { id: options?.id, dirty: toDirty(options?.equals) });
  return [() => $s(), (v) => $s.set(v as T)];
}

export function createMemo<T>(fn: () => T, options?: SignalOptions<T>): Accessor<T> {
  const $c: ReadSignal<T> = computed(fn, { id: options?.id, dirty: toDirty(options?.equals) });
  return () => $c();
}

export const createRoot = root;
export const onCleanup = onDispose;
export const untrack = untrackRaw;
export const peek = peekRaw;
export const getOwner = getScope;
export const onError = onErrorRaw;
export function runWithOwner<T>(owner: Scope | null, fn: () => T): T | undefined {
  return scoped(fn, owner);
}
export { getContext as getRawContext, setContext as setRawContext };

export { selector as createSelector } from './core/selector';
export { mapArray, computedKeyedMap, computedMap, computedKeyedMapBy, type MapArrayOptions } from './core/map';
export { createContext, provideContext, useContext, type Context } from './core/context';

export {
  createEffect, tickEnd, NOT_APPLIED, type Schedule, type EffectNode, type EffectOptions,
} from './core/effects';
export {
  createMeasureEffect, createMutationEffect, createRenderEffect, createIdleEffect,
  frameMeasure, frameMutation, frameForcedReflow, idle, gateOnHeavyAnimation, deferUntilIdle,
} from './core/frame';

export {
  requestMeasure, requestMutation, requestNextMutation, requestForcedReflow, getPhase, onPhaseChange, type Phase,
} from './scheduler/fasterdom';
export { onTickEnd, onIdle, throttleWith, throttle } from './scheduler/schedulers';
export {
  beginHeavyAnimation, getIsHeavyAnimating, getIsBlockingAnimating, createHeavyAnimationScope, rootScope,
  provideHeavyAnimationScope, currentHeavyAnimationScope, onHeavyAnimation, onFullyIdle,
  type HeavyAnimationScope, type OnceSignal,
} from './scheduler/heavyAnimation';
export { flushSync } from './core/flush';
export type { Scope as Owner } from './core/types';
