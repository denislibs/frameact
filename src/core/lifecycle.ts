// Component lifecycle helpers over the owner tree (plan 6): the two moments
// a teact component cares about — "my nodes are attached" (`useEffect(fn, [])`) and "I am gone"
// (the unmount cleanup) — plus the heavy-animation listener that unsubscribes with its owner.
import { DEV } from '../env';
import { dispose, getScope, onDispose, scoped } from './core';
import { createMeasureEffect } from './frame';
import type { Computation, Scope } from './types';
import { currentHeavyAnimationScope, onHeavyAnimation, type HeavyAnimationScope } from '../scheduler/heavyAnimation';

/** True for an owner whose body re-runs (a memo or an effect compute); false for a component/root scope. */
function isComputation(owner: Scope): boolean {
  const c = owner as Computation;
  return c._effect === true || c._compute !== null;
}

/**
 * Run `fn` once, after the owner's nodes are attached, in the **measure phase** of the next frame:
 * it sees real layout (`focus()`, `getBoundingClientRect`, reading `scrollTop`; stricterdom-safe) and
 * must not write the DOM. A write after mounting (restoring `scrollTop`, a class) goes through
 * `requestMutation(() => …)`. Never re-runs: `fn` runs untracked, under the owner that called
 * `onMount`, so `onCleanup`, `createEffect` and friends inside it belong to the component and
 * go with it (Solid parity). `fn` may also return a cleanup, registered on that owner (it runs on
 * dispose, whatever the phase: do not read layout in it, and write the DOM through `requestMutation`;
 * save state like a scroll position from an event handler instead, see `onDestroy`). Replaces
 * teact's `useEffect(fn, [])` and `useLayoutEffect(fn, [])` for mount-time work.
 *
 * A blocking heavy animation of the owner's scope delays `fn` until it ends (the usual gating). The
 * effect that carries `fn` frees itself after that first run: a mounted component keeps nothing.
 *
 * ```ts
 * onMount(() => {
 *   const top = state.ui.chatListScroll; // read in the measure phase
 *   requestMutation(() => { list.scrollTop = top; }); // write in the mutate phase
 * });
 * ```
 */
export function onMount(fn: () => void | (() => void)): void {
  const owner = getScope();
  let carrier: Scope | null = null;
  createMeasureEffect(
    () => {
      carrier = getScope(); // inside a compute the current scope is the effect node itself
      return undefined;
    },
    () => {
      // One run is all it does: release the node now (the owner's child list, its dependency links).
      if (carrier !== null) {
        const self = carrier;
        carrier = null;
        dispose.call(self);
      }
      scoped(() => {
        const cleanup = fn();
        if (typeof cleanup === 'function') {
          if (owner === null) {
            if (DEV) console.warn('[frameact] onMount: the cleanup returned has no owner to run on (onMount was called outside a component).');
          } else onDispose(cleanup);
        }
      }, owner);
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
 * `requestMutation(() => …)`. `fn` often runs in the mutate phase, so it must not read layout
 * (`scrollTop`, `getBoundingClientRect`: a forced reflow there): keep what you need to save, such as
 * a scroll position, up to date from an event handler (where reading is legal) and save that value.
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
 * heavy-animation scope the owner is under, not the root) and its ancestors up to the root, and
 * unsubscribes when the owner is disposed. `onStart` fires at once if some scope of that chain
 * already animates (teact's `useHeavyAnimation`). teact's third argument `isDisabled` is an effect
 * instead: `createEffect(() => props.disabled, (off) => off ? undefined : onHeavyAnimation(onStart, onEnd, scope))`
 * (the unsubscribe is the cleanup; `watchHeavyAnimation` itself belongs in the component body).
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
