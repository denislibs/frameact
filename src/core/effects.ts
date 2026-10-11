import { DEV } from '../env';
import {
  compute as runInScope,
  createComputation,
  handleError,
  isFunction,
  setEffectDisposeHook,
  setEffectScheduler,
  STATE_CLEAN,
  STATE_DISPOSED,
  update,
  updateCheck,
} from './core';
import { SCOPE } from './symbols';
import type { Computation } from './types';
import { onTickEnd } from '../scheduler/schedulers';
import { currentHeavyAnimationScope, type HeavyAnimationScope } from '../scheduler/heavyAnimation';

export const NOT_APPLIED: unique symbol = Symbol('frameact.notApplied');

/** Called by the core when an effect becomes dirty. Decides *when* `run` executes. */
export type Schedule = (run: () => void, node: EffectNode) => void;

export interface EffectNode<T = any> extends Computation<T> {
  _apply: (value: T, prev: T | undefined) => void | (() => void);
  _applied: T | typeof NOT_APPLIED;
  _applyCleanup: (() => void) | null;
  _schedule: Schedule;
  _scope: HeavyAnimationScope;
  _bailed: EffectNode[] | null;
  _run: () => void;
  _name: string | undefined;
  _selfDirty: number;
}

export interface EffectOptions {
  /** Dev label (compiler's sourceNames or a facade name). */
  name?: string;
  /** @internal Apply synchronously at creation (mutation effects, createSelector). */
  immediateApply?: boolean;
}

const SELF_DIRTY_LIMIT = 100;

/** The effect whose apply/compute is currently running (dev attribution for stricterdom). */
export let currentEffect: EffectNode | null = null;

export const tickEnd: Schedule = (run) => onTickEnd(run);

export function createEffect<T>(
  compute: (prev: T | undefined) => T,
  apply: (value: T, prev: T | undefined) => void | (() => void),
  schedule: Schedule = tickEnd,
  options?: EffectOptions,
): void {
  const node = createComputation<T>(undefined as T, null) as EffectNode<T>;
  node._compute = function (this: EffectNode<T>) {
    return compute(this._init ? this._value : undefined);
  };
  node._effect = true;
  node._apply = apply;
  node._applied = NOT_APPLIED;
  node._applyCleanup = null;
  node._schedule = schedule;
  node._bailed = null;
  node._name = options?.name;
  node._selfDirty = 0;
  node._scope = currentHeavyAnimationScope(node); // appended to the current owner by the constructor
  node._run = () => runEffect(node);

  // First compute: synchronous, tracked, under the owner that created the effect.
  if (!computeNode(node)) return;
  if (options?.immediateApply) applyEffect(node);
  else schedule(node._run, node);
}

/** Recompute the node's compute half. Returns false if the node died or threw. */
function computeNode(node: EffectNode): boolean {
  const outer = currentEffect;
  currentEffect = node;
  try {
    if (node._state === STATE_CLEAN && node._init) return true;
    if (node._init) updateCheck(node);
    else update(node);
    return node._state !== STATE_DISPOSED;
  } catch (error) {
    // update() already offered the error to onError handlers and re-threw: just report.
    logEffectError(node, error);
    node._state = STATE_CLEAN;
    return false;
  } finally {
    currentEffect = outer;
  }
}

function runEffect(node: EffectNode) {
  if (node._state === STATE_DISPOSED) return;

  // Ancestor rule (spec §3.2): never run an ancestor effect's compute from here.
  for (let p = node[SCOPE] as Computation | null; p !== null; p = p[SCOPE] as Computation | null) {
    if (p._effect) {
      if (p._state !== STATE_CLEAN) {
        // Its own run will dispose us (DIRTY) or release us (CHECK that resolves clean).
        ((p as EffectNode)._bailed ??= []).push(node);
        return;
      }
    } else if (p._compute && p._state !== STATE_CLEAN) {
      // A dirty memo ancestor is pulled like any read (pure); it may dispose us.
      try {
        updateCheck(p);
      } catch (error) {
        logEffectError(node, error);
      }
      if (node._state === STATE_DISPOSED) return;
    }
  }

  if (!computeNode(node)) return;
  if (node._state === STATE_CLEAN) node._selfDirty = 0;

  if (node._applied === NOT_APPLIED || node._value !== node._applied) applyEffect(node);

  releaseBailed(node);
}

function applyEffect(node: EffectNode) {
  const prev = node._applied === NOT_APPLIED ? undefined : node._applied;
  const cleanup = node._applyCleanup;
  node._applyCleanup = null;
  const outer = currentEffect;
  currentEffect = node;
  try {
    cleanup?.();
    // Untracked (observer = null), owner = the effect node so onCleanup() inside apply attaches to it.
    const result = runInScope(node, () => node._apply(node._value, prev), null);
    if (isFunction(result)) node._applyCleanup = result as () => void;
  } catch (error) {
    try {
      handleError(node, error);
    } catch (unhandled) {
      logEffectError(node, unhandled);
    }
  } finally {
    currentEffect = outer;
    node._applied = node._value;
  }
}

function releaseBailed(node: EffectNode) {
  const bailed = node._bailed;
  if (!bailed) return;
  node._bailed = null;
  for (const child of bailed) {
    if (child._state !== STATE_DISPOSED) child._schedule(child._run, child);
  }
}

function logEffectError(node: EffectNode, error: unknown) {
  console.error(`[frameact] Error in effect${node._name ? ` "${node._name}"` : ''}`, error);
}

// ---- wiring into the core -------------------------------------------------

setEffectScheduler((raw) => {
  const node = raw as EffectNode;
  if (currentEffect === node) {
    // Dirtied by a write made inside its own compute (patch 1 made this visible).
    if (DEV && ++node._selfDirty > SELF_DIRTY_LIMIT) {
      console.error(
        `[frameact] Potential infinite loop: effect${node._name ? ` "${node._name}"` : ''} re-dirtied itself ${SELF_DIRTY_LIMIT} times. Scheduling stopped.`,
      );
      return;
    }
  }
  node._schedule(node._run, node);
});

/** How an apply-cleanup runs when its effect is disposed. Task 9 replaces this to defer DOM cleanups to the mutate phase. */
let applyCleanupDisposer: (node: EffectNode, cleanup: () => void) => void = (node, cleanup) => {
  try {
    cleanup();
  } catch (error) {
    logEffectError(node, error);
  }
};
export function setApplyCleanupDisposer(fn: typeof applyCleanupDisposer) {
  applyCleanupDisposer = fn;
}

setEffectDisposeHook((raw) => {
  const node = raw as EffectNode;
  node._bailed = null;
  const cleanup = node._applyCleanup;
  if (cleanup) {
    node._applyCleanup = null;
    applyCleanupDisposer(node, cleanup);
  }
});
