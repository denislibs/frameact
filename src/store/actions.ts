// Actions (spec §3.5 req. 5): plain typed functions. A call made while another action runs is queued
// and runs after it (FIFO: a nested call never interleaves with its caller, so the caller's writes are
// complete when the callee reads); afterActions(cb) runs once the cascade — actions and the callbacks
// they queued — is done. A throwing (or rejecting) action is reported; the queue goes on.
import { DEV } from '../env';

type AnyFn = (...args: any[]) => any;

/** DEV: a cascade (actions, their synchronous store walks, the after-callbacks) longer than this is reported. */
const SLOW_UPDATE_MS = 7;

/** A sync definition returns void; an `async` one a `Promise<void>` that resolves after it settled and never rejects. */
export type Actions<D extends Record<string, AnyFn>> = {
  readonly [K in keyof D]: (...args: Parameters<D[K]>) => ReturnType<D[K]> extends PromiseLike<any> ? Promise<void> : void;
};

let running = false;
const queue: (() => void)[] = [];
const names: string[] = [];
const after: (() => void)[] = [];

function report(name: string, error: unknown) {
  console.error(`[frameact/store] action "${name}" failed`, error);
}

/** Run one action; `done` (async definitions) is called once it settled, success or failure. */
function runOne(name: string, fn: AnyFn, args: unknown[], done: (() => void) | undefined) {
  let r: unknown;
  try {
    r = fn(...args);
  } catch (error) {
    report(name, error);
    done?.();
    return;
  }
  if (r && typeof (r as Promise<unknown>).then === 'function') {
    (r as Promise<unknown>).then(
      () => done?.(),
      (e) => {
        report(name, e);
        done?.();
      },
    );
  } else done?.();
}

/** Run the queue to completion: queued actions first, then the after-callbacks; either may queue more. */
function drain() {
  running = true;
  const t0 = DEV ? performance.now() : 0;
  try {
    for (;;) {
      if (queue.length !== 0) {
        queue.shift()!();
      } else if (after.length !== 0) {
        const cb = after.shift()!;
        try {
          cb();
        } catch (error) {
          report('afterActions', error);
        }
      } else break;
    }
  } finally {
    running = false;
  }
  if (DEV) {
    const dt = performance.now() - t0;
    const ran = names.splice(0);
    if (dt > SLOW_UPDATE_MS) console.warn(`[frameact/store] Slow store update: ${dt.toFixed(1)} ms in ${ran.join(', ')}`);
  }
}

/**
 * `const actions = defineActions({ openChat(id: string) { setState('currentChatId', id) } })`: the
 * types come from the definition. Each returned function queues the call and, outside a running
 * cascade, drains the queue at once (synchronously: a controlled input's handler sees the write).
 * An `async` definition returns a `Promise<void>` per call (resolved once the action settled, never
 * rejected — the error was reported); a sync definition returns `void` and allocates nothing. A sync
 * function that returns a promise is awaited for error reporting but returns `void`: declare it `async`.
 */
export function defineActions<D extends Record<string, AnyFn>>(defs: D): Actions<D> {
  const out: Record<string, (...args: unknown[]) => Promise<void> | undefined> = {};
  for (const name of Object.keys(defs)) {
    const fn = defs[name];
    const isAsync = fn.constructor.name === 'AsyncFunction';
    out[name] = (...args: unknown[]) => {
      let done: (() => void) | undefined;
      let promise: Promise<void> | undefined;
      if (isAsync) {
        promise = new Promise<void>((resolve) => {
          done = resolve;
        });
      }
      queue.push(() => runOne(name, fn, args, done));
      if (DEV) names.push(name);
      if (!running) drain();
      return promise;
    };
  }
  return out as unknown as Actions<D>;
}

/** Run `cb` after the current action cascade; outside a cascade, at once. */
export function afterActions(cb: () => void): void {
  if (running) after.push(cb);
  else cb();
}
