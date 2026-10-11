import { DEV } from '../env';
import { STATE_DISPOSED } from './core';
import {
  createEffect,
  NOT_APPLIED,
  setApplyCleanupDisposer,
  type EffectNode,
  type EffectOptions,
  type Schedule,
} from './effects';
import { getPhase, requestForcedReflow, requestMeasure, requestMutation } from '../scheduler/fasterdom';
import type { HeavyAnimationScope } from '../scheduler/heavyAnimation';

export type FramePhase = 'measure' | 'mutate' | 'reflow';

/** @internal A queued run. `node === null` for detached work (deferred apply-cleanups). */
export interface FrameEntry {
  run: () => void;
  node: EffectNode | null;
  phase: FramePhase;
}

/** Max runs of one effect within one drain before it is treated as a loop. */
const LOOP_LIMIT = 100;

const queues: Record<FramePhase, FrameEntry[]> = { measure: [], mutate: [], reflow: [] };
const armed: Record<FramePhase, boolean> = { measure: false, mutate: false, reflow: false };
const request: Record<FramePhase, (cb: () => void) => void> = {
  measure: requestMeasure,
  mutate: requestMutation,
  reflow: (cb) => requestForcedReflow(cb),
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

/** @internal used by Task 10's release path */
export function enqueue(phase: FramePhase, run: () => void, node: EffectNode | null) {
  queues[phase].push({ run, node, phase });
  if (!armed[phase]) {
    armed[phase] = true;
    request[phase](() => drain(phase));
  }
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

/**
 * @internal Drain one phase queue. Entries added while draining are processed in this same drain.
 * A loop guard counts runs per effect (not queue entries): an effect that would run more than
 * LOOP_LIMIT times in one drain is reported once and its further runs are carried to the next frame.
 */
export function drain(phase: FramePhase) {
  const queue = queues[phase];
  const blockCache = new Map<HeavyAnimationScope, HeavyAnimationScope | null>();
  const runs = new Map<EffectNode, number>();
  const overflow: FrameEntry[] = [];
  try {
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      try {
        const node = entry.node;
        if (node !== null) {
          if (node._state === STATE_DISPOSED) continue;
          const blocker = drainHooks.blockingScopeFor(node._scope, blockCache);
          if (blocker !== null) {
            drainHooks.park(blocker, entry);
            continue;
          }
          const count = (runs.get(node) ?? 0) + 1;
          runs.set(node, count);
          if (count > LOOP_LIMIT) {
            if (count === LOOP_LIMIT + 1) {
              console.error(
                `[frameact] ${phase} drain limit: effect${node._name ? ` "${node._name}"` : ''} ran ${LOOP_LIMIT} times in one drain — likely a loop. Remaining runs moved to the next frame.`,
              );
            }
            overflow.push(entry);
            continue;
          }
        }
        entry.run();
      } catch (error) {
        console.error(`[frameact] ${phase} drain: entry failed`, error);
      }
    }
  } finally {
    queues[phase] = [];
    armed[phase] = false;
  }
  for (const e of overflow) enqueue(e.phase, e.run, e.node);
}

export const frameMeasure: Schedule = (run, node) => enqueue('measure', run, node);
export const frameMutation: Schedule = (run, node) => enqueue('mutate', run, node);
export const frameForcedReflow: Schedule = (run, node) => enqueue('reflow', run, node);

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
  createEffect(compute, apply, frameMutation, { name: 'mutation', ...options, immediateApply: true });
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
  const writesDom = node._schedule === frameMutation || node._schedule === frameForcedReflow;
  if (writesDom && getPhase() !== 'mutate') enqueue('mutate', run, null);
  else run();
});
