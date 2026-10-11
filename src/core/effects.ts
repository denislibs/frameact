import { DEV } from '../env';
import {
  assertApplyOwner,
  callUnowned,
  computationPrototype,
  F_INIT,
  handleError,
  initComputationNode,
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
import { getTickDrainEpoch, isTickDraining, onTickEnd } from '../scheduler/schedulers';
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
  /** @internal tickEnd loop guard: the flushTickEnd drain epoch `_tickRuns` counts runs in */
  _tickEpoch: number;
  /** @internal tickEnd loop guard: runs scheduled into the drain `_tickEpoch` */
  _tickRuns: number;
  /** @internal frame drain loop guard: the drain `_drainRuns` counts runs in (frame.ts) */
  _drainEpoch: number;
  /** @internal frame drain loop guard: runs within `_drainEpoch` */
  _drainRuns: number;
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

const drainGuardedSchedules = new WeakSet<Schedule>();

/**
 * @internal Marks a schedule whose queue has its own per-drain loop guard (tickEnd, the frame
 * queues, and gateOnHeavyAnimation wrappers of them). The generic self-dirty guard skips effects on
 * such schedules: it would count the same runs a second time and report the loop twice.
 */
export function markDrainGuarded(schedule: Schedule) {
  drainGuardedSchedules.add(schedule);
}

/** @internal */
export function isDrainGuardedSchedule(schedule: Schedule) {
  return drainGuardedSchedules.has(schedule);
}

const SELF_DIRTY_LIMIT = 100;

/** The effect whose apply/compute is currently running (dev attribution for stricterdom). */
export let currentEffect: EffectNode | null = null;

/** Max tickEnd runs of one effect within one flushTickEnd drain before it is treated as a loop. */
const TICK_LIMIT = 100;

/**
 * Runs at the end of the current tick (a microtask). flushTickEnd drains until empty, so a cascade
 * of effects dirtying each other runs to completion in one drain. Loop guard: a cascade that never
 * converges (effects re-dirtying each other or themselves with no external input in between) would
 * otherwise keep that drain going forever and starve the event loop. Each effect may run TICK_LIMIT
 * times per drain; the next run is reported (once per drain) and moved to a macrotask, so input,
 * timers and rendering get a turn every TICK_LIMIT runs. Runs caused by external writes (each
 * flushSync(), each `await` step) start a new drain and therefore a fresh count.
 *
 * Counted when the run is *scheduled* (no wrapper allocation per run): inside a drain the run joins
 * that drain; outside one it is queued for the next drain, whose epoch will be the current one + 1
 * (an epoch is bumped only by a drain that has work, and every queued run is taken by the next
 * drain, which runs until empty).
 */
export const tickEnd: Schedule = (run, node) => {
  const epoch = isTickDraining() ? getTickDrainEpoch() : getTickDrainEpoch() + 1;
  if (node._tickEpoch !== epoch) {
    node._tickEpoch = epoch;
    node._tickRuns = 0;
  }
  if (++node._tickRuns > TICK_LIMIT) {
    if (node._tickRuns === TICK_LIMIT + 1) {
      console.error(
        `[frameact] Potential infinite loop: effect${node._name ? ` "${node._name}"` : ''} ran ${TICK_LIMIT} times in one tickEnd drain. Its next run is deferred to a macrotask.`,
      );
    }
    setTimeout(() => {
      // A macrotask hop breaks the loop: the self-dirty guard (used when tickEnd is wrapped by a
      // custom schedule) restarts its count too, instead of tripping on the very next self-write.
      node._selfDirty = 0;
      run();
    }, 0);
    return;
  }
  onTickEnd(run);
};
markDrainGuarded(tickEnd);

export function createEffect<T>(
  compute: (prev: T | undefined) => T,
  apply: (value: T, prev: T | undefined) => void | (() => void),
  schedule: Schedule = tickEnd,
  options?: EffectOptions,
): void {
  if (DEV) assertApplyOwner();
  const node: EffectNode<T> = new (Effect as any)(
    function (this: EffectNode<T>) {
      return compute(this._flags & F_INIT ? this._value : undefined);
    },
    apply,
    schedule,
    options,
  );

  // First compute: synchronous, tracked, under the owner that created the effect.
  if (!computeNode(node)) return;
  if (options?.immediateApply) applyEffect(node);
  else schedule(node._run, node);
}

/**
 * P3a: effect nodes get their own constructor (sharing the Computation prototype chain) that
 * initialises every effect field up front, in one order — one hidden class for all effects.
 */
function Effect(
  this: EffectNode,
  compute: () => unknown,
  apply: EffectNode['_apply'],
  schedule: Schedule,
  options: EffectOptions | undefined,
) {
  // compute is attached after init: an effect starts CLEAN (its first compute runs right away).
  initComputationNode(this, undefined, null, undefined, true);
  this._compute = compute;
  this._effect = true;
  if (DEV) this.id = options?.name ?? 'effect';
  this._apply = apply;
  this._applied = NOT_APPLIED;
  this._applyCleanup = null;
  this._schedule = schedule;
  this._scope = currentHeavyAnimationScope(this); // after the append: reads the owner's context
  this._bailed = null;
  const node = this;
  this._run = () => runEffect(node);
  this._name = options?.name;
  this._selfDirty = 0;
  this._writesDom = options?.writesDom ?? domWritingSchedules.has(schedule);
  this._tickEpoch = 0;
  this._tickRuns = 0;
  this._drainEpoch = 0;
  this._drainRuns = 0;
}
Effect.prototype = computationPrototype;

/**
 * Recompute the node's compute half. Returns false if the node died or threw, and also when the
 * first compute failed with the error handled by onError (F_INIT still unset): then there is no
 * value to apply. The node stays linked to the sources it read and retries on their next change.
 */
function computeNode(node: EffectNode): boolean {
  const outer = currentEffect;
  currentEffect = node;
  try {
    const init = node._flags & F_INIT;
    if (node._state === STATE_CLEAN && init) return true;
    if (init) updateCheck(node);
    else update(node);
    return node._state !== STATE_DISPOSED && (node._flags & F_INIT) !== 0;
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
      const result = callUnowned(node._apply, node._value, prev);
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
  // Dirtied by a write made inside its own compute or apply (patch 1 made this visible). Guards
  // custom schedules, e.g. a synchronous `(run) => run()` that would otherwise recurse without
  // bound. tickEnd and the frame queues count runs per drain themselves (drain-guarded): skipped.
  if (currentEffect === node && !drainGuardedSchedules.has(node._schedule)) {
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
  try {
    node._schedule(node._run, node);
  } catch (error) {
    // notify() marked the node dirty before calling us: with no run booked it would stay dirty and
    // never be scheduled again (only the CLEAN → dirty edge schedules). Undo that, then rethrow.
    if (node._state !== STATE_DISPOSED) node._state = STATE_CLEAN;
    throw error;
  }
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
