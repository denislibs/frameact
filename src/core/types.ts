// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
import type { SCOPE } from './symbols';

export interface Computation<T = any> extends Scope {
  id?: string | undefined;

  /** @internal */
  _effect: boolean;
  /** @internal F_INIT | F_COMPUTING | F_MISSED | F_REENTERED | F_UNSURE | F_THREW | F_ERRORED (core.ts) */
  _flags: number;
  /** @internal write epoch of this node's last value-changing write (0 = never) */
  _writtenAt: number;

  /** @internal */
  _value: T;
  /** @internal first link to a dependency (P4: doubly-linked, alien-signals style) */
  _deps: Link | null;
  /** @internal last dep link confirmed in the current compute (the old links after it are stale) */
  _depsTail: Link | null;
  /** @internal first link from a subscriber */
  _subs: Link | null;
  /** @internal last link from a subscriber (new subscribers are appended) */
  _subsTail: Link | null;

  /** @internal */
  _compute: (() => T) | null;
  /** @internal */
  _changed: (prev: T, next: T) => boolean;
  /** read */
  call(this: Computation<T>): T;
}

/**
 * @internal One dependency edge (P4): a node in both the dep's subscriber list (prevSub/nextSub)
 * and the subscriber's dep list (prevDep/nextDep). `version`: the compute that last read it.
 */
export interface Link {
  version: number;
  dep: Computation;
  sub: Computation;
  prevDep: Link | null;
  nextDep: Link | null;
  prevSub: Link | null;
  nextSub: Link | null;
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
  /** @internal last owned child: children form an intrusive doubly-linked list (P3a) */
  _lastChild: Scope | null;
  /** @internal previous sibling under the same owner */
  _prevSibling: Scope | null;
  /** @internal next sibling under the same owner */
  _nextSibling: Scope | null;
  /** @internal */
  _context: ContextRecord | null;
  /** @internal */
  _handlers: ErrorHandler<any>[] | null;
  /** @internal */
  _disposal: Disposable | Disposable[] | null;
  /**
   * @internal map.ts: the memo of the mapArray whose rows this scope owns. Set on map scopes only
   * (never initialised elsewhere: every other node keeps its hidden class). A row's run pulls it
   * while it is not CLEAN (effects.ts ancestor rule), top-down at this scope's position among the
   * memo ancestors and only after the whole chain was checked for effects: a row whose item or id
   * is gone is disposed by that pull instead of running stale (zombie rows). Unlike a memo
   * ancestor's pull it also WRITES the item/index nodes of the kept rows, so the run walks its
   * chain again afterwards.
   */
  _mapMemo?: Computation;
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
