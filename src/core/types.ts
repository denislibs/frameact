// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
import type { SCOPE } from './symbols';

export interface Computation<T = any> extends Scope {
  id?: string | undefined;

  /** @internal */
  _effect: boolean;
  /** @internal F_INIT | F_COMPUTING | F_MISSED (core.ts) */
  _flags: number;
  /** @internal write epoch of this node's last value-changing write (0 = never) */
  _writtenAt: number;

  /** @internal */
  _value: T;
  /** @internal */
  _sources: Computation[] | null;
  /** @internal */
  _observers: Computation[] | null;

  /** @internal */
  _compute: (() => T) | null;
  /** @internal */
  _changed: (prev: T, next: T) => boolean;
  /** read */
  call(this: Computation<T>): T;
}

export interface ReadSignal<T> {
  (): T;
  /** only available during dev. */
  node?: Computation;
}

export interface SignalOptions<T> {
  id?: string;
  dirty?: (prev: T, next: T) => boolean;
}

export interface ComputedSignalOptions<T, R = never> extends SignalOptions<T> {
  initial?: R;
}

export type InferSignalValue<T> = T extends ReadSignal<infer R> ? R : T;

export interface WriteSignal<T> extends ReadSignal<T> {
  /** only available during dev. */
  node?: Computation;
  set: (value: T | NextValue<T>) => T;
}

export interface NextValue<T> {
  (prevValue: T): T;
}

export interface Scope {
  [SCOPE]: Scope | null;
  /** @internal */
  _state: number;
  /** @internal */
  _compute: unknown;
  /** @internal */
  _children: Scope | Scope[] | null;
  /** @internal */
  _context: ContextRecord | null;
  /** @internal */
  _handlers: ErrorHandler<any>[] | null;
  /** @internal */
  _disposal: Disposable | Disposable[] | null;
  append(scope: Scope): void;
  dispose(): void;
}

export interface Dispose {
  (): void;
}

export interface Disposable extends Callable {}

export interface Callable<This = unknown, Return = void> {
  call($this: This): Return;
}

export type Maybe<T> = T | void | null | undefined | false;
export type MaybeFunction = Maybe<(...args: any) => any>;
export type MaybeDisposable = Maybe<Disposable>;
export type MaybeSignal<T> = MaybeFunction | ReadSignal<T>;
export type ContextRecord = Record<string | symbol, unknown>;

export interface ErrorHandler<T = Error> {
  (error: T): void;
}
