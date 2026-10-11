// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
import { DEV } from '../env';
import { createComputation, isFunction, read, write } from './core';
import { SCOPE } from './symbols';
import type {
  ComputedSignalOptions,
  MaybeSignal,
  ReadSignal,
  SignalOptions,
  WriteSignal,
} from './types';

/**
 * Wraps the given value into a signal. The signal will return the current value when invoked
 * `fn()`, and provide a simple write API via `set()`. The value can now be observed
 * when used inside other computations created with `computed` and `effect`.
 *
 * @see {@link https://github.com/maverick-js/signals#signal}
 */
export function signal<T>(initialValue: T, options?: SignalOptions<T>): WriteSignal<T> {
  const node = createComputation(initialValue, null, options),
    signal = read.bind(node) as WriteSignal<T>;

  if (DEV) signal.node = node;
  (signal as any)[SCOPE] = true;
  signal.set = write.bind(node) as WriteSignal<T>['set'];

  return signal;
}

/**
 * Whether the given value is a readonly signal.
 *
 * @see {@link https://github.com/maverick-js/signals#isreadsignal}
 */
export function isReadSignal<T>(fn: MaybeSignal<T>): fn is ReadSignal<T> {
  return isFunction(fn) && SCOPE in fn;
}

/**
 * Creates a new signal whose value is computed and returned by the given function. The given
 * compute function is _only_ re-run when one of it's dependencies are updated. Dependencies are
 * are all signals that are read during execution.
 *
 * @see {@link https://github.com/maverick-js/signals#computed}
 */
export function computed<T, R = never>(
  compute: () => T,
  options?: ComputedSignalOptions<T, R>,
): ReadSignal<T | R> {
  const node = createComputation<T | R>(
      options?.initial as R,
      compute,
      options as ComputedSignalOptions<T | R>,
    ),
    signal = read.bind(node) as ReadSignal<T | R>;

  (signal as any)[SCOPE] = true;
  if (DEV) signal.node = node;
  return signal;
}

/**
 * Takes in the given signal and makes it read only by removing access to write operations
 * (i.e., `set()`).
 *
 * @see {@link https://github.com/maverick-js/signals#readonly}
 */
export function readonly<T>(signal: ReadSignal<T>): ReadSignal<T> {
  const readonly = (() => signal()) as ReadSignal<T>;
  (readonly as any)[SCOPE] = true;
  if (DEV) readonly.node = signal.node;
  return readonly;
}

/**
 * Whether the given value is a write signal (i.e., can produce new values via write API).
 *
 * @see {@link https://github.com/maverick-js/signals#iswritesignal}
 */
export function isWriteSignal<T>(fn: MaybeSignal<T>): fn is WriteSignal<T> {
  return isReadSignal(fn) && 'set' in fn;
}
