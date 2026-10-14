import { DEV } from '../env';
import { F_WRITES_DOM, STATE_DISPOSED } from './core';
import {
  createEffect,
  markDrainGuarded,
  markNodeSchedule,
  markStoreGated,
  markWritesDom,
  NOT_APPLIED,
  RUN_NODE,
  runEffectNode,
  runOf,
  setApplyCleanupDisposer,
  type EffectNode,
  type EffectOptions,
  type Schedule,
} from './effects';
import { getPhase, requestForcedReflow, requestMeasure, requestMutation } from '../scheduler/fasterdom';
import type { HeavyAnimationScope } from '../scheduler/heavyAnimation';
import { describeNode, effectPath, reportDevHookError } from './debug';

export type FramePhase = 'measure' | 'mutate' | 'reflow';

/**
 * @internal A queued run that is not simply "run this effect": created only when parking (the
 * release needs the phase) or when a custom scheduler passes a run other than the node's own.
 */
export interface FrameEntry {
  run: () => void;
  node: EffectNode | null;
  phase: FramePhase;
}

/**
 * P3b: queues hold the EffectNode itself in the common case (booked with RUN_NODE, or with its own `run`), plain
 * functions for detached work (deferred apply-cleanups), and FrameEntry objects only as above —
 * no per-entry allocation on the hot path.
 */
type QueueItem = EffectNode | FrameEntry | (() => void);

/** Max runs of one effect within one drain before it is treated as a loop. */
const LOOP_LIMIT = 100;

const queues: Record<FramePhase, QueueItem[]> = { measure: [], mutate: [], reflow: [] };
const armed: Record<FramePhase, boolean> = { measure: false, mutate: false, reflow: false };
const drainers: Record<FramePhase, () => void> = {
  measure: () => drain('measure'),
  mutate: () => drain('mutate'),
  reflow: () => drain('reflow'),
};
const request: Record<FramePhase, (cb: () => void) => void> = {
  measure: requestMeasure,
  mutate: requestMutation,
  // Mutate work produced by forced-reflow applies runs in fasterdom's forced-reflow mutate phase of
  // the SAME frame (and inside flushSync) instead of slipping to the next frame. The mutate drain
  // already booked for the next frame then finds an empty queue (same trick as releaseParked).
  reflow: (cb) =>
    requestForcedReflow(() => {
      cb();
      if (queues.mutate.length === 0) return undefined;
      return () => {
        armed.mutate = true; // drain's finally resets it
        drain('mutate');
      };
    }),
};

/**
 * @internal Heavy-animation gating and store-gate sampling, installed by scheduler/heavyAnimation.ts
 * (`installGating`) the first time a scope begins an animation, and by the store gate when it loads.
 * Until then no scope can block or animate, so the defaults — never gating, no sampling — behave
 * identically, and an app that never starts a heavy animation does not bundle the gate (nor the
 * scopes): frame.ts no longer imports heavyAnimation.ts at runtime.
 */
export const drainHooks: {
  /** true while some scope blocks: the drain then asks blockingScopeFor / park per entry */
  isGating: () => boolean;
  /** store-gate sampling (heavyAnimation.ts openGateSample): returns the previous sample for closeSample */
  openSample: () => number;
  closeSample: (prev: number) => void;
  /** the scope that blocks the effect's scope chain, or null */
  blockingScopeFor: (node: EffectNode, cache: Map<HeavyAnimationScope, HeavyAnimationScope | null>) => HeavyAnimationScope | null;
  park: (blocker: HeavyAnimationScope, entry: FrameEntry) => void;
} = {
  isGating: () => false,
  openSample: () => 0,
  closeSample: () => {},
  blockingScopeFor: () => null,
  park: () => {},
};

function push(phase: FramePhase, item: QueueItem) {
  queues[phase].push(item);
  if (!armed[phase]) {
    armed[phase] = true;
    request[phase](drainers[phase]);
  }
}

/** @internal used by Task 10's release path */
export function enqueue(phase: FramePhase, run: () => void, node: EffectNode | null) {
  push(phase, node === null ? run : run === RUN_NODE || run === node._run ? node : { run, node, phase });
  // Only re-dirties warn: a measure effect created during a mutate drain legitimately schedules its first run.
  if (DEV && phase === 'measure' && getPhase() === 'mutate' && node !== null && node._applied !== NOT_APPLIED) {
    console.warn(
      `[frameact] measure effect ${effectPath(node)} [mutate] was dirtied during the mutate phase by ${describeNode(node._dirtyRoot)} — it will run next frame. Write that signal from a measure effect or event handler instead.`,
    );
  }
}

/** DEV: called after every frame drain with its phase, duration and the number of effect runs (stricterdom's slow-phase warning). */
export type DrainObserver = (phase: FramePhase, ms: number, runs: number) => void;
let drainObserver: DrainObserver | null = null;
/** @internal stricterdom (DEV only; a no-op in prod). */
export function setDrainObserver(fn: DrainObserver | null) {
  if (DEV) drainObserver = fn;
}
/** DEV: the phase whose drain is running, or null (tickEnd and idle runs happen outside any drain). */
let drainingPhase: FramePhase | null = null;
/** @internal stricterdom's run log: which drain an effect run belongs to (always null in prod). */
export function getDrainingPhase(): FramePhase | null {
  return drainingPhase;
}

/** @internal */
export function isArmed(phase: FramePhase) {
  return armed[phase];
}

/** Bumped by every drain; effects count their runs per drain epoch (`_drainEpoch`/`_drainRuns`). */
let drainEpoch = 0;

/**
 * @internal Drain one phase queue. Entries added while draining are processed in this same drain.
 * A loop guard counts runs per effect (not queue entries): an effect that would run more than
 * LOOP_LIMIT times in one drain is reported once and its further runs are carried to the next frame.
 * Gating is sampled once per drain: while no scope blocks, the gate hook is never consulted.
 */
export function drain(phase: FramePhase) {
  const queue = queues[phase];
  const epoch = ++drainEpoch;
  const gating = drainHooks.isGating();
  let blockCache: Map<HeavyAnimationScope, HeavyAnimationScope | null> | null = null;
  let overflow: QueueItem[] | null = null;
  const prevSample = drainHooks.openSample(); // the store gate decides once per drain (heavyAnimation.ts)
  const t0 = DEV && drainObserver !== null ? performance.now() : 0;
  const outerDraining = DEV ? drainingPhase : null;
  if (DEV) drainingPhase = phase;
  let runs = 0;
  try {
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      try {
        if (typeof item === 'function') {
          item();
          continue;
        }
        const isNode = (item as EffectNode)._effect === true;
        const node = isNode ? (item as EffectNode) : (item as FrameEntry).node;
        if (node !== null) {
          if (node._state === STATE_DISPOSED) continue;
          if (gating) {
            const blocker = drainHooks.blockingScopeFor(node, (blockCache ??= new Map()));
            if (blocker !== null) {
              drainHooks.park(blocker, isNode ? { run: runOf(node), node, phase } : (item as FrameEntry));
              continue;
            }
          }
          if (node._drainEpoch !== epoch) {
            node._drainEpoch = epoch;
            node._drainRuns = 0;
          }
          if (++node._drainRuns > LOOP_LIMIT) {
            if (node._drainRuns === LOOP_LIMIT + 1) {
              console.error(
                `[frameact] ${phase} drain limit: effect${node._name ? ` "${node._name}"` : ''} ran ${LOOP_LIMIT} times in one drain — likely a loop. Remaining runs moved to the next frame.`,
              );
            }
            (overflow ??= []).push(item);
            continue;
          }
        }
        if (DEV) runs++;
        if (isNode) runEffectNode(node!);
        else (item as FrameEntry).run();
      } catch (error) {
        console.error(`[frameact] ${phase} drain: entry failed`, error);
      }
    }
  } finally {
    drainHooks.closeSample(prevSample);
    queues[phase] = [];
    armed[phase] = false;
    if (DEV) {
      drainingPhase = outerDraining;
      if (drainObserver !== null) {
        try {
          drainObserver(phase, performance.now() - t0, runs);
        } catch (error) {
          reportDevHookError('drain observer', error); // (the overflow below must still move on)
        }
      }
    }
  }
  if (overflow !== null) for (let i = 0; i < overflow.length; i++) push(phase, overflow[i]);
}

export const frameMeasure: Schedule = (run, node) => enqueue('measure', run, node);
export const frameMutation: Schedule = (run, node) => enqueue('mutate', run, node);
export const frameForcedReflow: Schedule = (run, node) => enqueue('reflow', run, node);
markWritesDom(frameMutation);
// Booked with the node itself: no per-effect `run` closure (effects.ts RUN_NODE).
markNodeSchedule(frameMeasure);
markNodeSchedule(frameMutation);
markNodeSchedule(frameForcedReflow);
// Each frame drain has its own per-effect LOOP_LIMIT: the generic self-dirty guard stays out.
markDrainGuarded(frameMeasure);
markDrainGuarded(frameMutation);
markDrainGuarded(frameForcedReflow);
// The store gate parks store-caused runs of frame effects (spec §3.5 req. 6); tickEnd/idle never.
markStoreGated(frameMeasure);
markStoreGated(frameMutation);
markStoreGated(frameForcedReflow);

/** Reads layout. First apply is scheduled (after attach), never synchronous. */
export function createMeasureEffect<T>(
  compute: (prev: T | undefined) => T,
  apply: (value: T, prev: T | undefined) => void | (() => void),
  options?: EffectOptions,
) {
  createEffect(compute, apply, frameMeasure, { name: 'measure', ...options, immediateApply: false });
}

/** Writes the live DOM. First apply is synchronous: the nodes are detached at creation. */
export function createMutationEffect<T>(
  compute: (prev: T | undefined) => T,
  apply: (value: T, prev: T | undefined) => void | (() => void),
  options?: EffectOptions,
) {
  createEffect(compute, apply, frameMutation, { name: 'mutation', ...options, immediateApply: true, writesDom: true });
}

/** The name the compiler-facing runtime uses. */
export const createRenderEffect = createMutationEffect;

// Apply-cleanups of DOM-writing effects must run in the mutate phase even when the dispose
// happened elsewhere (a memo recomputed inside an event handler disposing a subtree).
setApplyCleanupDisposer((node, cleanup) => {
  const run = () => {
    try {
      cleanup();
    } catch (error) {
      console.error(`[frameact] Error in effect cleanup${node._name ? ` "${node._name}"` : ''}`, error);
    }
  };
  if (node._flags & F_WRITES_DOM && getPhase() !== 'mutate') enqueue('mutate', run, null);
  else run();
});

// ---- heavy-animation gating: implemented in scheduler/heavyAnimation.ts over these two seams ----

/**
 * @internal The store gate's release (R1): re-book a set of effects inside a measure task, exactly like
 * `releaseParked`, so that measure and mutate work of the set land in the SAME next frame in phase
 * order — a synchronous re-book from an animation that ended in the mutate phase would run the
 * mutate effects now and the measure ones a frame later (a scroll snapshot taken after the DOM changed).
 */
export function releaseInFrame(rebook: () => void) {
  requestMeasure(() => {
    rebook();
    if (queues.measure.length) {
      armed.measure = true; // drain's finally resets it; a drain booked earlier then finds an empty queue
      drain('measure');
    }
  });
}

/**
 * @internal The gate's release of one parked entry: a measure entry goes straight into the measure queue
 * (the caller drains it inside its measure task: a requestMeasure issued from within the measure phase
 * would slip to the frame after), the others through their normal queues, which run later in this frame.
 */
export function requeueParked(e: FrameEntry) {
  if (e.node !== null && e.node._state === STATE_DISPOSED) return;
  if (e.phase === 'measure') queues.measure.push(e);
  else enqueue(e.phase, e.run, e.node);
}
