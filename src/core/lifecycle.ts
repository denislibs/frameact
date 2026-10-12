// Component lifecycle helpers over the owner tree (plan 6, client-readiness kit): the two moments
// a teact component cares about — "my nodes are attached" (`useEffect(fn, [])`) and "I am gone"
// (the unmount cleanup) — plus the heavy-animation listener that unsubscribes with its owner.
import { DEV } from '../env';
import { getScope, onDispose, scoped } from './core';
import { createMeasureEffect } from './frame';
import type { Computation, Scope } from './types';
import { currentHeavyAnimationScope, onHeavyAnimation, type HeavyAnimationScope } from '../scheduler/heavyAnimation';

/** True for an owner whose body re-runs (a memo or an effect compute); false for a component/root scope. */
function isComputation(owner: Scope): boolean {
  const c = owner as Computation;
  return c._effect === true || c._compute !== null;
}

/**
 * Run `fn` once, after the owner's nodes are attached, in the **measure phase** of the next frame
 * (real layout: `focus()`, `scrollTop`, `getBoundingClientRect` are fine; stricterdom-safe). Never
 * re-runs: it is a measure effect with no dependencies (`fn` runs untracked, inside the apply half).
 * `fn` may return a cleanup, registered on the owner that called `onMount` (it runs on dispose; a
 * DOM write in it goes through `requestMutation`, see `onDestroy`). Replaces teact's
 * `useEffect(fn, [])` and `useLayoutEffect(fn, [])` for mount-time work.
 */
export function onMount(fn: () => void | (() => void)): void {
  const owner = getScope();
  createMeasureEffect(
    () => undefined,
    () => {
      const cleanup = fn();
      if (typeof cleanup === 'function') {
        if (owner === null) {
          if (DEV) console.warn('[frameact] onMount: the cleanup returned has no owner to run on (onMount was called outside a component).');
          return;
        }
        scoped(() => onDispose(cleanup), owner);
      }
    },
    { name: 'onMount' },
  );
}

/**
 * Run `fn` once, when the owner (the component) is disposed — the component-scope meaning of
 * `onCleanup`. Called from a re-running computation (an effect or memo compute) it would fire on
 * every re-run, which is `onCleanup`'s job: DEV warns and points there. Like `onCleanup`, `fn` runs
 * synchronously at dispose, whatever the phase; the owner's own DOM is detached by its slot's
 * apply-cleanup (deferred to the mutate phase by the core), but a write `fn` makes to the live DOM
 * outside that subtree (`document.body.classList`, a portal target) must be wrapped in
 * `requestMutation(() => …)`.
 */
export function onDestroy(fn: () => void): void {
  const owner = getScope();
  if (DEV) {
    if (owner === null) console.warn('[frameact] onDestroy called with no owner: the callback will never run.');
    else if (isComputation(owner)) {
      console.warn('[frameact] onDestroy inside an effect or memo compute runs on every re-run; use onCleanup there (onDestroy belongs in the component body).');
    }
  }
  onDispose(fn);
}

/**
 * `onHeavyAnimation` bound to the owner: subscribes `onStart`/`onEnd` to `scope` (default: the
 * heavy-animation scope the owner is under, not the root) and unsubscribes when the owner is
 * disposed. `onStart` fires at once if the scope already animates (teact's `useHeavyAnimation`).
 */
export function watchHeavyAnimation(
  onStart?: () => void,
  onEnd?: () => void,
  scope: HeavyAnimationScope = currentHeavyAnimationScope(),
): () => void {
  const off = onHeavyAnimation(onStart, onEnd, scope);
  if (getScope() === null) {
    if (DEV) console.warn('[frameact] watchHeavyAnimation called with no owner: the listener is never removed (use onHeavyAnimation and keep the unsubscribe).');
  } else onDispose(off);
  return off;
}
