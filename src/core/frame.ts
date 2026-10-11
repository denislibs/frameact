import { DEV } from '../env';
import { STATE_DISPOSED } from './core';
import {
  createEffect,
  isDomWritingSchedule,
  markWritesDom,
  NOT_APPLIED,
  setApplyCleanupDisposer,
  type EffectNode,
  type EffectOptions,
  type Schedule,
} from './effects';
import { getPhase, requestForcedReflow, requestMeasure, requestMutation } from '../scheduler/fasterdom';
import { firstAnimatingScope, isAnyScopeBlocking, onFullyIdle, type HeavyAnimationScope } from '../scheduler/heavyAnimation';
import { computed, signal } from './signals';

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
 * P3b: queues hold the EffectNode itself in the common case (its `_run` is the run), plain
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

/** @internal Task 10 installs gating here. Returns the scope that blocks `scope`, or null. */
export const drainHooks: {
  blockingScopeFor: (
    scope: HeavyAnimationScope,
    cache: Map<HeavyAnimationScope, HeavyAnimationScope | null>,
  ) => HeavyAnimationScope | null;
  park: (blocker: HeavyAnimationScope, entry: FrameEntry) => void;
} = {
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
  push(phase, node === null ? run : run === node._run ? node : { run, node, phase });
  // Only re-dirties warn: a measure effect created during a mutate drain legitimately schedules its first run.
  if (DEV && phase === 'measure' && getPhase() === 'mutate' && node !== null && node._applied !== NOT_APPLIED) {
    console.warn(
      `[frameact] measure effect${node?._name ? ` "${node._name}"` : ''} was dirtied during the mutate phase — it will run next frame. Write that signal from a measure effect or event handler instead.`,
    );
  }
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
  const gating = isAnyScopeBlocking();
  let blockCache: Map<HeavyAnimationScope, HeavyAnimationScope | null> | null = null;
  let overflow: QueueItem[] | null = null;
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
            const blocker = drainHooks.blockingScopeFor(node._scope, (blockCache ??= new Map()));
            if (blocker !== null) {
              drainHooks.park(blocker, isNode ? { run: node._run, node, phase } : (item as FrameEntry));
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
        if (isNode) node!._run();
        else (item as FrameEntry).run();
      } catch (error) {
        console.error(`[frameact] ${phase} drain: entry failed`, error);
      }
    }
  } finally {
    queues[phase] = [];
    armed[phase] = false;
  }
  if (overflow !== null) for (let i = 0; i < overflow.length; i++) push(phase, overflow[i]);
}

export const frameMeasure: Schedule = (run, node) => enqueue('measure', run, node);
export const frameMutation: Schedule = (run, node) => enqueue('mutate', run, node);
export const frameForcedReflow: Schedule = (run, node) => enqueue('reflow', run, node);
markWritesDom(frameMutation);

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
  if (node._writesDom && getPhase() !== 'mutate') enqueue('mutate', run, null);
  else run();
});

// ---- heavy-animation gating ----------------------------------------------

// Both hooks run inside the drain's per-entry try/catch, where a throw drops the entry and leaves
// its effect DIRTY forever. They must therefore never throw: failures degrade to "not gated".

function blockingScopeFor(
  scope: HeavyAnimationScope,
  cache: Map<HeavyAnimationScope, HeavyAnimationScope | null>,
): HeavyAnimationScope | null {
  // Sampled once per drain per scope: an applier that begins an animation mid-drain
  // does not split the frame it is part of.
  try {
    const path: HeavyAnimationScope[] = [];
    let result: HeavyAnimationScope | null = null;
    for (let s: HeavyAnimationScope | null | undefined = scope; s; s = s.parent) {
      const cached = cache.get(s);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      path.push(s);
      if (s.isBlockingAnimating.peek()) {
        result = s;
        break;
      }
    }
    for (const p of path) cache.set(p, result);
    return result;
  } catch (error) {
    console.error('[frameact] heavy-animation gate check failed; running ungated', error);
    return null;
  }
}

function releaseParked(scope: HeavyAnimationScope) {
  scope._releaseArmed = false;
  const parked = scope._parked as FrameEntry[];
  scope._parked = [];
  // Release inside a measure task so that both measure and mutate work land in the SAME
  // next frame, in phase order. Measure entries are drained right here, unconditionally: a
  // requestMeasure issued from within the measure phase would slip to the frame after, and an
  // already-armed measure drain is booked for that later frame too. Mutate/reflow entries go
  // through their normal queues, which run later in this frame.
  requestMeasure(() => {
    for (const e of parked) {
      if (e.node !== null && e.node._state === STATE_DISPOSED) continue;
      if (e.phase === 'measure') queues.measure.push(e);
      else enqueue(e.phase, e.run, e.node);
    }
    if (queues.measure.length) {
      armed.measure = true; // drain's finally resets it; a drain booked earlier then finds an empty queue
      drain('measure');
    }
  });
}

function park(scope: HeavyAnimationScope, entry: FrameEntry) {
  try {
    if (!Array.isArray(scope._parked)) scope._parked = [];
    if (!scope.isBlockingAnimating.peek()) {
      // The scope ended after this drain sampled it (an earlier applier or a deferred cleanup called
      // end()): its `once` has already fired, so arming a new one would strand the entry until the
      // scope animates again. Release now; the work still lands in the next frame.
      scope._parked.push(entry);
      releaseParked(scope);
      return;
    }
    if (!scope._releaseArmed) {
      scope._releaseArmed = true;
      try {
        scope.isBlockingAnimating.once(() => {
          try {
            releaseParked(scope);
          } catch (error) {
            console.error('[frameact] releasing parked frame effects failed', error);
          }
        });
      } catch (error) {
        scope._releaseArmed = false;
        throw error;
      }
    }
    scope._parked.push(entry);
  } catch (error) {
    // Could not park (entry is not in `_parked` unless the release itself failed): run it now rather
    // than leave its effect dirty forever.
    console.error('[frameact] parking a frame effect failed; running it ungated', error);
    entry.run();
  }
}

drainHooks.blockingScopeFor = blockingScopeFor;
drainHooks.park = park;

/** Runs when the browser is idle and nothing in the node's scope chain is animating. */
export const idle: Schedule = (run, node) => onFullyIdle(run, node._scope);

export function createIdleEffect<T>(
  compute: (prev: T | undefined) => T,
  apply: (value: T, prev: T | undefined) => void | (() => void),
  options?: EffectOptions,
) {
  createEffect(compute, apply, idle, { name: 'idle', ...options, immediateApply: false });
}

/**
 * Wrap a scheduler so the run also waits for heavy animations in the node's scope chain
 * (non-blocking by default; frame queues already wait for blocking ones).
 */
export function gateOnHeavyAnimation(schedule: Schedule, options: { blocking?: boolean } = {}): Schedule {
  const blocking = options.blocking ?? false;
  const gated: Schedule = (run, node) => {
    const animating = firstAnimatingScope(node._scope, blocking);
    if (animating === null) schedule(run, node);
    else (blocking ? animating.isBlockingAnimating : animating.isAnimating).once(() => gated(run, node));
  };
  if (isDomWritingSchedule(schedule)) markWritesDom(gated);
  return gated;
}

/**
 * Defer creating a heavy subtree until `scope` is idle: returns `placeholder` until then,
 * then a memoized `fn()`. Scopes gate *updates*, not creation — this is the creation gate.
 */
export function deferUntilIdle<T>(scope: HeavyAnimationScope, fn: () => T, placeholder: T): () => T {
  const ready = signal(false);
  createEffect(() => undefined, () => { ready.set(true); }, (run) => onFullyIdle(run, scope), { name: 'deferUntilIdle' });
  return computed(() => (ready() ? fn() : placeholder));
}
