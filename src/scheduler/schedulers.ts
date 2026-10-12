// Adapted from teact (MIT, © 2022 Alexander Zinchuk) — https://github.com/Ajaxy/teact src/util/schedulers.ts

export type NoneToVoidFunction = () => void;
export type AnyToVoidFunction = (...args: any[]) => void;
export type Scheduler = (cb: NoneToVoidFunction) => void;

/** Runs one scheduled callback; a throw is reported, never allowed to drop the rest of its batch. */
function safeExec(cb: NoneToVoidFunction) {
  try {
    cb();
  } catch (error) {
    console.error('[frameact] scheduled callback failed', error);
  }
}

export function throttle<F extends AnyToVoidFunction>(fn: F, ms: number, shouldRunFirst = true) {
  let interval: ReturnType<typeof setInterval> | undefined;
  let isPending: boolean;
  let args: Parameters<F>;

  return (..._args: Parameters<F>) => {
    isPending = true;
    args = _args;

    if (!interval) {
      if (shouldRunFirst) {
        isPending = false;
        fn(...args);
      }

      interval = setInterval(() => {
        if (!isPending) {
          clearInterval(interval!);
          interval = undefined;
          return;
        }

        isPending = false;
        fn(...args);
      }, ms);
    }
  };
}

/**
 * Original frameact implementation (written from the behaviour description, not from any source).
 *
 * `debounce(fn, ms, shouldRunFirst, shouldRunLast)`: a wrapper whose calls open a wait of `ms`;
 * every call during the wait restarts it with the latest arguments.
 * - `shouldRunFirst` (default true): the call that OPENS a wait runs `fn` at once (leading edge).
 * - `shouldRunLast` (default true): when the wait ends, `fn` runs once more with the last arguments
 *   (trailing edge) — unless the only call of the wait was the leading one that already ran.
 * A SINGLE call with the defaults runs `fn` once (the leading edge; the trailing one is owed only when
 * a second call lands inside the wait) — lodash's leading + trailing semantics. This differs from teact,
 * whose default runs a single call twice (leading, then trailing). When porting, a call site that
 * relied on the run after the quiet period alone should pass `shouldRunFirst = false`.
 * `debounce(fn, 1000, true, false)` is "fire now, then ignore repeats for a second" (InfiniteScroll's
 * load-more); `debounce(fn, 300, false)` is the classic "run once the input has been quiet for 300 ms".
 */
export function debounce<F extends AnyToVoidFunction>(fn: F, ms: number, shouldRunFirst = true, shouldRunLast = true) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let pendingArgs: Parameters<F> | undefined; // set when a trailing call is owed

  return (...args: Parameters<F>) => {
    if (timeout === undefined) {
      // Opening a wait: the leading call runs now; the trailing call is owed only without it.
      if (shouldRunFirst) fn(...args);
      else pendingArgs = args;
    } else {
      // Inside a wait: restart it; the trailing call (if any) uses these, the latest, arguments.
      clearTimeout(timeout);
      pendingArgs = args;
    }
    timeout = setTimeout(() => {
      timeout = undefined;
      const trailing = pendingArgs;
      pendingArgs = undefined;
      if (shouldRunLast && trailing !== undefined) fn(...trailing);
    }, ms);
  };
}

export function throttleWithTickEnd<F extends AnyToVoidFunction>(fn: F) {
  return throttleWith(onTickEnd, fn);
}

export function throttleWith<F extends AnyToVoidFunction>(schedulerFn: Scheduler, fn: F) {
  let waiting = false;
  let args: Parameters<F>;

  return (..._args: Parameters<F>) => {
    args = _args;

    if (!waiting) {
      waiting = true;

      schedulerFn(() => {
        waiting = false;
        fn(...args);
      });
    }
  };
}

const FAST_RAF_TIMEOUT_FALLBACK_MS = 35; // < 30 FPS

let fastRafCallbacks: Set<NoneToVoidFunction> | undefined;
let fastRafFallbackCallbacks: Set<NoneToVoidFunction> | undefined;
let fastRafFallbackTimeout: ReturnType<typeof setTimeout> | undefined;

// May result in an immediate execution if called from another RAF callback which was scheduled
// (and therefore is executed) earlier than RAF callback scheduled by `fastRaf`
export function fastRaf(callback: NoneToVoidFunction, withTimeoutFallback = false) {
  if (!fastRafCallbacks) {
    fastRafCallbacks = new Set([callback]);

    requestAnimationFrame(() => {
      const currentCallbacks = fastRafCallbacks!;

      fastRafCallbacks = undefined;
      fastRafFallbackCallbacks = undefined;

      if (fastRafFallbackTimeout) {
        clearTimeout(fastRafFallbackTimeout);
        fastRafFallbackTimeout = undefined;
      }

      currentCallbacks.forEach(safeExec);
    });
  } else {
    fastRafCallbacks.add(callback);
  }

  if (withTimeoutFallback) {
    if (!fastRafFallbackCallbacks) {
      fastRafFallbackCallbacks = new Set([callback]);
    } else {
      fastRafFallbackCallbacks.add(callback);
    }

    if (!fastRafFallbackTimeout) {
      fastRafFallbackTimeout = setTimeout(() => {
        const currentTimeoutCallbacks = fastRafFallbackCallbacks!;

        if (fastRafCallbacks) {
          currentTimeoutCallbacks.forEach(fastRafCallbacks.delete, fastRafCallbacks);
        }
        fastRafFallbackCallbacks = undefined;

        if (fastRafFallbackTimeout) {
          clearTimeout(fastRafFallbackTimeout);
          fastRafFallbackTimeout = undefined;
        }

        currentTimeoutCallbacks.forEach(safeExec);
      }, FAST_RAF_TIMEOUT_FALLBACK_MS);
    }
  }
}

let onTickEndCallbacks: NoneToVoidFunction[] | undefined;
/** Nesting depth of flushTickEnd(): > 0 while a drain is running (a callback may call flushSync()). */
let tickDrainDepth = 0;
/** Bumped once at the start of every outermost flushTickEnd() drain that has work to do. */
let tickDrainEpoch = 0;

export function onTickEnd(callback: NoneToVoidFunction) {
  if (!onTickEndCallbacks) {
    onTickEndCallbacks = [callback];
    // While draining, the running drain picks the new callback up: no extra microtask.
    if (tickDrainDepth === 0) Promise.resolve().then(flushTickEnd);
  } else {
    onTickEndCallbacks.push(callback);
  }
}

/**
 * Run pending onTickEnd callbacks until none are left: callbacks queued while flushing run in this
 * same flush, so a cascade (effect → write → effect ...) completes in one drain. Used by the
 * microtask itself and by flushSync(). A re-entrant call (a callback calling flushSync()) drains
 * the pending callbacks too, within the same drain epoch.
 */
export function flushTickEnd() {
  if (!onTickEndCallbacks) return;
  if (tickDrainDepth === 0) tickDrainEpoch++;
  tickDrainDepth++;
  try {
    while (onTickEndCallbacks) {
      const currentCallbacks = onTickEndCallbacks;
      onTickEndCallbacks = undefined;
      for (let i = 0; i < currentCallbacks.length; i++) safeExec(currentCallbacks[i]);
    }
  } finally {
    // Only reached with work left if something escaped safeExec (e.g. a throwing console.error):
    // re-book the microtask that onTickEnd skipped while we were draining, or the queue would stall.
    if (--tickDrainDepth === 0 && onTickEndCallbacks) Promise.resolve().then(flushTickEnd);
  }
}

/** @internal core flushSync() loops until nothing is pending. */
export function hasPendingTickEnd() {
  return onTickEndCallbacks !== undefined;
}

/** @internal The epoch of the current (or, outside a drain, the last) flushTickEnd() drain. */
export function getTickDrainEpoch() {
  return tickDrainEpoch;
}

/** @internal True while a flushTickEnd() drain is running. */
export function isTickDraining() {
  return tickDrainDepth > 0;
}

const IDLE_TIMEOUT = 500;

let onIdleCallbacks: NoneToVoidFunction[] | undefined;

export function onIdle(callback: NoneToVoidFunction) {
  if (typeof requestIdleCallback !== 'function') {
    onTickEnd(callback);
    return;
  }

  if (!onIdleCallbacks) {
    onIdleCallbacks = [callback];

    requestIdleCallback((deadline) => {
      const currentCallbacks = onIdleCallbacks!;
      onIdleCallbacks = undefined;

      while (currentCallbacks.length) {
        safeExec(currentCallbacks.shift()!);

        if (!deadline.timeRemaining()) break;
      }

      if (currentCallbacks.length) {
        if (onIdleCallbacks) {
          // Prepend the remaining callbacks if the next pass is already planned
          onIdleCallbacks = currentCallbacks.concat(onIdleCallbacks);
        } else {
          currentCallbacks.forEach(onIdle);
        }
      }
    }, { timeout: IDLE_TIMEOUT });
  } else {
    onIdleCallbacks.push(callback);
  }
}
