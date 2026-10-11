// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
import { DEV } from '../env';
import { SCOPE } from './symbols';
import type {
  Callable,
  Computation,
  ComputedSignalOptions,
  Dispose,
  Link,
  MaybeDisposable,
  Scope,
} from './types';

let currentScope: Scope | null = null,
  currentObserver: Computation | null = null,
  /** write epoch when the current observer's compute started (new-link missed-wake check) */
  currentStartEpoch = 0,
  /** the current compute's id: a link's `version` dedupes repeated non-adjacent reads of one dep */
  currentCycle = 0,
  defaultContext = {};

/** source of compute ids (currentCycle); every update() takes a fresh one */
let cycle = 0;

const NOOP = () => {};

/**
 * P6 (frameact): per-node flags packed into `_flags` (were three boolean fields).
 * F_INIT: the node has a value from a successful compute (survives errors and re-runs).
 * F_COMPUTING / F_MISSED: per-run (update() sets F_COMPUTING and clears F_MISSED on entry and
 * clears both on exit) — true while update() runs the compute / a signal write landed meanwhile.
 * The F_MISSED clear on entry is only a safety net; the clear on exit (update()'s `finally`, after
 * reading it) is the one that keeps the latch from leaking into the next run. They are not
 * duplicates: do not remove either.
 */
export const F_INIT = 1,
  F_COMPUTING = 2,
  F_MISSED = 4;

// For more information about this graph tracking scheme see Reactively:
// https://github.com/modderme123/reactively/blob/main/packages/core/src/core.ts#L21
export const STATE_CLEAN = 0,
  STATE_CHECK = 1,
  STATE_DIRTY = 2,
  STATE_DISPOSED = 3;

/**
 * Patch 1b (frameact): bumped by every value-changing *signal* write (write(); computed results
 * are written inline by update() and never stamped);
 * the written node records it in `_writtenAt`. link() compares a dep it links for the first time
 * in a pass against the epoch at compute start: a write to it earlier in this compute happened
 * while the node was not yet subscribed, so notify() could not latch it.
 * Computed result writes are not stamped: they are lazy pulls the reader reads fresh (stamping
 * them costs an extra recompute whenever a stale memo is first read in a pass — a glitch).
 */
let writeEpoch = 0;

let effectScheduler: (node: Computation) => void = () => {};
let effectDisposeHook: (node: Computation) => void = () => {};

/** effects.ts installs the function that schedules a dirty effect (called once per CLEAN→dirty transition). */
export function setEffectScheduler(fn: (node: Computation) => void) {
  effectScheduler = fn;
}
/** effects.ts installs apply-cleanup handling for disposed effect nodes. */
export function setEffectDisposeHook(fn: (node: Computation) => void) {
  effectDisposeHook = fn;
}

/** DEV: true while an effect's apply half runs (it runs with no owner). */
let inEffectApply = false;

/** effects.ts flags the apply half; returns the previous value so nested applies restore it. */
export function setInEffectApply(value: boolean): boolean {
  const prev = inEffectApply;
  inEffectApply = value;
  return prev;
}

/**
 * DEV: apply runs with no owner, so onCleanup() or an owned computation created there would leak
 * (or, if owned by the effect, be torn down by a same-value recompute). Deliberate ownership via
 * scoped()/runWithOwner() sets a scope and stays allowed; plain signals and explicit roots need
 * no owner and are allowed too.
 */
export function assertApplyOwner() {
  if (DEV && inEffectApply && currentScope === null) {
    throw new Error(
      '[frameact] onCleanup()/createEffect()/createMemo() inside an effect apply has no owner. Return a cleanup function from apply instead, or use runWithOwner() deliberately.',
    );
  }
}

/**
 * Creates a computation root which is given a `dispose()` function to dispose of all inner
 * computations.
 *
 * @see {@link https://github.com/maverick-js/signals#root}
 */
export function root<T>(init: (dispose: Dispose) => T): T {
  const scope = createScope();
  return compute(scope, !init.length ? init : init.bind(null, dispose.bind(scope)), null) as T;
}

/**
 * frameact (Solid's createRoot): a root that is NOT appended to the current scope — disposing the
 * enclosing owner does not dispose it — but inherits that owner's context and error handlers.
 */
export function detachedRoot<T>(init: (dispose: Dispose) => T): T {
  const owner = currentScope;
  return untrack(() =>
    root((dispose) => {
      if (owner) {
        const scope = currentScope!;
        scope._context = owner._context;
        scope._handlers = owner._handlers;
      }
      return init(dispose);
    }),
  );
}

/**
 * Returns the current value stored inside the given compute function without triggering any
 * dependencies. Use `untrack` if you want to also disable scope tracking.
 *
 * @see {@link https://github.com/maverick-js/signals#peek}
 */
export function peek<T>(fn: () => T): T {
  return compute<T>(currentScope, fn, null);
}

/**
 * Returns the current value inside a signal whilst disabling both scope _and_ observer
 * tracking. Use `peek` if only observer tracking should be disabled.
 *
 * @see {@link https://github.com/maverick-js/signals#untrack}
 */
export function untrack<T>(fn: () => T): T {
  return compute<T>(null, fn, null);
}

/**
 * Returns the currently executing parent scope.
 *
 * @see {@link https://github.com/maverick-js/signals#getscope}
 */
export function getScope(): Scope | null {
  return currentScope;
}

/**
 * Runs the given function in the given scope so context and error handling continue to work.
 *
 * @see {@link https://github.com/maverick-js/signals#scoped}
 */
export function scoped<T>(run: () => T, scope: Scope | null): T | undefined {
  try {
    return compute<T>(scope, run, null);
  } catch (error) {
    handleError(scope, error);
    return; // TS -_-
  }
}

/**
 * Attempts to get a context value for the given key. It will start from the parent scope and
 * walk up the computation tree trying to find a context record and matching key. If no value can
 * be found `undefined` will be returned.
 *
 * @see {@link https://github.com/maverick-js/signals#getcontext}
 */
export function getContext<T>(
  key: string | symbol,
  scope: Scope | null = currentScope,
): T | undefined {
  return scope?._context![key] as T | undefined;
}

/**
 * Attempts to set a context value on the parent scope with the given key. This will be a no-op if
 * no parent is defined.
 *
 * @see {@link https://github.com/maverick-js/signals#setcontext}
 */
export function setContext<T>(key: string | symbol, value: T, scope: Scope | null = currentScope) {
  if (scope) scope._context = { ...scope._context, [key]: value };
}

/**
 * Runs the given function when an error is thrown in a child scope. If the error is thrown again
 * inside the error handler, it will trigger the next available parent scope handler.
 *
 * @see {@link https://github.com/maverick-js/signals#onerror}
 */
export function onError<T = Error>(handler: (error: T) => void): void {
  if (!currentScope) return;
  currentScope._handlers = currentScope._handlers
    ? [handler, ...currentScope._handlers]
    : [handler];
}

/**
 * Runs the given function when the parent scope computation is being disposed.
 *
 * @see {@link https://github.com/maverick-js/signals#ondispose}
 */
export function onDispose(disposable: MaybeDisposable): Dispose {
  if (DEV && disposable) assertApplyOwner();
  if (!disposable || !currentScope) return (disposable as Dispose) || NOOP;

  const node = currentScope;

  if (!node._disposal) {
    node._disposal = disposable;
  } else if (Array.isArray(node._disposal)) {
    node._disposal.push(disposable);
  } else {
    node._disposal = [node._disposal, disposable];
  }

  return function removeDispose() {
    if (node._state === STATE_DISPOSED) return;
    disposable.call(null);
    if (isFunction(node._disposal)) {
      node._disposal = null;
    } else if (Array.isArray(node._disposal)) {
      node._disposal.splice(node._disposal.indexOf(disposable), 1);
    }
  };
}

export function dispose(this: Scope, self = true) {
  if (this._state === STATE_DISPOSED) return;

  // Patch (frameact): linear. Take the whole children list first and detach each child before
  // disposing it, so it does not search-and-splice itself out of our array (O(n²) for n children).
  // Order is unchanged: children before self, in reverse creation order.
  const children = this._children;
  if (children) {
    this._children = null;
    if (Array.isArray(children)) {
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        child[SCOPE] = null;
        dispose.call(child);
      }
    } else {
      children[SCOPE] = null;
      dispose.call(children);
    }
  }

  if (self) {
    const parent = this[SCOPE];

    if (parent) {
      if (Array.isArray(parent._children)) {
        parent._children.splice(parent._children.indexOf(this), 1);
      } else {
        parent._children = null;
      }
    }

    disposeNode(this as Computation);
  }
}

/**
 * frameact: dispose many children of `parent` at once (list rows), then rebuild its children list
 * in one pass — instead of every child searching-and-splicing itself out of the array (O(n²)).
 * Each child is disposed like `dispose()` would (its own children first); the given order is kept.
 */
export function disposeChildren(parent: Scope, children: readonly Scope[]) {
  if (children.length === 0) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child[SCOPE] === parent) child[SCOPE] = null;
    dispose.call(child);
  }
  const list = parent._children;
  if (Array.isArray(list)) {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i]._state !== STATE_DISPOSED) list[n++] = list[i];
    }
    list.length = n;
  } else if (list && list._state === STATE_DISPOSED) {
    parent._children = null;
  }
}

function disposeNode(node: Computation) {
  node._state = STATE_DISPOSED;
  if (node._disposal) emptyDisposal(node);
  if (node._effect) effectDisposeHook(node);
  if (node._deps) unlinkDeps(node._deps); // (plain scopes have no link fields)
  node[SCOPE] = null;
  node._deps = null;
  node._depsTail = null;
  // Subscribers keep their links to us: a disposed dep is skipped by updateCheck, never notifies,
  // and is dropped from their dep lists on their next run (unlinkDeps skips its abandoned list).
  node._subs = null;
  node._subsTail = null;
  node._children = null;
  node._context = defaultContext;
  node._handlers = null;
}

function emptyDisposal(scope: Computation) {
  // Patch (frameact): every disposal runs in isolation and never throws out of here. A throw
  // escaping dispose() would abort the sibling dispose loop, skip effectDisposeHook (leaking
  // apply-cleanups) and, from cleanup() inside update(), unlink the recomputing node from all of
  // its sources (spec §2: errors never stop the frame).
  const disposal = scope._disposal!;
  scope._disposal = null;
  if (Array.isArray(disposal)) {
    for (let i = disposal.length - 1; i >= 0; i--) runDisposal(scope, disposal[i]);
  } else {
    runDisposal(scope, disposal);
  }
}

function runDisposal(scope: Computation, callable: Callable) {
  try {
    callable.call(callable);
  } catch (error) {
    try {
      handleError(scope, error);
    } catch (unhandled) {
      console.error(`[frameact] onCleanup failed${DEV && scope.id ? ` in \`${scope.id}\`` : ''}`, unhandled);
    }
  }
}

export function compute<Result>(
  scope: Scope | null,
  compute: Callable<Scope | null, Result>,
  observer: Computation | null,
): Result {
  const prevScope = currentScope,
    prevObserver = currentObserver;

  currentScope = scope;
  currentObserver = observer;

  try {
    return compute.call(scope);
  } finally {
    currentScope = prevScope;
    currentObserver = prevObserver;
  }
}

export function handleError(scope: Scope | null, error: unknown) {
  if (!scope || !scope._handlers) throw error;

  let i = 0,
    len = scope._handlers.length,
    currentError = error;

  for (i = 0; i < len; i++) {
    try {
      scope._handlers[i](currentError);
      break; // error was handled.
    } catch (error) {
      currentError = error;
    }
  }

  // Error was not handled.
  if (i === len) throw currentError;
}

export function read(this: Computation): any {
  if (this._state === STATE_DISPOSED) return this._value;

  // P4: subscribe at read time, before pulling — a write that invalidates us later in the
  // reader's compute reaches the reader's latch through this link.
  if (currentObserver !== null && !this._effect) link(this, currentObserver);

  if (this._compute !== null && this._state !== STATE_CLEAN) updateCheck(this);

  return this._value;
}

export function write(this: Computation, newValue: any): any {
  const value = isFunction(newValue) ? newValue(this._value) : newValue;

  if (this._changed(this._value, value)) {
    this._value = value;
    this._writtenAt = ++writeEpoch;
    for (let l = this._subs; l !== null; l = l.nextSub) notify(l.sub, STATE_DIRTY, true);
  }

  return this._value;
}

/**
 * Patch P3a (frameact): every node initialises its full field set in one fixed order, so nodes of
 * one kind share one hidden class (the vendored version left some fields on the prototype and
 * added others later — signals, `dirty` signals, computeds and effects all ended up with
 * different shapes, making read/write/notify polymorphic). Scope fields come first.
 */
function initScope(node: Scope) {
  node[SCOPE] = null;
  node._state = STATE_CLEAN;
  node._children = null;
  node._context = defaultContext;
  node._handlers = null;
  node._disposal = null;
  node._compute = null;
}

const ScopeNode = function Scope(this: Scope) {
  initScope(this);
  if (currentScope) currentScope.append(this);
};

const ScopeProto = ScopeNode.prototype;

ScopeProto.append = function (this: Scope, child: Scope) {
  child[SCOPE] = this;

  if (!this._children) {
    this._children = child;
  } else if (Array.isArray(this._children)) {
    this._children.push(child);
  } else {
    this._children = [this._children, child];
  }

  child._context =
    child._context === defaultContext ? this._context : { ...this._context, ...child._context };

  if (this._handlers) {
    child._handlers = !child._handlers ? this._handlers : [...child._handlers, ...this._handlers];
  }
};

ScopeProto.dispose = function (this: Scope) {
  dispose.call(this);
};

export function createScope(): Scope {
  return new (ScopeNode as any)();
}

/**
 * @internal Initialise `node` with the complete computation field set (scope fields first), as the
 * Computation constructor does. Effects and selector nodes have their own constructors (sharing
 * the Computation prototype chain) and call this first. `owned`: append to the current scope.
 */
export function initComputationNode(
  node: Computation,
  initialValue: any,
  compute: any,
  options: ComputedSignalOptions<any, any> | undefined,
  owned: boolean,
) {
  initScope(node);
  if (owned && currentScope) currentScope.append(node);
  node._state = compute ? STATE_DIRTY : STATE_CLEAN;
  node._flags = 0;
  node._effect = false;
  node._writtenAt = 0;
  node._deps = null;
  node._depsTail = null;
  node._subs = null;
  node._subsTail = null;
  node._value = initialValue;
  node._compute = compute || null;
  node._changed = (options && options.dirty) || isNotEqual;
  if (DEV) node.id = options?.id ?? (compute ? 'computed' : 'signal');
}

const ComputeNode = function Computation(
  this: Computation,
  initialValue: any,
  compute: any,
  options?: ComputedSignalOptions<any, any>,
) {
  if (DEV && compute) assertApplyOwner();
  initComputationNode(this, initialValue, compute, options, true);
};

/** @internal the prototype every computation kind (signals, computeds, effects, selector nodes) shares */
export const computationPrototype: Computation = ComputeNode.prototype;
Object.setPrototypeOf(computationPrototype, ScopeProto);
computationPrototype.call = read;

export function createComputation<T>(
  initialValue: T,
  compute: (() => T) | null,
  options?: ComputedSignalOptions<T>,
): Computation<T> {
  return new (ComputeNode as any)(initialValue, compute, options);
}

/**
 * Patch P3b (frameact): call `fn(a, b)` with no owner and no observer — like
 * `compute(null, () => fn(a, b), null)` without allocating a closure per call (effect applies).
 */
export function callUnowned<A, B, R>(fn: (a: A, b: B) => R, a: A, b: B): R {
  const prevScope = currentScope,
    prevObserver = currentObserver;
  currentScope = null;
  currentObserver = null;
  try {
    return fn(a, b);
  } finally {
    currentScope = prevScope;
    currentObserver = prevObserver;
  }
}

export function isNotEqual(a: unknown, b: unknown) {
  return a !== b;
}

export function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

/**
 * Explicit DFS stack for updateCheck (frames: node, link, epoch, rescans). Re-entrant: each call
 * works above its base.
 */
const checkStack: any[] = [];
let checkTop = 0;
/** Re-verifications of one node's deps after writes landed during its scan, before giving up. */
const MAX_RESCANS = 4;

/**
 * P4 (frameact, alien-signals style): iterative pull, same walk as the recursive maverick
 * version. A CHECK node's deps are visited in order: a CHECK dep is descended into (explicit
 * stack instead of recursion), a DIRTY dep is recomputed (which may dirty the node); the walk of
 * a node stops as soon as it is no longer CHECK. Then it is recomputed (DIRTY) or marked CLEAN.
 * Patch 2 (frameact): a DISPOSED node is never resurrected — it is neither CHECK nor DIRTY, so it
 * is skipped as a dep and left alone as a node (also when it is disposed mid-walk).
 *
 * frameact: a signal write made while a node's deps are being verified (by a compute in the walk
 * — a dep that latched its own write, a writing memo — or a synchronous effect) can re-dirty a
 * dep already passed, and its notify() stops at the node (already CHECK): marking the node CLEAN
 * then would leave it stale with nothing to wake it. So each node remembers the write epoch its
 * scan started at; if it moved and a dep is dirty again, the deps are verified again (a latched
 * dep settles in a run or two). After MAX_RESCANS (a compute that keeps writing what it reads)
 * the node is recomputed conservatively — its compute pulls the deps, and their next writes latch
 * it (bounded per pull).
 */
export function updateCheck(node: Computation) {
  if (node._state === STATE_CHECK) {
    const base = checkTop;
    let cur = node,
      l = node._deps,
      epoch = writeEpoch,
      rescans = 0;
    try {
      for (;;) {
        if (l !== null && cur._state === STATE_CHECK) {
          const dep = l.dep;
          const ds = dep._state;
          if (ds === STATE_CHECK) {
            checkStack[checkTop++] = cur;
            checkStack[checkTop++] = l;
            checkStack[checkTop++] = epoch;
            checkStack[checkTop++] = rescans;
            cur = dep;
            l = dep._deps;
            epoch = writeEpoch;
            rescans = 0;
            continue;
          }
          if (ds === STATE_DIRTY) update(dep); // may dirty `cur`
          l = l.nextDep;
          continue;
        }
        // `cur`'s deps are verified. A write during the scan may have re-dirtied one already passed.
        if (cur._state === STATE_CHECK && epoch !== writeEpoch && hasDirtyDep(cur)) {
          if (rescans < MAX_RESCANS) {
            rescans++;
            epoch = writeEpoch;
            l = cur._deps;
            continue;
          }
          cur._state = STATE_DIRTY;
        }
        // `cur` resolved: DIRTY → recompute; CHECK with no dirty dep → CLEAN; DISPOSED stays.
        if (cur._state === STATE_DIRTY) update(cur);
        else if (cur._state === STATE_CHECK) cur._state = STATE_CLEAN;
        if (checkTop === base) return;
        rescans = checkStack[--checkTop];
        epoch = checkStack[--checkTop];
        l = (checkStack[--checkTop] as Link).nextDep;
        checkStack[checkTop] = null;
        cur = checkStack[--checkTop];
        checkStack[checkTop] = null;
      }
    } finally {
      // Normally already at `base`; after a throw, drop this call's frames.
      while (checkTop > base) checkStack[--checkTop] = null;
    }
  }
  if (node._state === STATE_DIRTY) update(node);
}

/** Whether a dep of `node` is CHECK or DIRTY (only asked after a write landed during its scan). */
function hasDirtyDep(node: Computation): boolean {
  for (let l = node._deps; l !== null; l = l.nextDep) {
    const ds = l.dep._state;
    if (ds === STATE_CHECK || ds === STATE_DIRTY) return true;
  }
  return false;
}

function cleanup(node: Computation) {
  if (node._children) dispose.call(node, false);
  if (node._disposal) emptyDisposal(node);
  node._handlers = node[SCOPE] ? node[SCOPE]._handlers : null;
}

export function update(node: Computation) {
  node._flags = (node._flags & F_INIT) | F_COMPUTING;
  let computeStarted = false;
  const prevScope = currentScope,
    prevObserver = currentObserver,
    prevStartEpoch = currentStartEpoch,
    prevCycle = currentCycle;

  try {
    cleanup(node);

    computeStarted = true;
    node._depsTail = null; // link() walks the old deps from the start
    currentScope = node;
    currentObserver = node;
    currentStartEpoch = writeEpoch;
    currentCycle = ++cycle;
    const result = node._compute!.call(node);
    currentScope = prevScope;
    currentObserver = prevObserver;
    currentStartEpoch = prevStartEpoch;
    currentCycle = prevCycle;
    purgeDeps(node);

    if (!node._effect && node._flags & F_INIT) {
      // A computed's result write: a value, never an updater (not routed through write()); not a
      // signal write either (no epoch stamp, never latched by a reader mid-compute — it is a lazy
      // pull that reader reads fresh).
      if (node._changed(node._value, result)) {
        node._value = result;
        for (let l = node._subs; l !== null; l = l.nextSub) notify(l.sub, STATE_DIRTY, false);
      }
    } else {
      node._value = result;
      node._flags |= F_INIT;
    }
  } catch (error) {
    currentScope = prevScope;
    currentObserver = prevObserver;
    currentStartEpoch = prevStartEpoch;
    currentCycle = prevCycle;
    // Effects report their own errors (effects.ts); the `initial` hint only fits computeds.
    if (DEV && !node._effect && !(node._flags & F_INIT) && typeof node._value === 'undefined') {
      console.error(
        `computed \`${node.id}\` threw error during first run, this can be fatal.` +
          '\n\nSolutions:\n\n' +
          '1. Set the `initial` option to silence this error',
        '\n2. Or, use an `effect` if the return value is not being used',
        '\n\n',
        error,
      );
    }

    // Keep the deps read before the throw. A failure before compute (in cleanup) keeps them all:
    // purging would unlink every dep and the node would never wake again.
    if (computeStarted) purgeDeps(node);
    handleError(node, error);
  } finally {
    const missed = node._flags & F_MISSED;
    node._flags &= F_INIT;
    if (node._state !== STATE_DISPOSED) {
      node._state = STATE_CLEAN;
      if (missed) {
        notify(node, STATE_DIRTY, true); // propagates to observers / schedules an effect
      }
    } else if (node._deps !== null) {
      // Disposed during its own compute: stays DISPOSED, and drops the links it made after that.
      unlinkDeps(node._deps);
      node._deps = node._depsTail = null;
    }
  }
}

/**
 * P4 (frameact, alien-signals style): track `dep` for `sub` during sub's compute. When deps are
 * read in the same order as last time the next old link is reused (no allocation, no diff);
 * otherwise a new link is inserted (O(1)) into both lists, and old links not reused by the end of
 * the compute are purged. Repeated reads of one dep in a run are deduped (adjacent: the tail; the
 * dep's last link, if it is this compute's; else a scan of this run's links — only for a dep that
 * other readers subscribed to in between, on the new-link path).
 * Patch 1b (frameact) lives here: a NEW link to a dep written after this compute started missed
 * that write (we were not subscribed yet) — latch it. Old links stay subscribed for the whole
 * compute, and new ones from the moment of the read, so later writes reach notify()'s latch.
 */
function link(dep: Computation, sub: Computation) {
  const prevDep = sub._depsTail;
  if (prevDep !== null && prevDep.dep === dep) return;
  const nextDep = prevDep !== null ? prevDep.nextDep : sub._deps;
  if (nextDep !== null && nextDep.dep === dep) {
    nextDep.version = currentCycle;
    sub._depsTail = nextDep;
    return;
  }
  const prevSub = dep._subsTail;
  if (prevSub !== null) {
    if (prevSub.version === currentCycle && prevSub.sub === sub) return;
    // A repeated read whose link is no longer the dep's last (another reader subscribed since):
    // look among the links confirmed in this run (head … depsTail) instead of adding a duplicate
    // (harmless, but a second visit in every notify() and an object kept per duplicate).
    if (prevDep !== null) {
      for (let x = sub._deps!; ; x = x.nextDep!) {
        if (x.dep === dep) return;
        if (x === prevDep) break;
      }
    }
  }
  if (dep._writtenAt > currentStartEpoch) sub._flags |= F_MISSED;
  const newLink: Link = {
    version: currentCycle,
    dep,
    sub,
    prevDep,
    nextDep,
    prevSub,
    nextSub: null,
  };
  sub._depsTail = newLink;
  dep._subsTail = newLink;
  if (nextDep !== null) nextDep.prevDep = newLink;
  if (prevDep !== null) prevDep.nextDep = newLink;
  else sub._deps = newLink;
  if (prevSub !== null) prevSub.nextSub = newLink;
  else dep._subs = newLink;
}

/** Drop the deps after `_depsTail` (not read in this compute). */
function purgeDeps(sub: Computation) {
  const tail = sub._depsTail;
  const from = tail !== null ? tail.nextDep : sub._deps;
  if (from === null) return;
  if (tail !== null) tail.nextDep = null;
  else sub._deps = null;
  unlinkDeps(from);
}

/**
 * Remove the links `from`, `from.nextDep`, … from their deps' subscriber lists. A removed link
 * keeps its own pointers: a notify() walk standing on it still reaches the links after it.
 */
function unlinkDeps(from: Link) {
  for (let l: Link | null = from; l !== null; l = l.nextDep) {
    const dep = l.dep;
    if (dep._state === STATE_DISPOSED) continue; // its subscriber list is abandoned
    const prevSub = l.prevSub,
      nextSub = l.nextSub;
    if (nextSub !== null) nextSub.prevSub = prevSub;
    else dep._subsTail = prevSub;
    if (prevSub !== null) prevSub.nextSub = nextSub;
    else dep._subs = nextSub;
  }
}

/** Explicit DFS stack for notify (continuation links). Re-entrant: each call works above its base. */
const notifyStack: (Link | null)[] = [];
let notifyTop = 0;

/**
 * P4 (frameact, alien-signals style): iterative push with the recursive version's visiting order
 * (pre-order DFS over subscriber lists): `node` gets `state`, everything below it CHECK.
 */
function notify(node: Computation, state: number, latch: boolean) {
  const base = notifyTop;
  let l: Link | null = null; // the link `node` was reached through (null: the root)
  try {
    for (;;) {
      let subs: Link | null = null;
      const flags = node._flags;
      if (flags & F_COMPUTING) {
        // Patch 1 (frameact): a write landing on a node mid-compute. A computed's result write is
        // a lazy pull this pass reads fresh — ignore it (maverick's behavior). A signal write may
        // have changed a value this pass already read: latch it; update() re-dirties the node.
        if (latch) node._flags = flags | F_MISSED;
      } else {
        const prev = node._state;
        if (prev < state) {
          // The state is set BEFORE the scheduler runs: a synchronous schedule runs the effect
          // right here, and that run must see the node dirty. Scheduled once per dirty period:
          // only on the CLEAN → dirty edge. (Effects have no subscribers.)
          node._state = state;
          if (node._effect && prev === STATE_CLEAN) effectScheduler(node);
          subs = node._subs;
        }
      }
      if (subs !== null) {
        if (l !== null && l.nextSub !== null) notifyStack[notifyTop++] = l.nextSub;
        l = subs;
      } else if (l !== null && l.nextSub !== null) {
        l = l.nextSub;
      } else if (notifyTop > base) {
        l = notifyStack[--notifyTop];
        notifyStack[notifyTop] = null;
      } else {
        return;
      }
      node = l!.sub;
      state = STATE_CHECK;
    }
  } finally {
    // Normally already at `base`; after a throwing scheduler, drop this call's frames.
    while (notifyTop > base) notifyStack[--notifyTop] = null;
  }
}
