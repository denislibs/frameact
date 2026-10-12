import { DEV } from '../env';
import {
  assertApplyOwner,
  callUnowned,
  computationPrototype,
  F_INIT,
  F_LIVE,
  F_LIVE_PIN,
  F_PARKED,
  F_STORE,
  F_STORE_GATED,
  F_THREW,
  handleError,
  initComputationNode,
  isFunction,
  notifyDep,
  notifyRoot,
  setEffectDisposeHook,
  setEffectScheduler,
  setInEffectApply,
  STATE_CLEAN,
  STATE_DIRTY,
  STATE_DISPOSED,
  update,
  updateCheck,
} from './core';
import { reportDevHookError } from './debug';
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
  /** @internal DEV only ("why did this run"): the dep whose change scheduled the pending run (a signal or memo); moved to a local (and cleared) when the run starts */
  _dirtyDep: Computation | null;
  /** @internal DEV only: the node written at the root of that notify walk; cleared when the run starts */
  _dirtyRoot: Computation | null;
  /** @internal DEV only: runs of this effect — the creation run and every scheduled run that reached its compute */
  _runs: number;
}

/** DEV: what dirtied an effect's pending run (null once that run started: a released store leaf is not kept alive), and how often it ran. */
export interface EffectDebugInfo {
  /** The signal/memo whose link reached the effect. */
  dep: Computation | null;
  /** The node written at the root of the walk (the signal or store leaf that changed). */
  root: Computation | null;
  runs: number;
}

/** DEV: null outside DEV. */
export function getEffectDebugInfo(node: EffectNode): EffectDebugInfo | null {
  if (!DEV) return null;
  return { dep: node._dirtyDep, root: node._dirtyRoot, runs: node._runs };
}

/**
 * DEV: called after every completed run of an effect with the time it took (stricterdom's run log),
 * and the dep / written root that scheduled THIS run (taken at its start: a write made during the
 * run stamps the next one).
 */
export type RunObserver = (node: EffectNode, ms: number, dep: Computation | null, root: Computation | null) => void;
let runObserver: RunObserver | null = null;
/** @internal stricterdom: observe effect runs (DEV only; a no-op in prod). */
export function setRunObserver(fn: RunObserver | null) {
  if (DEV) runObserver = fn;
}

/**
 * DEV: called twice around every apply — right before it, while `currentEffect` is still the
 * enclosing effect (or null), and at its end, while `currentEffect` is the effect. stricterdom drains
 * mutation records at both points, so a write is attributed to the effect whose apply made it, never
 * to the next apply that happens to drain it. A throw is contained (reported), so `currentEffect` is always restored.
 */
let applyHook: ((node: EffectNode) => void) | null = null;
/** DEV: the hook, contained — a throwing hook (or a throwing `console.error` under it) must not leave `currentEffect` swapped. Never throws. */
function runApplyHook(node: EffectNode) {
  try {
    applyHook!(node);
  } catch (error) {
    reportDevHookError('apply hook', error);
  }
}
/** @internal stricterdom (DEV only; a no-op in prod). */
export function setApplyHook(fn: ((node: EffectNode) => void) | null) {
  if (DEV) applyHook = fn;
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

const storeGatedSchedules = new WeakSet<Schedule>();

/**
 * @internal Marks a schedule whose effects the store gate may park (spec §3.5 req. 6): the frame
 * queues and gateOnHeavyAnimation wrappers (frame.ts). tickEnd and idle effects are never parked —
 * logic does not wait for animations, and idle waits for them on its own.
 */
export function markStoreGated(schedule: Schedule) {
  storeGatedSchedules.add(schedule);
}

const SELF_DIRTY_LIMIT = 100;

/** The effect whose apply/compute is currently running (dev attribution for stricterdom). */
export let currentEffect: EffectNode | null = null;

/** @internal for dom directives: the effect whose compute/apply is running right now, or null. */
export function getRunningEffect(): EffectNode | null {
  return currentEffect;
}

/** @internal for dom directives: true when the effect is CLEAN: not dirty, not queued and not parked by gating (those all leave it dirty). */
export function isEffectClean(node: EffectNode): boolean {
  return node._state === STATE_CLEAN;
}

/** @internal for dom directives: true once the effect is disposed (its bindings must let go of their elements). */
export function isEffectDisposed(node: EffectNode): boolean {
  return node._state === STATE_DISPOSED;
}

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
  // The compute is stored as is: update() calls an effect's compute with `prev` (the last value, or
  // undefined before the first successful run) — no wrapper closure per effect, one call less per run.
  const node: EffectNode<T> = new (Effect as any)(compute, apply, schedule, options);

  // First compute: synchronous, tracked, under the owner that created the effect.
  if (!computeNode(node)) return;
  if (DEV) node._runs = 1; // the creation run (not reported to the run observer: nothing dirtied it)
  if (options?.immediateApply) applyEffect(node);
  else bookRun(node); // (a throwing custom schedule is this effect's error, not the creator's)
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
  if (DEV) {
    this._dirtyDep = null;
    this._dirtyRoot = null;
    this._runs = 0;
  }
  if (storeGatedSchedules.has(schedule)) this._flags |= F_STORE_GATED;
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
    // DIRTY (a signal it reads changed) or not yet initialised: straight to update(); CHECK (a memo it
    // reads may have changed): verify the deps first. (What updateCheck() does, minus a call.)
    if (!init || node._state === STATE_DIRTY) update(node);
    else updateCheck(node);
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

/**
 * The store gate (installed by src/store/gate.ts when `frameact/store` is imported). Called for a run
 * of a store-gated effect that is dirty because of store writes only and not live; returns true when it
 * parked the effect (left dirty, no run booked). Without a store nothing carries F_STORE.
 */
let storeGate: ((node: EffectNode) => boolean) | null = null;
export function setStoreGate(fn: (node: EffectNode) => boolean) {
  storeGate = fn;
}

/** @internal store gate: mark the effect parked (it stays dirty with no run booked). */
export function parkEffect(node: EffectNode) {
  node._flags |= F_PARKED;
}

/**
 * @internal store gate: book the run of a parked effect again (release). False when it was unparked
 * (ran) or disposed meanwhile. F_STORE stays: if another scope in the chain still animates, the run
 * parks there again.
 */
export function rebookParked(node: EffectNode): boolean {
  if (node._state === STATE_DISPOSED || !(node._flags & F_PARKED)) return false;
  node._flags &= ~F_PARKED;
  bookRun(node);
  return true;
}

/** @internal store gate: still parked (not disposed, not unparked by a plain walk). */
export function isParked(node: EffectNode): boolean {
  return node._state !== STATE_DISPOSED && (node._flags & F_PARKED) !== 0;
}

/** @internal the heavy-animation scope snapped when the effect was created. */
export function effectScopeOf(node: EffectNode): HeavyAnimationScope {
  return node._scope;
}

function runEffect(node: EffectNode) {
  if (node._state === STATE_DISPOSED) return;
  // Store gate (spec §3.5): decided when the run executes — once per drain, the gate samples the
  // scopes — not when the write happens. A parked effect stays dirty; a plain walk unparks it.
  if ((node._flags & (F_STORE | F_STORE_GATED | F_LIVE | F_LIVE_PIN)) === (F_STORE | F_STORE_GATED) && storeGate !== null && storeGate(node)) return;

  // Fast path: the whole owner chain is clean (no effect/memo ancestor dirty, no dirty list map).
  // Two loads per level, as before the zombie-rows rule; anything else goes to settleChain.
  for (let p = node[SCOPE] as Computation | null; p !== null; p = p[SCOPE] as Computation | null) {
    if (p._state !== STATE_CLEAN ? p._effect || p._compute !== null : p._mapMemo !== undefined && p._mapMemo._state !== STATE_CLEAN) {
      if (settleChain(node)) return; // bailed onto an ancestor: this run did not happen
      if (node._state === STATE_DISPOSED) {
        releaseBailed(node);
        return;
      }
      break;
    }
  }
  // The stamps of THIS run move to locals now: a write made during the run (an apply that re-dirties
  // its own effect) stamps the next run, and the fields never keep a store leaf alive after this point.
  let dep: Computation | null = null;
  let root: Computation | null = null;
  let computes = false; // DEV: this run recomputes (a booking that finds the effect clean only applies, or does nothing)
  let applies = false;
  if (DEV) {
    dep = node._dirtyDep;
    root = node._dirtyRoot;
    node._dirtyDep = node._dirtyRoot = null;
    computes = node._state !== STATE_CLEAN;
  }
  const t0 = DEV && runObserver !== null ? performance.now() : 0;
  try {
    if (!computeNode(node)) return;
    if (node._applied === NOT_APPLIED || node._value !== node._applied) {
      if (DEV) applies = true;
      applyEffect(node);
    }
  } finally {
    // Reset the self-dirty counter only when the whole run (compute AND apply) ended without
    // re-dirtying the node.
    if (node._state === STATE_CLEAN) node._selfDirty = 0;
    // Children that bailed onto us are re-scheduled however this run ended (success or error).
    releaseBailed(node);
    // DEV: a run counts when it recomputed; the first apply of a scheduled effect ends its creation
    // run (observed for its time, not counted); a booking that found the effect clean did nothing.
    if (DEV && (computes || applies)) {
      if (computes) node._runs++;
      if (runObserver !== null) {
        try {
          runObserver(node, performance.now() - t0, dep, root);
        } catch (error) {
          reportDevHookError('run observer', error); // (must not replace the run's own error)
        }
      }
    }
  }
}

/**
 * Ancestor rule (spec §3.2), slow path: never run an ancestor effect's compute from here. Check the
 * WHOLE owner chain for effects first; bail onto the nearest non-CLEAN one (returns true) — its own
 * run disposes us (DIRTY) or releases us (CHECK that resolves clean, or a run that throws).
 * Otherwise pull dirty memo / map ancestors top-down (may dispose us) and return false.
 */
function settleChain(node: EffectNode): boolean {
  let pass = 0;
  for (;;) {
    let memos: Computation[] | null = null;
    let pullsMap = false;
    let maps = 0;
    for (let p = node[SCOPE] as Computation | null; p !== null; p = p[SCOPE] as Computation | null) {
      if (p._effect) {
        if (p._state !== STATE_CLEAN) {
          ((p as EffectNode)._bailed ??= []).push(node);
          if (p._flags & F_PARKED) {
            p._flags &= ~(F_PARKED | F_STORE);
            bookRun(p as EffectNode);
          } else if (p._flags & F_STORE) {
            p._flags &= ~F_STORE;
          }
          return true;
        }
      } else if (p._compute && p._state !== STATE_CLEAN) {
        (memos ??= []).push(p);
      } else if (p._mapMemo !== undefined && p._mapMemo._state !== STATE_CLEAN) {
        (memos ??= []).push(p._mapMemo);
        pullsMap = true;
        maps++;
      }
    }
    if (!memos) return false;
    let settled = true;
    for (let i = memos.length - 1; i >= 0; i--) {
      try {
        updateCheck(memos[i]);
      } catch (error) {
        logEffectError(node, error);
      }
      if (node._state === STATE_DISPOSED) return false;
      if (memos[i]._state !== STATE_CLEAN) settled = false;
    }
    if (!pullsMap || !settled) return false;
    if (++pass > maps) {
      if (DEV) {
        console.error(
          `[frameact] Potential infinite loop: the owner chain of effect${node._name ? ` "${node._name}"` : ''} was still dirty after ${pass} map pulls (${maps} list scope${maps === 1 ? '' : 's'} in the chain). A list mapper probably writes the source of an enclosing list. The re-walk is stopped and the effect runs.`,
        );
      }
      return false;
    }
  }
}

function applyEffect(node: EffectNode) {
  const prev = node._applied === NOT_APPLIED ? undefined : node._applied;
  const cleanup = node._applyCleanup;
  node._applyCleanup = null;
  const outer = currentEffect;
  if (DEV && applyHook !== null) runApplyHook(node); // records made before this apply belong to the context around it
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
    if (DEV) {
      setInEffectApply(outerInApply);
      if (applyHook !== null) runApplyHook(node); // still attributed to this effect (never throws: the restore below always runs)
    }
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
    // One throwing custom scheduler must not lose the remaining children, nor freeze its own.
    bookRun(child);
  }
}

/**
 * Book the effect's run with its Schedule. A throwing custom Schedule (built-in ones never throw)
 * is this effect's error: reported, never thrown to the caller — a notify() walk (that would cut it
 * short, and from a memo's result write surface as that memo's compute error), the compute that
 * creates the effect, the release of bailed children, the loop guard's macrotask. The node must not
 * stay dirty with no run booked (only the CLEAN → dirty edge schedules: it would be frozen), so it
 * goes back to CLEAN with F_THREW: its next change re-runs its compute even if the deps it saw look
 * unchanged by then (and applies, if it never did).
 */
function bookRun(node: EffectNode) {
  try {
    node._schedule(node._run, node);
  } catch (error) {
    if (node._state !== STATE_DISPOSED) {
      node._state = STATE_CLEAN;
      node._flags |= F_THREW;
    }
    logEffectError(node, error);
  }
}

function logEffectError(node: EffectNode, error: unknown) {
  console.error(`[frameact] Error in effect${node._name ? ` "${node._name}"` : ''}`, error);
}

// ---- wiring into the core -------------------------------------------------

setEffectScheduler((raw) => {
  const node = raw as EffectNode;
  if (DEV) {
    node._dirtyDep = notifyDep;
    node._dirtyRoot = notifyRoot;
  }
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
      setTimeout(() => bookRun(node), 0);
      return;
    }
  }
  bookRun(node);
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
