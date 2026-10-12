// Derived accessors over a source's history (plan 6, client-readiness kit): teact's `usePrevious`,
// `useCurrentOrPrev` and `useFrozenProps` as memos. They observe the source when they are READ:
// a memo is pulled lazily, so a value nobody read between two changes is not a "previous" value.
// Read them from an effect or the JSX (every frame) and they see each change.
import { createMemo, type Accessor } from '../index';

export interface PreviousOptions {
  /** `undefined` does not count as a change: the previous value survives a gap (teact `shouldSkipUndefined`). */
  skipUndefined?: boolean;
}

/**
 * The value `source` had before its current one (`undefined` until the first change). Values are
 * compared with `Object.is`; an unchanged value is not a step.
 */
export function previous<T>(source: Accessor<T>, options?: PreviousOptions): Accessor<T | undefined> {
  const skipUndefined = options?.skipUndefined === true;
  let has = false;
  let last: T | undefined;
  let prev: T | undefined;
  return createMemo(() => {
    const v = source();
    if (has && !Object.is(v, last)) {
      if (!(skipUndefined && v === undefined)) prev = last;
    }
    if (!(skipUndefined && v === undefined) || !has) {
      last = v;
      has = true;
    }
    return prev;
  });
}

export interface CurrentOrPrevOptions extends PreviousOptions {
  /** Always the current value (teact `shouldForceCurrent`): useful when the choice is itself reactive. */
  forceCurrent?: Accessor<boolean>;
}

/**
 * `source()` while it is not `null`/`undefined`, else the last non-empty value — what a closing
 * panel shows while its data is already gone (teact `useCurrentOrPrev`). With `skipUndefined: false`
 * `undefined` is a step like any other and the value shown is the one just before it (teact's
 * default, one step of memory); the default here is `true`.
 */
export function currentOrPrev<T>(source: Accessor<T>, options?: CurrentOrPrevOptions): Accessor<T | undefined> {
  const skipUndefined = options?.skipUndefined ?? true;
  const stepBack = skipUndefined ? undefined : previous(source);
  const force = options?.forceCurrent;
  let lastPresent: T | undefined;
  return createMemo(() => {
    const v = source();
    const present = v !== null && v !== undefined;
    if (present) lastPresent = v;
    const before = stepBack?.(); // read on every pass: a memo is lazy, and `previous` must see each value to know the steps
    if (force?.() || present) return v;
    return stepBack ? before : lastPresent;
  });
}

/**
 * `source()` while `frozen()` is false; while it is true, the value seen just before the freeze
 * (teact `useFrozenProps`). `alwaysFresh` names keys of an object value that keep updating during
 * the freeze (the result is then a fresh object per change of those keys).
 */
export function frozenWhile<T>(source: Accessor<T>, frozen: Accessor<boolean>, alwaysFresh?: readonly (keyof T & string)[]): Accessor<T> {
  let held: T;
  let holding = false;
  // The source as of the last pass that was not frozen: when the freeze and a change of the source
  // arrive in one write (a modal closes and its data vanishes together), the first frozen pass
  // already sees the new value, but the one to hold is the value from before that write.
  let lastUnfrozen: T;
  let hasUnfrozen = false;
  return createMemo(() => {
    const isFrozen = frozen();
    if (!isFrozen) {
      holding = false;
      hasUnfrozen = true;
      return (lastUnfrozen = source());
    }
    if (!holding) {
      held = hasUnfrozen ? lastUnfrozen : source();
      holding = true;
    }
    if (!alwaysFresh?.length) return held;
    const current = source();
    const out = { ...(held as object) } as T;
    for (const key of alwaysFresh) out[key] = current[key];
    return out;
  });
}
