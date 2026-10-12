// Actions (spec §3.5 req. 5): plain typed functions. A call made while another action runs is queued
// and runs after it (FIFO: a nested call never interleaves with its caller, so the caller's writes are
// complete when the callee reads); afterActions(cb) runs once the cascade — actions and the callbacks
// they queued — is done. A throwing (or rejecting) action is reported; the queue goes on. Actions and
// callbacks run untracked: calling one from an effect or a memo never subscribes the caller.
import { DEV } from '../env';
import { untrack } from '../core/core';

type AnyFn = (...args: any[]) => any;

/** DEV: a cascade (actions, their synchronous store walks, the after-callbacks) longer than this is reported. */
const SLOW_UPDATE_MS = 7;

/** A definition that returns a promise gives a `Promise<void>` per call (resolved once it settled, never rejected); any other returns void. */
export type Actions<D extends Record<string, AnyFn>> = {
  readonly [K in keyof D]: (...args: Parameters<D[K]>) => ReturnType<D[K]> extends PromiseLike<any> ? Promise<void> : void;
};

let running = false;
// FIFO queues: an array and a head index (a `shift()` is O(n) on a long queue); reset when drained.
const queue: (() => void)[] = [];
let queueHead = 0;
const after: (() => void)[] = [];
let afterHead = 0;
const names: string[] = [];

function report(name: string, error: unknown) {
  console.error(`[frameact/store] action "${name}" failed`, error);
}

const isThenable = (r: unknown): r is PromiseLike<unknown> =>
  r !== null && (typeof r === 'object' || typeof r === 'function') && typeof (r as PromiseLike<unknown>).then === 'function';

/**
 * Run one action untracked. A thenable result is awaited for error reporting: `done` (a queued call
 * that already handed out its promise) is called once it settled; otherwise the settled promise is returned.
 */
function runOne(name: string, fn: AnyFn, args: unknown[], done: (() => void) | undefined): Promise<void> | undefined {
  let r: unknown;
  try {
    r = untrack(() => fn(...args));
  } catch (error) {
    report(name, error);
    done?.();
    return undefined;
  }
  if (!isThenable(r)) {
    done?.();
    return undefined;
  }
  const settle = (resolve: () => void) => {
    try {
      r.then(resolve, (e) => {
        report(name, e);
        resolve();
      });
    } catch (error) {
      report(name, error); // a thenable whose `then` throws
      resolve();
    }
  };
  if (done !== undefined) {
    settle(done);
    return undefined;
  }
  return new Promise<void>(settle);
}

/** Run the queue to completion: queued actions first, then the after-callbacks; either may queue more. */
function drain() {
  running = true;
  const t0 = DEV ? performance.now() : 0;
  try {
    for (;;) {
      if (queueHead < queue.length) {
        const job = queue[queueHead];
        queue[queueHead++] = undefined as never; // (do not keep the closure alive)
        job();
      } else if (afterHead < after.length) {
        const cb = after[afterHead];
        after[afterHead++] = undefined as never;
        runAfter(cb);
      } else break;
    }
  } finally {
    queue.length = after.length = queueHead = afterHead = 0;
    running = false;
  }
  if (DEV) {
    const dt = performance.now() - t0;
    const ran = names.splice(0);
    if (dt > SLOW_UPDATE_MS) console.warn(`[frameact/store] Slow store update: ${dt.toFixed(1)} ms in ${ran.join(', ')}`);
  }
}

function runAfter(cb: () => void) {
  try {
    untrack(cb);
  } catch (error) {
    report('afterActions', error);
  }
}

/**
 * `const actions = defineActions({ openChat(id: string) { setState('currentChatId', id) } })`: the
 * types come from the definition. Each returned function queues the call and, outside a running
 * cascade, drains the queue at once (synchronously: a controlled input's handler sees the write).
 * A definition that returns a promise (an `async` function or any thenable) makes the call return a
 * `Promise<void>` that resolves once it settled and never rejects (the error was reported); a
 * definition that returns anything else returns `void`. A call made INSIDE a running cascade is queued
 * and cannot know yet what its definition will return, so it always returns such a promise (resolved
 * when the call has run and settled) — typed `void` for a sync definition, so it is simply ignored.
 * Each call allocates its rest array and the queue entry; a sync outermost call no promise.
 */
export function defineActions<D extends Record<string, AnyFn>>(defs: D): Actions<D> {
  const out: Record<string, (...args: unknown[]) => Promise<void> | undefined> = {};
  for (const name of Object.keys(defs)) {
    const fn = defs[name];
    out[name] = (...args: unknown[]) => {
      if (DEV) names.push(name);
      if (running) {
        let done!: () => void;
        const promise = new Promise<void>((resolve) => {
          done = resolve;
        });
        queue.push(() => void runOne(name, fn, args, done));
        return promise;
      }
      let result: Promise<void> | undefined;
      queue.push(() => {
        result = runOne(name, fn, args, undefined);
      });
      drain();
      return result;
    };
  }
  return out as unknown as Actions<D>;
}

/** Run `cb` after the current action cascade; outside a cascade, at once. A throwing callback is reported either way. */
export function afterActions(cb: () => void): void {
  if (running) after.push(cb);
  else runAfter(cb);
}
