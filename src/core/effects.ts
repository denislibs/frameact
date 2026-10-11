import { DEV } from '../env';
import {
  assertApplyOwner,
  compute as runInScope,
  createComputation,
  handleError,
  isFunction,
  setEffectDisposeHook,
  setEffectScheduler,
  setInEffectApply,
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
  /** @internal its apply writes the live DOM: apply-cleanups on dispose are deferred to the mutate phase */
  _writesDom: boolean;
  /** @internal tickEnd loop guard: the macrotask epoch `_tickRuns` counts runs in */
  _tickEpoch: number;
  /** @internal tickEnd loop guard: runs scheduled within `_tickEpoch` */
  _tickRuns: number;
}

export interface EffectOptions {
  /** Dev label (compiler's sourceNames or a facade name). */
  name?: string;
  /** @internal Apply synchronously at creation (mutation effects, createSelector). */
  immediateApply?: boolean;
  /**
   * @internal The apply writes the live DOM (createMutationEffect sets it). Defaults to whether the
   * scheduler is marked DOM-writing (frameMutation, or gateOnHeavyAnimation over it).
   */
  writesDom?: boolean;
}

const domWritingSchedules = new WeakSet<Schedule>();

/** @internal frame.ts marks frameMutation (and gated wrappers of it) as DOM-writing. */
export function markWritesDom(schedule: Schedule) {
  domWritingSchedules.add(schedule);
}

/** @internal */
export function isDomWritingSchedule(schedule: Schedule) {
  return domWritingSchedules.has(schedule);
}

const SELF_DIRTY_LIMIT = 100;

/** The effect whose apply/compute is currently running (dev attribution for stricterdom). */
export let currentEffect: EffectNode | null = null;

/** Max tickEnd runs of one effect within one macrotask before it is treated as a loop. */
const TICK_LIMIT = 100;

/** Advanced by a macrotask armed when an effect starts counting in the current epoch. */
let tickEpoch = 1;
let tickEpochArmed = false;

function advanceTickEpoch() {
  tickEpochArmed = false;
  tickEpoch++;
}

/**
 * Runs at the end of the current tick (a microtask). Loop guard: effects dirtying each other (or
 * themselves through a third party) would otherwise spin the microtask queue forever and starve
 * the event loop. Each effect may run TICK_LIMIT times per macrotask; further runs are reported
 * and moved to macrotasks, so input, timers and rendering keep running between them.
 */
export const tickEnd: Schedule = (run, node) => {
  if (node._tickEpoch !== tickEpoch) {
    node._tickEpoch = tickEpoch;
    node._tickRuns = 0;
    if (!tickEpochArmed) {
      tickEpochArmed = true;
      setTimeout(advanceTickEpoch, 0);
    }
  }
  if (++node._tickRuns > TICK_LIMIT) {
    if (node._tickRuns === TICK_LIMIT + 1) {
      console.error(
        `[frameact] Potential infinite loop: effect${node._name ? ` "${node._name}"` : ''} ran ${TICK_LIMIT} times on tickEnd within one macrotask. Its further runs are deferred to macrotasks.`,
      );
    }
    setTimeout(() => {
      // A macrotask hop breaks the loop: the self-dirty guard restarts its count too (it would
      // otherwise trip on the very next self-write and add a second hop).
      node._selfDirty = 0;
      run();
    }, 0);
    return;
  }
  onTickEnd(run);
};

export function createEffect<T>(
  compute: (prev: T | undefined) => T,
  apply: (value: T, prev: T | undefined) => void | (() => void),
  schedule: Schedule = tickEnd,
  options?: EffectOptions,
): void {
  if (DEV) assertApplyOwner();
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
  node._tickEpoch = 0;
  node._tickRuns = 0;
  node._writesDom = options?.writesDom ?? domWritingSchedules.has(schedule);
  node._scope = currentHeavyAnimationScope(node); // appended to the current owner by the constructor
  node._run = () => runEffect(node);

  // First compute: synchronous, tracked, under the owner that created the effect.
  if (!computeNode(node)) return;
  if (options?.immediateApply) applyEffect(node);
  else schedule(node._run, node);
}

/**
 * Recompute the node's compute half. Returns false if the node died or threw, and also when the
 * first compute failed with the error handled by onError (`_init` still false): then there is no
 * value to apply. The node stays linked to the sources it read and retries on their next change.
 */
function computeNode(node: EffectNode): boolean {
  const outer = currentEffect;
  currentEffect = node;
  try {
    if (node._state === STATE_CLEAN && node._init) return true;
    if (node._init) updateCheck(node);
    else update(node);
    return node._state !== STATE_DISPOSED && node._init;
  } catch (error) {
    // update() already offered the error to onError handlers and re-threw: just report.
    logEffectError(node, error);
    if (node._state !== STATE_DISPOSED) node._state = STATE_CLEAN;
    return false;
  } finally {
    currentEffect = outer;
  }
}

function runEffect(node: EffectNode) {
  if (node._state === STATE_DISPOSED) return;

  // Ancestor rule (spec §3.2): never run an ancestor effect's compute from here. Check the WHOLE
  // owner chain for effects first; bail onto the nearest non-CLEAN one — its own run disposes us
  // (DIRTY) or releases us (CHECK that resolves clean, or a run that throws).
  let memos: Computation[] | null = null;
  for (let p = node[SCOPE] as Computation | null; p !== null; p = p[SCOPE] as Computation | null) {
    if (p._effect) {
      if (p._state !== STATE_CLEAN) {
        ((p as EffectNode)._bailed ??= []).push(node);
        return;
      }
    } else if (p._compute && p._state !== STATE_CLEAN) {
      (memos ??= []).push(p);
    }
  }

  try {
    // All effect ancestors are clean: pull dirty memo ancestors top-down like any read (pure);
    // one of them may dispose us.
    if (memos) {
      for (let i = memos.length - 1; i >= 0; i--) {
        try {
          updateCheck(memos[i]);
        } catch (error) {
          logEffectError(node, error);
        }
        if (node._state === STATE_DISPOSED) return;
      }
    }

    if (!computeNode(node)) return;
    if (node._applied === NOT_APPLIED || node._value !== node._applied) applyEffect(node);
  } finally {
    // Reset the self-dirty counter only when the whole run (compute AND apply) ended without
    // re-dirtying the node.
    if (node._state === STATE_CLEAN) node._selfDirty = 0;
    // Children that bailed onto us are re-scheduled however this run ended (success or error).
    releaseBailed(node);
  }
}

function applyEffect(node: EffectNode) {
  const prev = node._applied === NOT_APPLIED ? undefined : node._applied;
  const cleanup = node._applyCleanup;
  node._applyCleanup = null;
  const outer = currentEffect;
  currentEffect = node;
  const outerInApply = DEV ? setInEffectApply(true) : false;
  try {
    // The previous cleanup is isolated: a throwing cleanup must not skip this apply.
    if (cleanup) {
      try {
        cleanup();
      } catch (error) {
        reportApplyError(node, error);
      }
    }
    try {
      // Untracked and with NO owner (Solid 2.0 model): the apply channel's cleanup is the returned
      // function only. onCleanup()/owned computations here are a DEV error (core assertApplyOwner).
      const result = runInScope(null, () => node._apply(node._value, prev), null);
      if (isFunction(result)) {
        // An apply that disposed its own node: the dispose hook already ran, so nothing would ever
        // call this cleanup. Run it now (deferred to the mutate phase for DOM-writing effects).
        if (node._state === STATE_DISPOSED) applyCleanupDisposer(node, result as () => void);
        else node._applyCleanup = result as () => void;
      }
      // Only a successful apply advances _applied; a throwing one is retried on the next run.
      node._applied = node._value;
    } catch (error) {
      reportApplyError(node, error);
    }
  } finally {
    if (DEV) setInEffectApply(outerInApply);
    currentEffect = outer;
  }
}

/** onError handlers up the owner chain first; unhandled → console. Never throws. */
function reportApplyError(node: EffectNode, error: unknown) {
  try {
    handleError(node, error);
  } catch (unhandled) {
    logEffectError(node, unhandled);
  }
}

function releaseBailed(node: EffectNode) {
  const bailed = node._bailed;
  if (!bailed) return;
  node._bailed = null;
  for (const child of bailed) {
    if (child._state === STATE_DISPOSED) continue;
    // One throwing custom scheduler must not lose the remaining children.
    try {
      child._schedule(child._run, child);
    } catch (error) {
      logEffectError(child, error);
    }
  }
}

function logEffectError(node: EffectNode, error: unknown) {
  console.error(`[frameact] Error in effect${node._name ? ` "${node._name}"` : ''}`, error);
}

// ---- wiring into the core -------------------------------------------------

setEffectScheduler((raw) => {
  const node = raw as EffectNode;
  if (currentEffect === node) {
    // Dirtied by a write made inside its own compute or apply (patch 1 made this visible).
    // Always on: a tickEnd self-loop would otherwise starve the event loop with microtasks.
    if (++node._selfDirty > SELF_DIRTY_LIMIT) {
      console.error(
        `[frameact] Potential infinite loop: effect${node._name ? ` "${node._name}"` : ''} re-dirtied itself ${SELF_DIRTY_LIMIT} times. Its next run is deferred to a macrotask.`,
      );
      node._selfDirty = 0;
      // The node is DIRTY already (notify set it): dropping the run would freeze it forever.
      setTimeout(() => {
        try {
          node._schedule(node._run, node);
        } catch (error) {
          logEffectError(node, error);
        }
      }, 0);
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
