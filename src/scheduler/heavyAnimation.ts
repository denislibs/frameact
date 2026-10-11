// Adapted from teact (MIT, © 2022 Alexander Zinchuk) — https://github.com/Ajaxy/teact src/teact/heavyAnimation.ts
// Generalised to scopes: the global API is the root scope.
import { getContext, getScope, peek, setContext } from '../core/core';
import { signal } from '../core/signals';
import type { Scope } from '../core/types';
import { onIdle } from './schedulers';

const AUTO_END_TIMEOUT = 1000;

export interface OnceSignal {
  (): boolean;
  peek(): boolean;
  /** Run `cb` once, on the next change of the value. */
  once(cb: () => void): () => void;
}

export interface HeavyAnimationScope {
  readonly parent: HeavyAnimationScope | null;
  readonly isAnimating: OnceSignal;
  readonly isBlockingAnimating: OnceSignal;
  begin(duration?: number, isBlocking?: boolean): () => void;
  /** @internal effects.ts parks gated runs here */
  _parked: unknown[];
  /** @internal */
  _releaseArmed: boolean;
}

type AnimationListener = (animating: boolean) => void;

/** onHeavyAnimation listeners, kept per scope (not exposed on the scope object). */
const scopeListeners = new WeakMap<HeavyAnimationScope, Set<AnimationListener>>();

function createOnceSignal(): [OnceSignal, (v: boolean) => void] {
  const $value = signal(false);
  const callbacks = new Set<() => void>();
  const get = (() => $value()) as OnceSignal;
  get.peek = () => peek($value);
  get.once = (cb) => {
    callbacks.add(cb);
    return () => {
      callbacks.delete(cb);
    };
  };
  const set = (next: boolean) => {
    if (peek($value) === next) return;
    $value.set(next);
    // Snapshot: a callback that registers another `once` must wait for the *next* change,
    // otherwise a release that starts a new animation loops inside this flush.
    const current = Array.from(callbacks);
    callbacks.clear();
    for (const cb of current) cb();
  };
  return [get, set];
}

function createScopeInternal(parent: HeavyAnimationScope | null): HeavyAnimationScope {
  let counter = 0;
  let counterBlocking = 0;
  const [isAnimating, setAnimating] = createOnceSignal();
  const [isBlockingAnimating, setBlocking] = createOnceSignal();
  const listeners = new Set<AnimationListener>();

  const scope: HeavyAnimationScope = {
    parent,
    isAnimating,
    isBlockingAnimating,
    _parked: [],
    _releaseArmed: false,
    begin(duration = AUTO_END_TIMEOUT, isBlocking = false) {
      counter++;
      if (counter === 1) {
        setAnimating(true);
        listeners.forEach((l) => l(true));
      }
      if (isBlocking) {
        counterBlocking++;
        if (counterBlocking === 1) setBlocking(true);
      }

      const timeout = setTimeout(onEnd, duration);
      let hasEnded = false;

      function onEnd() {
        if (hasEnded) return;
        hasEnded = true;
        clearTimeout(timeout);

        counter--;
        if (counter === 0) {
          setAnimating(false);
          listeners.forEach((l) => l(false));
        }
        if (isBlocking) {
          counterBlocking--;
          if (counterBlocking === 0) setBlocking(false);
        }
      }

      return onEnd;
    },
  };
  scopeListeners.set(scope, listeners);
  return scope;
}

export const rootScope: HeavyAnimationScope = createScopeInternal(null);

export function createHeavyAnimationScope(parent: HeavyAnimationScope | null = rootScope) {
  return createScopeInternal(parent);
}

export function beginHeavyAnimation(duration?: number, isBlocking?: boolean) {
  return rootScope.begin(duration, isBlocking);
}
export const getIsHeavyAnimating = rootScope.isAnimating;
export const getIsBlockingAnimating = rootScope.isBlockingAnimating;

/** First scope in the chain (scope → parent → … → root) that is animating (blocking or any). */
export function firstAnimatingScope(scope: HeavyAnimationScope, blocking: boolean) {
  for (let s: HeavyAnimationScope | null = scope; s; s = s.parent) {
    if ((blocking ? s.isBlockingAnimating : s.isAnimating).peek()) return s;
  }
  return null;
}

/** Replacement for teact's useHeavyAnimation hook. */
export function onHeavyAnimation(
  onStart?: () => void,
  onEnd?: () => void,
  scope: HeavyAnimationScope = rootScope,
) {
  const listeners = scopeListeners.get(scope)!;
  const listener: AnimationListener = (animating) => (animating ? onStart?.() : onEnd?.());
  listeners.add(listener);
  if (scope.isAnimating.peek()) onStart?.();
  return () => {
    listeners.delete(listener);
  };
}

export function onFullyIdle(cb: () => void, scope: HeavyAnimationScope = rootScope) {
  onIdle(() => {
    const animating = firstAnimatingScope(scope, false);
    if (animating) {
      animating.isAnimating.once(() => onFullyIdle(cb, scope));
    } else {
      cb();
    }
  });
}

const HEAVY_SCOPE_KEY = Symbol('frameact.heavyAnimationScope');

/** Make `scope` the heavy-animation scope for every effect created under the current owner. */
export function provideHeavyAnimationScope(scope: HeavyAnimationScope) {
  setContext(HEAVY_SCOPE_KEY, scope);
}

export function currentHeavyAnimationScope(owner: Scope | null = getScope()): HeavyAnimationScope {
  return getContext<HeavyAnimationScope>(HEAVY_SCOPE_KEY, owner) ?? rootScope;
}
