import { DEV } from '../env';
import { STATE_DISPOSED } from './core';
import {
  createEffect,
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

const DRAIN_LIMIT = 10_000;

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

/** @internal */
export function enqueue(phase: FramePhase, run: () => void, node: EffectNode | null) {
  queues[phase].push({ run, node, phase });
  if (!armed[phase]) {
    armed[phase] = true;
    request[phase](() => drain(phase));
  }
  if (DEV && phase === 'measure' && getPhase() === 'mutate') {
    console.warn(
      `[frameact] measure effect${node?._name ? ` "${node._name}"` : ''} was dirtied during the mutate phase — it will run next frame. Write that signal from a measure effect or event handler instead.`,
    );
  }
}

/** @internal */
export function isArmed(phase: FramePhase) {
  return armed[phase];
}

/** @internal Drain one phase queue. Entries added while draining are processed in this same drain. */
export function drain(phase: FramePhase) {
  const queue = queues[phase];
  const blockCache = new Map<HeavyAnimationScope, HeavyAnimationScope | null>();
  let overflow: FrameEntry[] | null = null;
  try {
    for (let i = 0; i < queue.length; i++) {
      if (i === DRAIN_LIMIT) {
        overflow = queue.slice(i);
        console.error(
          `[frameact] ${phase} drain limit (${DRAIN_LIMIT}) reached — an effect keeps re-dirtying this phase. Remaining work moved to the next frame.`,
        );
        break;
      }
      const entry = queue[i];
      if (entry.node !== null) {
        if (entry.node._state === STATE_DISPOSED) continue;
        const blocker = drainHooks.blockingScopeFor(entry.node._scope, blockCache);
        if (blocker !== null) {
          drainHooks.park(blocker, entry);
          continue;
        }
      }
      entry.run();
    }
  } finally {
    queues[phase] = [];
    armed[phase] = false;
  }
  if (overflow) for (const e of overflow) enqueue(e.phase, e.run, e.node);
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
