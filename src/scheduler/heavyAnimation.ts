// Adapted from teact (MIT, © 2022 Alexander Zinchuk) — https://github.com/Ajaxy/teact src/teact/heavyAnimation.ts
// Generalised to scopes: the global API is the root scope.
import { getContext, getScope, peek, setContext } from '../core/core';
import {
  createEffect, isDomWritingSchedule, isDrainGuardedSchedule, markDrainGuarded, markStoreGated, markWritesDom,
  type EffectNode, type EffectOptions, type Schedule,
} from '../core/effects';
import { drainHooks, releaseInFrame, requeueParked, type FrameEntry } from '../core/frame';
import { computed, signal } from '../core/signals';
import type { Computation, Scope } from '../core/types';
import { onIdle } from './schedulers';

const AUTO_END_TIMEOUT = 1000;
const MAX_TIMEOUT = 2 ** 31 - 1;

function toTimeout(duration: unknown): number {
  if (typeof duration !== 'number' || !(duration >= 0)) return AUTO_END_TIMEOUT;
  return duration > MAX_TIMEOUT ? MAX_TIMEOUT : duration;
}

export interface OnceSignal {
  (): boolean;
  peek(): boolean;
  /** Run `cb` once, on the next change of the value. */
  once(cb: () => void): () => void;
}

export interface HeavyAnimationScope {
  readonly parent: HeavyAnimationScope | null;
  readonly isAnimating: OnceSignal;
  readonly isBlockingAnimating: OnceSignal;
  begin(duration?: number, isBlocking?: boolean): () => void;
  /** @internal effects.ts parks gated runs here */
  parked: unknown[];
  /** @internal */
  releaseArmed: boolean;
  /** @internal store-gate cache: the drain epoch of `gateResult` (0: none) */
  gateEpoch: number;
  /** @internal store-gate cache: the first animating scope of this scope's chain as sampled in `gateEpoch` */
  gateResult: HeavyAnimationScope | null;
}

type AnimationListener = (animating: boolean) => void;

/** Number of scopes currently in a blocking animation (any scope, any chain). */
let blockingScopes = 0;

/**
 * @internal Frame drains skip heavy-animation gating entirely (no scope-chain walk, no cache
 * allocation) while no scope blocks — the common case.
 */
export function isAnyScopeBlocking(): boolean {
  return blockingScopes !== 0;
}

/** Number of scopes currently animating (blocking or not). */
let animatingScopes = 0;

/** @internal The store gate's zero-cost exit: true while any scope animates. */
export function isAnyScopeAnimating(): boolean {
  return animatingScopes !== 0;
}

/*
 * Store-gate sampling (frame.ts drains): one decision per drain, by animation-begin epoch. Opening a
 * drain takes a new epoch; a scope counts as animating for that drain only if it animates NOW and
 * began BEFORE the drain opened. So an applier that begins an animation mid-drain does not split the
 * frame it is part of; a scope that ended mid-drain no longer counts and the chain is checked further
 * up (a nested scope that ended does not hide an outer one that still animates). Outside a drain the
 * chain is read live. A nested drain (flushSync from an applier) takes its own epoch and the outer
 * drain's is restored after it.
 */
let epochCounter = 0;
let sampleEpoch = 0; // 0: no drain open (live)
const beganAt = new WeakMap<HeavyAnimationScope, number>();

/** @internal Open a drain's sample; returns the previous epoch for closeGateSample. */
export function openGateSample(): number {
  const prev = sampleEpoch;
  sampleEpoch = ++epochCounter;
  return prev;
}

/** @internal */
export function closeGateSample(prev: number) {
  sampleEpoch = prev;
}

/** @internal First scope in the chain that animates as sampled by the current drain (live outside a drain). */
export function firstAnimatingScopeSampled(scope: HeavyAnimationScope): HeavyAnimationScope | null {
  if (animatingScopes === 0) return null;
  const epoch = sampleEpoch;
  if (epoch !== 0 && scope.gateEpoch === epoch) {
    // Decided earlier in this drain (one chain walk per scope per drain, not per effect). `null` is stable
    // (a scope that begins mid-drain began after the epoch); a scope found animating may have ended since.
    const cached = scope.gateResult;
    if (cached === null || (cached.isAnimating.peek() && beganAt.get(cached)! < epoch)) return cached; // (a scope re-begun mid-drain does not count)
  }
  let result: HeavyAnimationScope | null = null;
  for (let s: HeavyAnimationScope | null = scope; s; s = s.parent) {
    if (s.isAnimating.peek() && (epoch === 0 || beganAt.get(s)! < epoch)) {
      result = s;
      break;
    }
  }
  if (epoch !== 0) {
    scope.gateEpoch = epoch;
    scope.gateResult = result;
  }
  return result;
}

/** onHeavyAnimation listeners, kept per scope (not exposed on the scope object). */
const scopeListeners = new WeakMap<HeavyAnimationScope, Set<AnimationListener>>();

function reportCallbackError(error: unknown) {
  console.error('[frameact] heavy-animation callback failed', error);
}

/** Calls `fn`; a throw is reported, never propagated (frame bookkeeping must not be cut short). */
function safeCall(fn: () => void) {
  try {
    fn();
  } catch (error) {
    reportCallbackError(error);
  }
}

/**
 * `set` updates the value and returns a `notify` that runs the pending `once` callbacks (or null
 * when the value did not change), so callers can finish all their state updates before any user
 * code runs.
 */
function createOnceSignal(): [OnceSignal, (v: boolean) => (() => void) | null] {
  const $value = signal(false);
  const callbacks = new Set<() => void>();
  const get = (() => $value()) as OnceSignal;
  get.peek = () => peek($value);
  get.once = (cb) => {
    callbacks.add(cb);
    return () => {
      callbacks.delete(cb);
    };
  };
  const set = (next: boolean) => {
    if (peek($value) === next) return null;
    $value.set(next);
    // Snapshot: a callback that registers another `once` must wait for the *next* change,
    // otherwise a release that starts a new animation loops inside this flush.
    const current = Array.from(callbacks);
    callbacks.clear();
    // Each callback is isolated: one throwing must not drop the others (frame.ts's release is one).
    return () => current.forEach(safeCall);
  };
  return [get, set];
}

function createScopeInternal(parent: HeavyAnimationScope | null): HeavyAnimationScope {
  let counter = 0;
  let counterBlocking = 0;
  const [isAnimating, setAnimating] = createOnceSignal();
  const [isBlockingAnimating, setBlocking] = createOnceSignal();
  const listeners = new Set<AnimationListener>();

  // Counters and both flags are updated first, user code (once callbacks, listeners) runs after:
  // a throwing callback can then never leave the scope animating/blocking forever.
  function notify(animatingChanged: (() => void) | null, blockingChanged: (() => void) | null, animating: boolean) {
    if (animatingChanged) {
      animatingChanged();
      listeners.forEach((l) => safeCall(() => l(animating)));
    }
    blockingChanged?.();
  }

  const scope: HeavyAnimationScope = {
    parent,
    isAnimating,
    isBlockingAnimating,
    parked: [],
    releaseArmed: false,
    gateEpoch: 0,
    gateResult: null,
    begin(duration = AUTO_END_TIMEOUT, isBlocking = false) {
      installGating(); // the frame drains gate only once some scope can animate (idempotent)
      counter++;
      if (isBlocking) counterBlocking++;
      const animatingChanged = counter === 1 ? setAnimating(true) : null;
      if (counter === 1) {
        animatingScopes++;
        beganAt.set(scope, epochCounter); // the drain epoch this animation began in (store-gate sampling)
      }
      const blockingChanged = isBlocking && counterBlocking === 1 ? setBlocking(true) : null;
      if (isBlocking && counterBlocking === 1) blockingScopes++;

      // Only an explicit Infinity is manual (no timer, the caller must end it). NaN, negative or
      // non-number durations fall back to the default: an animation that never ends would gate
      // the UI forever. Finite values are clamped to the timer maximum (larger ones fire at once).
      const timeout = duration === Infinity ? undefined : setTimeout(onEnd, toTimeout(duration));
      let hasEnded = false;

      function onEnd() {
        if (hasEnded) return;
        hasEnded = true;
        clearTimeout(timeout);

        counter--;
        if (isBlocking) counterBlocking--;
        const animatingEnded = counter === 0 ? setAnimating(false) : null;
        if (counter === 0) animatingScopes--;
        const blockingEnded = isBlocking && counterBlocking === 0 ? setBlocking(false) : null;
        if (isBlocking && counterBlocking === 0) blockingScopes--;
        notify(animatingEnded, blockingEnded, false);
      }

      notify(animatingChanged, blockingChanged, true);
      return onEnd;
    },
  };
  scopeListeners.set(scope, listeners);
  return scope;
}

// Pure at module level: an app that never imports a heavy-animation API (nor the store) does not bundle this module.
export const rootScope: HeavyAnimationScope = /*#__PURE__*/ createScopeInternal(null);

/** `parent` defaults to the scope provided by the current owner (root if none): a nested scope waits for the outer one. */
export function createHeavyAnimationScope(parent: HeavyAnimationScope | null = currentHeavyAnimationScope()) {
  return createScopeInternal(parent);
}

export function beginHeavyAnimation(duration?: number, isBlocking?: boolean) {
  return rootScope.begin(duration, isBlocking);
}
export const getIsHeavyAnimating: OnceSignal = /*#__PURE__*/ (() => rootScope.isAnimating)();
export const getIsBlockingAnimating: OnceSignal = /*#__PURE__*/ (() => rootScope.isBlockingAnimating)();

/** First scope in the chain (scope → parent → … → root) that is animating (blocking or any). */
export function firstAnimatingScope(scope: HeavyAnimationScope, blocking: boolean) {
  for (let s: HeavyAnimationScope | null = scope; s; s = s.parent) {
    if ((blocking ? s.isBlockingAnimating : s.isAnimating).peek()) return s;
  }
  return null;
}

/** Replacement for teact's useHeavyAnimation hook. */
export function onHeavyAnimation(
  onStart?: () => void,
  onEnd?: () => void,
  scope: HeavyAnimationScope = rootScope,
) {
  const listeners = scopeListeners.get(scope)!;
  const listener: AnimationListener = (animating) => (animating ? onStart?.() : onEnd?.());
  listeners.add(listener);
  if (scope.isAnimating.peek()) onStart?.();
  return () => {
    listeners.delete(listener);
  };
}

export function onFullyIdle(cb: () => void, scope: HeavyAnimationScope = rootScope) {
  onIdle(() => {
    const animating = firstAnimatingScope(scope, false);
    if (animating) {
      animating.isAnimating.once(() => onFullyIdle(cb, scope));
    } else {
      cb();
    }
  });
}

const HEAVY_SCOPE_KEY = Symbol('frameact.heavyAnimationScope');

/** Make `scope` the heavy-animation scope for every effect created under the current owner. */
export function provideHeavyAnimationScope(scope: HeavyAnimationScope) {
  setContext(HEAVY_SCOPE_KEY, scope);
}

export function currentHeavyAnimationScope(owner: Scope | null = getScope()): HeavyAnimationScope {
  return getContext<HeavyAnimationScope>(HEAVY_SCOPE_KEY, owner) ?? rootScope;
}

/**
 * @internal The heavy-animation scope of an effect: the one provided by its owner when it was created.
 * Read from the node's own context record (set when it was appended to its owner and never replaced:
 * `provideHeavyAnimationScope` gives the owner a NEW record), so this is the scope the effect saw at
 * creation — no per-effect field. A disposed node reads the default record: the root scope.
 */
export function effectScopeOf(node: Computation): HeavyAnimationScope {
  return getContext<HeavyAnimationScope>(HEAVY_SCOPE_KEY, node) ?? rootScope;
}

// ---- the frame-drain gate (core/frame.ts drainHooks) ----------------------------------------
// Both hooks run inside the drain's per-entry try/catch, where a throw drops the entry and leaves
// its effect DIRTY forever. They must therefore never throw: failures degrade to "not gated".

function blockingScopeFor(
  node: EffectNode,
  cache: Map<HeavyAnimationScope, HeavyAnimationScope | null>,
): HeavyAnimationScope | null {
  // Sampled once per drain per scope: an applier that begins an animation mid-drain
  // does not split the frame it is part of.
  try {
    const path: HeavyAnimationScope[] = [];
    let result: HeavyAnimationScope | null = null;
    for (let s: HeavyAnimationScope | null | undefined = effectScopeOf(node); s; s = s.parent) {
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
  scope.releaseArmed = false;
  const parked = scope.parked as FrameEntry[];
  scope.parked = [];
  // Release inside a measure task so that both measure and mutate work land in the SAME next frame,
  // in phase order (releaseInFrame): measure entries are drained right there, the others go through
  // their normal queues, which run later in this frame.
  releaseInFrame(() => {
    for (const e of parked) requeueParked(e);
  });
}

function park(scope: HeavyAnimationScope, entry: FrameEntry) {
  try {
    if (!Array.isArray(scope.parked)) scope.parked = [];
    if (!scope.isBlockingAnimating.peek()) {
      // The scope ended after this drain sampled it (an earlier applier or a deferred cleanup called
      // end()): its `once` has already fired, so arming a new one would strand the entry until the
      // scope animates again. Release now; the work still lands in the next frame.
      scope.parked.push(entry);
      releaseParked(scope);
      return;
    }
    if (!scope.releaseArmed) {
      scope.releaseArmed = true;
      try {
        scope.isBlockingAnimating.once(() => {
          try {
            releaseParked(scope);
          } catch (error) {
            console.error('[frameact] releasing parked frame effects failed', error);
          }
        });
      } catch (error) {
        scope.releaseArmed = false;
        throw error;
      }
    }
    scope.parked.push(entry);
  } catch (error) {
    // Could not park (entry is not in `parked` unless the release itself failed): run it now rather
    // than leave its effect dirty forever.
    console.error('[frameact] parking a frame effect failed; running it ungated', error);
    entry.run();
  }
}

let gatingInstalled = false;

/**
 * @internal Install the gate into the frame drains. Called by the first `begin()` of any scope — before
 * that no scope can block, so the drains' defaults (never gating) are exact — and by the store gate when
 * it loads (its sampling must bracket every drain from then on). Idempotent.
 */
export function installGating() {
  if (gatingInstalled) return;
  gatingInstalled = true;
  drainHooks.isGating = isAnyScopeBlocking;
  drainHooks.openSample = openGateSample;
  drainHooks.closeSample = closeGateSample;
  drainHooks.blockingScopeFor = blockingScopeFor;
  drainHooks.park = park;
}

// ---- schedulers that wait for animations (were in core/frame.ts) ----------------------------

/** Runs when the browser is idle and nothing in the node's scope chain is animating. */
export const idle: Schedule = (run, node) => onFullyIdle(run, effectScopeOf(node));

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
    const animating = firstAnimatingScope(effectScopeOf(node), blocking);
    if (animating === null) schedule(run, node);
    else (blocking ? animating.isBlockingAnimating : animating.isAnimating).once(() => gated(run, node));
  };
  if (isDomWritingSchedule(schedule)) markWritesDom(gated);
  if (isDrainGuardedSchedule(schedule)) markDrainGuarded(gated);
  markStoreGated(gated); // an explicit opt-in into waiting for animations: store-caused runs park here too
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
