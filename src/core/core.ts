// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
import { DEV } from '../env';
import { SCOPE } from './symbols';
import type {
  Callable,
  Computation,
  ComputedSignalOptions,
  Dispose,
  MaybeDisposable,
  Scope,
} from './types';

let currentScope: Scope | null = null,
  currentObserver: Computation | null = null,
  currentObservers: Computation[] | null = null,
  currentObserversIndex = 0,
  defaultContext = {};

const NOOP = () => {};

// For more information about this graph tracking scheme see Reactively:
// https://github.com/modderme123/reactively/blob/main/packages/core/src/core.ts#L21
export const STATE_CLEAN = 0,
  STATE_CHECK = 1,
  STATE_DIRTY = 2,
  STATE_DISPOSED = 3;

/** >0 while update() writes a computed's result (a lazy pull the computing reader reads fresh). */
let computedWriteDepth = 0;

/**
 * Patch 1b (frameact): bumped by every value-changing *signal* write (computedWriteDepth === 0);
 * the written node records it in `_writtenAt`. update() compares the sources it links for the
 * first time in a pass against the epoch at compute start: a write to them during the compute
 * happened while the node was not yet their observer, so notify() could not latch it.
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
  if (node._sources) removeSourceObservers(node, 0);
  node[SCOPE] = null;
  node._sources = null;
  node._observers = null;
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

  if (currentObserver && !this._effect) {
    if (
      !currentObservers &&
      currentObserver._sources &&
      currentObserver._sources[currentObserversIndex] == this
    ) {
      currentObserversIndex++;
    } else if (!currentObservers) currentObservers = [this];
    else currentObservers.push(this);
  }

  if (this._compute) updateCheck(this);

  return this._value;
}

export function write(this: Computation, newValue: any): any {
  const value = isFunction(newValue) ? newValue(this._value) : newValue;

  if (this._changed(this._value, value)) {
    this._value = value;
    if (computedWriteDepth === 0) this._writtenAt = ++writeEpoch;
    if (this._observers) {
      for (let i = 0; i < this._observers.length; i++) {
        notify(this._observers[i], STATE_DIRTY);
      }
    }
  }

  return this._value;
}

const ScopeNode = function Scope(this: Scope) {
  this[SCOPE] = null;
  this._children = null;
  if (currentScope) currentScope.append(this);
};

const ScopeProto = ScopeNode.prototype;
ScopeProto._context = defaultContext;
ScopeProto._handlers = null;
ScopeProto._compute = null;
ScopeProto._disposal = null;

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

const ComputeNode = function Computation(
  this: Computation,
  initialValue: any,
  compute: any,
  options?: ComputedSignalOptions<any, any>,
) {
  if (DEV && compute) assertApplyOwner();
  ScopeNode.call(this);

  this._state = compute ? STATE_DIRTY : STATE_CLEAN;
  this._init = false;
  this._effect = false;
  this._computing = false;
  this._missedWake = false;
  this._writtenAt = 0;
  this._sources = null;
  this._observers = null;
  this._value = initialValue;

  if (DEV) this.id = options?.id ?? (this._compute ? 'computed' : 'signal');
  if (compute) this._compute = compute;
  if (options && options.dirty) this._changed = options.dirty;
};

const ComputeProto: Computation = ComputeNode.prototype;
Object.setPrototypeOf(ComputeProto, ScopeProto);
ComputeProto._changed = isNotEqual;
ComputeProto.call = read;

export function createComputation<T>(
  initialValue: T,
  compute: (() => T) | null,
  options?: ComputedSignalOptions<T>,
): Computation<T> {
  return new (ComputeNode as any)(initialValue, compute, options);
}

export function isNotEqual(a: unknown, b: unknown) {
  return a !== b;
}

export function isFunction(value: unknown): value is Function {
  return typeof value === 'function';
}

export function updateCheck(node: Computation) {
  // Patch 2 (frameact): a disposed node is never resurrected by a stale observer.
  if (node._state === STATE_DISPOSED) return;

  if (node._state === STATE_CHECK) {
    for (let i = 0; i < node._sources!.length; i++) {
      updateCheck(node._sources![i]);
      if ((node._state as number) === STATE_DIRTY) {
        // Stop the loop here so we won't trigger updates on other parents unnecessarily
        // If our computation changes to no longer use some sources, we don't
        // want to update() a source we used last time, but now don't use.
        break;
      }
    }
  }

  if (node._state === STATE_DIRTY) update(node);
  else if (node._state !== STATE_DISPOSED) node._state = STATE_CLEAN;
}

function cleanup(node: Computation) {
  if (node._children) dispose.call(node, false);
  if (node._disposal) emptyDisposal(node);
  node._handlers = node[SCOPE] ? node[SCOPE]._handlers : null;
}

export function update(node: Computation) {
  let prevObservers = currentObservers,
    prevObserversIndex = currentObserversIndex;

  currentObservers = null as Computation[] | null;
  currentObserversIndex = 0;
  node._computing = true;
  node._missedWake = false;
  let computeStarted = false;
  const startEpoch = writeEpoch;

  try {
    cleanup(node);

    computeStarted = true;
    const result = compute(node, node._compute!, node);

    const linkFrom = currentObserversIndex;
    const linksNew = currentObservers !== null;
    updateObservers(node);
    if (linksNew) checkNewSources(node, linkFrom, startEpoch);

    if (!node._effect && node._init) {
      computedWriteDepth++;
      try {
        write.call(node, result);
      } finally {
        computedWriteDepth--;
      }
    } else {
      node._value = result;
      node._init = true;
    }
  } catch (error) {
    // Effects report their own errors (effects.ts); the `initial` hint only fits computeds.
    if (DEV && !node._effect && !node._init && typeof node._value === 'undefined') {
      console.error(
        `computed \`${node.id}\` threw error during first run, this can be fatal.` +
          '\n\nSolutions:\n\n' +
          '1. Set the `initial` option to silence this error',
        '\n2. Or, use an `effect` if the return value is not being used',
        '\n\n',
        error,
      );
    }

    // A failure before compute (in cleanup) leaves currentObservers empty: updateObservers would
    // then unlink every source and the node would never wake again. Keep the old sources.
    if (computeStarted) updateObservers(node);
    handleError(node, error);
  } finally {
    currentObservers = prevObservers;
    currentObserversIndex = prevObserversIndex;
    node._computing = false;
    // A node disposed during its own compute stays DISPOSED.
    if (node._state !== STATE_DISPOSED) {
      node._state = STATE_CLEAN;
      if (node._missedWake) {
        node._missedWake = false;
        notify(node, STATE_DIRTY); // propagates to observers / schedules an effect
      }
    }
  }
}

/**
 * Patch 1b (frameact): sources linked for the first time in this pass were not observed while the
 * compute ran, so a write to them could not be latched by notify(). Re-dirty the node if one of
 * them was written after the compute started (a signal), or was invalidated after this pass read
 * it (a memo left DIRTY/CHECK — it would otherwise never notify us: notify() stops at nodes that
 * are already dirty). Conservative: "wrote, then read" costs at most one extra recompute.
 */
function checkNewSources(node: Computation, from: number, startEpoch: number) {
  const sources = node._sources!;
  for (let i = from; i < sources.length; i++) {
    const source = sources[i];
    if (
      source._writtenAt > startEpoch ||
      source._state === STATE_CHECK ||
      source._state === STATE_DIRTY
    ) {
      node._missedWake = true;
      return;
    }
  }
}

function updateObservers(node: Computation) {
  if (currentObservers) {
    if (node._sources) removeSourceObservers(node, currentObserversIndex);

    if (node._sources && currentObserversIndex > 0) {
      node._sources.length = currentObserversIndex + currentObservers.length;
      for (let i = 0; i < currentObservers.length; i++) {
        node._sources[currentObserversIndex + i] = currentObservers[i];
      }
    } else {
      node._sources = currentObservers;
    }

    let source: Computation;
    for (let i = currentObserversIndex; i < node._sources.length; i++) {
      source = node._sources[i];
      if (!source._observers) source._observers = [node];
      else source._observers.push(node);
    }
  } else if (node._sources && currentObserversIndex < node._sources.length) {
    removeSourceObservers(node, currentObserversIndex);
    node._sources.length = currentObserversIndex;
  }
}

function notify(node: Computation, state: number) {
  if (node._computing) {
    // Patch 1 (frameact): a write landing on a node mid-compute. A computed's result write is a
    // lazy pull this pass reads fresh — ignore it (maverick's behavior). A signal write may have
    // changed a value this pass already read: latch it; update() re-dirties the node at the end.
    if (computedWriteDepth === 0) node._missedWake = true;
    return;
  }

  if (node._state >= state) return;

  if (node._effect && node._state === STATE_CLEAN) {
    effectScheduler(node);
  }

  node._state = state;
  if (node._observers) {
    for (let i = 0; i < node._observers.length; i++) {
      notify(node._observers[i], STATE_CHECK);
    }
  }
}

function removeSourceObservers(node: Computation, index: number) {
  let source: Computation, swap: number;
  for (let i = index; i < node._sources!.length; i++) {
    source = node._sources![i];
    if (source._observers) {
      swap = source._observers.indexOf(node);
      source._observers[swap] = source._observers[source._observers.length - 1];
      source._observers.pop();
    }
  }
}
