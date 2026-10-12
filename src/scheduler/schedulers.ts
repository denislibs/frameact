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

/**
 * The tickEnd queue (frameact, perf): ONE array reused for the life of the module —
 * `tickQueue[tickNext .. tickLen)` are the callbacks no drain has taken yet. A drain takes everything
 * pending as a batch (`tickNext = tickLen`), runs it in order, clearing each slot, and takes what was
 * queued meanwhile as the next batch; once nothing is left the indices reset to 0 and the backing
 * store is kept, so neither scheduling nor draining allocates. (Before: a fresh array per empty →
 * non-empty transition, and a Promise per transition — on a write/flushSync() loop that was two
 * allocations per write.) A re-entrant drain (a callback calling flushSync()) takes only what was
 * queued after the running batch was taken: the rest of that batch stays with its own loop.
 */
const tickQueue: (NoneToVoidFunction | undefined)[] = [];
let tickNext = 0;
let tickLen = 0;
/**
 * True while the end-of-tick microtask is booked and has not run yet. It is booked once per tick,
 * not once per empty → non-empty transition: a flushSync() in between drains the queue but leaves
 * the microtask booked, and the next onTickEnd() before it fires reuses it (it drains whatever is
 * pending by then; usually nothing).
 */
let tickBooked = false;
/** Nesting depth of flushTickEnd(): > 0 while a drain is running (a callback may call flushSync()). */
let tickDrainDepth = 0;
/** Bumped once at the start of every outermost flushTickEnd() drain that has work to do. */
let tickDrainEpoch = 0;

function flushTickEndMicrotask() {
  tickBooked = false;
  flushTickEnd();
}

export function onTickEnd(callback: NoneToVoidFunction) {
  tickQueue[tickLen++] = callback;
  // While draining, the running drain picks the new callback up: no extra microtask.
  if (!tickBooked && tickDrainDepth === 0) {
    tickBooked = true;
    Promise.resolve().then(flushTickEndMicrotask);
  }
}

/**
 * Run pending onTickEnd callbacks until none are left: callbacks queued while flushing run in this
 * same flush, so a cascade (effect → write → effect ...) completes in one drain. Used by the
 * microtask itself and by flushSync(). A re-entrant call (a callback calling flushSync()) drains
 * the callbacks queued since the running batch was taken, within the same drain epoch.
 */
export function flushTickEnd() {
  if (tickNext === tickLen) return;
  if (tickDrainDepth === 0) tickDrainEpoch++;
  tickDrainDepth++;
  let i = 0;
  let end = 0;
  try {
    while (tickNext < tickLen) {
      i = tickNext;
      end = tickLen;
      tickNext = end; // (callbacks queued from here on belong to the next batch)
      while (i < end) {
        const callback = tickQueue[i]!;
        tickQueue[i++] = undefined; // (let the callback go: the slot is reused later)
        safeExec(callback);
      }
    }
  } finally {
    // Only with a batch left over if something escaped safeExec (e.g. a throwing console.error):
    // like before, the rest of that batch is dropped — but not retained.
    if (i < end) tickQueue.fill(undefined, i, end);
    if (--tickDrainDepth === 0) {
      if (tickNext === tickLen) {
        tickNext = tickLen = 0;
        // Don't keep a burst-sized backing store alive (the array only ever grows otherwise).
        if (tickQueue.length > 4096) tickQueue.length = 0;
      } else if (!tickBooked) {
        // Callbacks queued after the escaped batch was taken: re-book the microtask that onTickEnd
        // skipped while we were draining, or the queue would stall.
        tickBooked = true;
        Promise.resolve().then(flushTickEndMicrotask);
      }
    }
  }
}

/** @internal core flushSync() loops until nothing is pending. */
export function hasPendingTickEnd() {
  return tickNext !== tickLen;
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
