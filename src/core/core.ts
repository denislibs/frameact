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
  SignalOptions,
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
 * F_REENTERED: per-run — something read the node while its update() was running (a synchronous
 * effect woken by a write the compute made); at the end a first result is announced to subscribers.
 * F_UNSURE (safety net): the node is CHECK/DIRTY but some of its subscribers may be CLEAN — a pull
 * or a notify walk was cut short by an unexpected throw (memo computes hold their errors and
 * schedulers' errors are reported, so by design neither escapes into a pull or a walk). The next walk reaching it descends into its subscribers even
 * though it is already dirty (and clears the flag); update() clears it too (the node is CLEAN
 * after, and a CLEAN node is always descended into when marked).
 * F_THREW: the node's last compute threw (it kept its previous value, CLEAN). Its next check
 * recomputes it even if no dep changed: that run may have read inputs that had changed, and the
 * thrower may recover to its old value (no change to see). Survives update()'s exit; the next
 * compute clears it on entry.
 * F_ERRORED (computeds only): the last compute threw and no onError handler took the error. The
 * error is the node's value (held in `_value`) until a compute succeeds: every read rethrows it —
 * in whichever phase the node was recomputed (a reader's compute, or the verification of its
 * deps), so a reader's try/catch always sees it. The transitions value → error and error → value
 * are changes for its subscribers (even back to the same value).
 * The F_MISSED clear on entry is only a safety net; the clear on exit (update()'s `finally`, after
 * reading it) is the one that keeps the latch from leaking into the next run. They are not
 * duplicates: do not remove either.
 */
export const F_INIT = 1,
  F_COMPUTING = 2,
  F_MISSED = 4,
  F_REENTERED = 8,
  F_UNSURE = 16,
  F_THREW = 32,
  F_ERRORED = 64,
  /**
   * Store cause tags (frameact, spec §3.5 "парковка по причине").
   * F_STORE: the node is dirty ONLY because of store writes — set by a store walk on the CLEAN → dirty
   * edge, cleared by any plain walk reaching the node (which then descends below it even though it is
   * already dirty), by update() and when a CHECK node resolves CLEAN.
   */
  F_STORE = 128,
  /** F_PARKED: an effect the store gate parked — dirty, no run booked (effects.ts / store/gate.ts). */
  F_PARKED = 256,
  /** F_LIVE: the node's last compute read the store through the live() facade (markLiveRead); set again by each compute that does. */
  F_LIVE = 512,
  /** F_LIVE_PIN: the effect is never parked by the store gate, for its lifetime (controlled-input bindings). */
  F_LIVE_PIN = 1024,
  /** F_STORE_GATED: the effect's schedule is a frame queue or a gateOnHeavyAnimation wrapper — its store-caused runs wait for heavy animations (set once, in the constructor). */
  F_STORE_GATED = 2048;

/**
 * True while the running notify walk comes from a store leaf write (writeStoreNode), or from the
 * result write of a memo whose recompute was caused by store writes only. A store walk tags what it
 * dirties with F_STORE; a plain walk clears the tag on its way down and descends through tagged nodes
 * even when they are already dirty (the plain change must reach whatever the store walk left parked).
 */
let storeWalk = false;

/** Live readers a store walk skipped ((node, state) pairs), re-delivered by plain walks right after it. */
let liveRelays: any[] | null = null;

/**
 * DEV ("why did this run"): a re-delivery (live relay, latched write) is a walk with no link of its
 * own; these carry the cause of the original walk so the effect it schedules still names the write.
 * `liveRelayWhy` runs parallel to `liveRelays` ((dep, root) per (node, state)); `relayDep`/`relayRoot`
 * are set only around the re-delivering `notify`; `missedWhy` is kept per node that latched a write.
 */
let liveRelayWhy: (Computation | null)[] | null = null;
let relayDep: Computation | null = null;
let relayRoot: Computation | null = null;
const missedWhy: WeakMap<Computation, [Computation | null, Computation | null]> | null = DEV ? new WeakMap() : null;

/** Re-deliver the skipped live readers (after the outermost store walk), as plain walks. */
function flushLiveRelays() {
  while (liveRelays !== null) {
    const r = liveRelays;
    const why = liveRelayWhy;
    liveRelays = null;
    liveRelayWhy = null;
    for (let i = 0; i < r.length; i += 2) {
      if (DEV && why !== null) {
        relayDep = why[i];
        relayRoot = why[i + 1];
      }
      notify(r[i], r[i + 1], true, null);
      if (DEV) relayDep = relayRoot = null;
    }
  }
}

/** The running computation reads the store live: its store-caused runs are never parked (store `live()`). */
export function markLiveRead() {
  if (currentObserver !== null) currentObserver._flags |= F_LIVE;
}

/** Never park this effect (pinned for its lifetime): the compiler effect delivering to a controlled input. */
export function pinLive(node: Computation) {
  node._flags |= F_LIVE_PIN;
}

/** @internal store: whether a computation is running (leaf signals are created and linked only then). */
export function getObserver(): Computation | null {
  return currentObserver;
}

/** @internal store: subscribe the running computation to `node` (a slim signal node) — no value read. */
export function trackNode(node: Computation) {
  if (currentObserver !== null) link(node, currentObserver);
}

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

/**
 * DEV ("why did this run", spec §3.4): set right before `effectScheduler` is called — the dep whose
 * link reached the effect (a signal or a memo) and the root of the walk (the node that was written).
 * Live bindings: effects.ts reads them inside its scheduler hook. Null outside a walk / in prod.
 */
export let notifyDep: Computation | null = null;
export let notifyRoot: Computation | null = null;

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

/**
 * Explicit stack for dispose(): the owners on the path from the node being disposed down to the
 * current one. Re-entrant (a cleanup may dispose anything): each call works above its base.
 */
const disposeStack: (Scope | null)[] = [];
let disposeTop = 0;

/**
 * P3a (frameact): owned children form an intrusive doubly-linked list (`_lastChild`, siblings):
 * O(1) append, O(1) self-removal. Dispose is iterative (no recursion-depth limit on deep owner
 * chains) and walks the live list: children before their owner, in reverse creation order, each
 * child's subtree before the child (post-order). A node is unlinked from its owner right before
 * its own disposal, so a cleanup that disposes a sibling, a descendant or an ancestor sees a
 * consistent tree; nodes it disposed are not disposed again.
 */
export function dispose(this: Scope, self = true) {
  if (this._state === STATE_DISPOSED) return;

  disposeChildrenOf(this);

  if (self && this._state !== STATE_DISPOSED) {
    const owner = this[SCOPE];
    if (owner !== null) unlinkChild(owner, this);
    disposeNode(this as Computation);
  }
}

/** The children walk of dispose() (also for a node already DISPOSED: see disposeLate()). */
function disposeChildrenOf(top: Scope) {
  const base = disposeTop;
  let cur: Scope = top;
  try {
    for (;;) {
      const last = cur._lastChild;
      if (last !== null) {
        disposeStack[disposeTop++] = cur;
        cur = last;
        continue;
      }
      if (disposeTop === base) break; // back at `top`: its children are gone
      const owner = disposeStack[--disposeTop]!;
      disposeStack[disposeTop] = null;
      // (a cleanup may have disposed `cur` already, together with the rest of its subtree)
      if (cur._state !== STATE_DISPOSED) {
        unlinkChild(owner, cur);
        disposeNode(cur as Computation);
      }
      cur = owner;
    }
  } finally {
    // Normally already at `base`; after a throw (disposals never throw), drop this call's frames.
    while (disposeTop > base) disposeStack[--disposeTop] = null;
  }
}

/** Rounds of disposeLate() before a cleanup that keeps re-creating work is cut off. */
const MAX_LATE_ROUNDS = 100;

/**
 * Stage-3 review (Minor 7): a cleanup of a node being disposed may create owners under it or
 * register more cleanups on it (runWithOwner/scoped with that node). Dispose those too instead of
 * leaving an orphan with a DISPOSED owner, or a cleanup that never runs.
 */
function disposeLate(node: Computation) {
  for (let round = 0; node._lastChild !== null || node._disposal !== null; round++) {
    if (round === MAX_LATE_ROUNDS) {
      console.error(
        `[frameact] a cleanup keeps creating owners or cleanups on its disposed owner${DEV && node.id ? ` \`${node.id}\`` : ''}; dropping them`,
      );
      node._disposal = null;
      for (let c = node._lastChild; c !== null; c = c._prevSibling) c[SCOPE] = null;
      node._lastChild = null;
      return;
    }
    if (node._lastChild !== null) disposeChildrenOf(node);
    if (node._disposal !== null) emptyDisposal(node);
  }
}

/** Remove `child` from `owner`'s children list (O(1)). */
function unlinkChild(owner: Scope, child: Scope) {
  const prev = child._prevSibling,
    next = child._nextSibling;
  if (prev !== null) prev._nextSibling = next;
  if (next !== null) next._prevSibling = prev;
  else if (owner._lastChild === child) owner._lastChild = prev;
  child._prevSibling = null;
  child._nextSibling = null;
  child[SCOPE] = null;
}

/**
 * frameact: dispose many children of `parent` at once (list rows), in the given order. Each child
 * is disposed like `dispose()` would (its own children first) and unlinks itself in O(1).
 */
export function disposeChildren(_parent: Scope, children: readonly Scope[]) {
  for (let i = 0; i < children.length; i++) dispose.call(children[i]);
}

function disposeNode(node: Computation) {
  node._state = STATE_DISPOSED;
  if (node._disposal) emptyDisposal(node);
  if (node._effect) effectDisposeHook(node);
  if (node._lastChild !== null || node._disposal !== null) disposeLate(node);
  if (node._deps) unlinkDeps(node._deps); // (plain scopes have no link fields)
  node[SCOPE] = null;
  node._deps = null;
  node._depsTail = null;
  // Subscribers keep their links to us: a disposed dep is skipped by updateCheck, never notifies,
  // and is dropped from their dep lists on their next run (unlinkDeps skips its abandoned list).
  node._subs = null;
  node._subsTail = null;
  node._lastChild = null;
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
  if (this._state === STATE_DISPOSED) {
    if (this._flags & F_ERRORED) throw this._value;
    return this._value;
  }

  // P4: subscribe as the read completes — from here on, any change to this dep reaches the
  // reader's latch through the link (notify(): a link confirmed in the running compute means its
  // value was consumed). Linking after the pull keeps the pull's own result writes from
  // latching the reader (it reads them fresh: the jagged-diamond rule). A pull that throws still
  // links: a reader that catches the error must wake when the dep recovers.
  if (this._compute !== null && this._state !== STATE_CLEAN) {
    try {
      updateCheck(this);
    } finally {
      // (not to a dep the pull disposed: it would revive its abandoned subscriber list)
      if (currentObserver !== null && !this._effect && this._state !== STATE_DISPOSED) {
        link(this, currentObserver);
      }
    }
  } else if (currentObserver !== null && !this._effect) link(this, currentObserver);
  if (this._flags & F_ERRORED) throw this._value; // (linked: the reader wakes when it recovers)
  return this._value;
}

export function write(this: Computation, newValue: any): any {
  const value = isFunction(newValue) ? newValue(this._value) : newValue;

  if (this._changed(this._value, value)) {
    this._value = value;
    this._writtenAt = ++writeEpoch;
    // Links confirmed after this point belong to computes that read the new value (see notify()).
    const c = cycle;
    if (storeWalk) {
      // A plain write made from inside a store walk (a synchronous effect): never store-caused.
      storeWalk = false;
      try {
        for (let l = this._subs; l !== null; l = l.nextSub) {
          if (l.version <= c) notify(l.sub, STATE_DIRTY, true, l);
        }
      } finally {
        storeWalk = true;
      }
    } else {
      for (let l = this._subs; l !== null; l = l.nextSub) {
        if (l.version <= c) notify(l.sub, STATE_DIRTY, true, l);
      }
    }
  }

  return this._value;
}

/**
 * A store leaf write (frameact, spec §3.5). The store has already compared and stored the raw value;
 * this stamps the node and runs a STORE walk, which tags the nodes it dirties with F_STORE.
 * `asStore: false` runs a plain walk instead (the store's `ungated()` writes).
 */
export function writeStoreNode(node: Computation, value: unknown, asStore: boolean) {
  node._value = value;
  node._writtenAt = ++writeEpoch;
  if (node._subs === null) return;
  const c = cycle;
  const prevWalk = storeWalk;
  storeWalk = asStore;
  try {
    for (let l: Link | null = node._subs; l !== null; l = l.nextSub) {
      if (l.version <= c) notify(l.sub, STATE_DIRTY, true, l);
    }
  } finally {
    storeWalk = false;
    if (liveRelays !== null) flushLiveRelays();
    storeWalk = prevWalk;
  }
}

/** `notifySubs` as a store walk (a memo recomputed because of store writes only) or a plain one. */
function notifySubsAs(node: Computation, asStore: boolean) {
  if (!asStore && !storeWalk) {
    notifySubs(node); // the common case: a plain recompute outside any store walk
    return;
  }
  const prevWalk = storeWalk;
  storeWalk = asStore;
  try {
    notifySubs(node);
  } finally {
    storeWalk = false;
    if (liveRelays !== null) flushLiveRelays();
    storeWalk = prevWalk;
  }
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
  node._lastChild = null;
  node._prevSibling = null;
  node._nextSibling = null;
  node._context = defaultContext;
  node._handlers = null;
  node._disposal = null;
  node._compute = null;
}

const ScopeNode = function Scope(this: Scope) {
  initScope(this);
  this._mapMemo = undefined; // one hidden class for every ScopeNode (map scopes included)
  if (currentScope) currentScope.append(this);
};

const ScopeProto = ScopeNode.prototype;

ScopeProto.append = function (this: Scope, child: Scope) {
  child[SCOPE] = this;

  const last = this._lastChild;
  child._prevSibling = last;
  if (last !== null) last._nextSibling = child;
  this._lastChild = child;

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
 * P3b (frameact): the node of a public `createSignal` is NOT appended to the current owner (Solid
 * semantics: a signal is plain state, it owns nothing and is never disposed; its readers unlink
 * from it when they are disposed). Memos and effects stay owned.
 *
 * P5 (frameact): and it is a slim node — only the fields a dependency needs (7 with the DEV id,
 * vs ~23 on a Computation): never an owner, never an observer, never disposed. It is read through
 * readSignal() (bound by createSignal) and written through write(). Wherever the core handles a
 * dep (link, unlinkDeps, updateCheck, hasDirtyDep) it touches only these fields — `_state` is
 * always CLEAN, so the reads guarded by a non-CLEAN state (`_deps`, `_flags`) never reach it.
 * Typed as a Computation for those shared paths.
 */
const SignalNode = function SignalNode(
  this: Computation,
  value: unknown,
  changed: Computation['_changed'],
  id: string | undefined,
) {
  this._state = STATE_CLEAN;
  this._writtenAt = 0;
  this._value = value;
  this._subs = null;
  this._subsTail = null;
  this._changed = changed;
  if (DEV) this.id = id ?? 'signal';
};

export function createSignalNode<T>(initialValue: T, options?: SignalOptions<T>): Computation<T> {
  return new (SignalNode as any)(initialValue, (options && options.dirty) || isNotEqual, options?.id);
}

/**
 * @internal store: a signal node that remembers the table slot it lives in (`owner`, `key`). When its
 * last subscriber unlinks, the hook set by `setLeafOrphanHook` is called so the store can drop the slot
 * (the value lives in the raw tree; the next tracked read creates a fresh leaf). Only nodes made here
 * pay for it, and only at the moment their last reader goes away.
 */
export function createLeafNode<T>(initialValue: T, owner: object, key: PropertyKey): Computation<T> {
  const node = createSignalNode(initialValue) as any;
  node._leafOwner = owner;
  node._leafKey = key;
  return node;
}

let leafOrphanHook: ((owner: any, key: PropertyKey, leaf: Computation) => void) | null = null;
/** @internal store: called when a leaf made by `createLeafNode` loses its last subscriber. */
export function setLeafOrphanHook(hook: ((owner: any, key: PropertyKey, leaf: Computation) => void) | null) {
  leafOrphanHook = hook;
}

/** P5: read a createSignal node (the slim read(): no pull, never disposed, never an effect). */
export function readSignal(this: Computation): any {
  if (currentObserver !== null) link(this, currentObserver);
  return this._value;
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
 * Explicit DFS stack for updateCheck (frames: node, link, scan). `scan` packs the write epoch the
 * node's scan started at and its rescan count into one number: epoch + rescans / 8 (exact while
 * epoch < 2^49; rescans ≤ MAX_RESCANS < 8). Usually an integer (a Smi); only after a re-scan — the
 * rare path — is it fractional, and storing it in the stack allocates a HeapNumber. A fourth slot
 * per frame measured ~2% slower on kairo. Re-entrant: each call works above its base.
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
      scan = writeEpoch;
    try {
      for (;;) {
        if (l !== null && cur._state === STATE_CHECK) {
          const dep = l.dep;
          const ds = dep._state;
          if (ds === STATE_CHECK) {
            checkStack[checkTop++] = cur;
            checkStack[checkTop++] = l;
            checkStack[checkTop++] = scan;
            cur = dep;
            l = dep._deps;
            scan = writeEpoch;
            continue;
          }
          if (ds === STATE_DIRTY) update(dep); // may dirty `cur`
          l = l.nextDep;
          continue;
        }
        // `cur`'s deps are verified. A write during the scan may have re-dirtied one already passed.
        if (cur._state === STATE_CHECK && Math.trunc(scan) !== writeEpoch && hasDirtyDep(cur)) {
          const rescans = (scan - Math.trunc(scan)) * 8;
          if (rescans < MAX_RESCANS) {
            scan = writeEpoch + (rescans + 1) / 8;
            l = cur._deps;
            continue;
          }
          cur._state = STATE_DIRTY;
        }
        // `cur` resolved: DIRTY → recompute; CHECK with no dirty dep → CLEAN; DISPOSED stays.
        if (cur._state === STATE_DIRTY) update(cur);
        else if (cur._state === STATE_CHECK) {
          if (cur._flags & F_THREW) update(cur); // its last run threw: no dep change to rely on
          else {
            cur._state = STATE_CLEAN;
            cur._flags &= ~(F_UNSURE | F_STORE); // (CLEAN: marking it again descends anyway)
          }
        }
        if (checkTop === base) return;
        scan = checkStack[--checkTop];
        l = (checkStack[--checkTop] as Link).nextDep;
        checkStack[checkTop] = null;
        cur = checkStack[--checkTop];
        checkStack[checkTop] = null;
      }
    } catch (error) {
      // A pull threw: `cur` and the nodes on the stack stay CHECK with their scan unfinished, and
      // the reader that started it ends CLEAN (the error is handled above). So does every dirty
      // node below them that the scan never reached. Let the next walk reaching any of them
      // descend to their subscribers.
      const roots: Computation[] = [cur];
      for (let i = base; i < checkTop; i += 3) roots.push(checkStack[i] as Computation);
      markUnsure(roots);
      throw error;
    } finally {
      // Normally already at `base`; after a throw, drop this call's frames.
      while (checkTop > base) checkStack[--checkTop] = null;
    }
  }
  if (node._state === STATE_DIRTY) update(node);
}

/**
 * After an aborted pull (only then): mark F_UNSURE on the CHECK `roots` and, transitively, on
 * every CHECK/DIRTY node below them — the dirty cone the scan left unverified. A write landing
 * anywhere in it would otherwise stop at an already-dirty node and never reach the CLEAN reader.
 * Costs at most what the pull would have walked. (A SignalNode is always CLEAN: never touched.)
 */
function markUnsure(roots: Computation[]) {
  const seen = new Set<Computation>();
  const todo: Computation[] = [];
  for (const n of roots) {
    if (n._state === STATE_CHECK && !seen.has(n)) {
      seen.add(n);
      n._flags |= F_UNSURE;
      todo.push(n);
    }
  }
  while (todo.length > 0) {
    const n = todo.pop()!;
    for (let l = n._deps; l !== null; l = l.nextDep) {
      const dep = l.dep;
      const ds = dep._state;
      if ((ds === STATE_CHECK || ds === STATE_DIRTY) && !seen.has(dep)) {
        seen.add(dep);
        dep._flags |= F_UNSURE;
        todo.push(dep);
      }
    }
  }
}

/**
 * Whether a dep of `node` is CHECK or DIRTY (only asked after a write landed during its scan). A
 * dep still in its own update() (re-entered from a synchronous effect) does not count: a re-scan
 * could not settle it, and its update() notifies `node` itself if the result changes.
 */
function hasDirtyDep(node: Computation): boolean {
  for (let l = node._deps; l !== null; l = l.nextDep) {
    const dep = l.dep;
    const ds = dep._state;
    if ((ds === STATE_CHECK || ds === STATE_DIRTY) && !(dep._flags & F_COMPUTING)) return true;
  }
  return false;
}

function cleanup(node: Computation) {
  if (node._lastChild !== null) dispose.call(node, false);
  if (node._disposal) emptyDisposal(node);
  node._handlers = node[SCOPE] ? node[SCOPE]._handlers : null;
}

export function update(node: Computation) {
  // Re-entry: a synchronous effect, woken by a write this compute made (or by this node's own
  // result write), reads the node before its update() has finished. It gets the current value;
  // the running update() notifies it if the result changes. (Recomputing here would let the
  // outer run overwrite the inner one's newer result with a stale one when it finishes.)
  if (node._flags & F_COMPUTING) {
    node._flags |= F_REENTERED;
    return;
  }
  // Was this recompute caused by store writes only? It decides the kind of walk the result write runs.
  // F_STORE and F_PARKED are cleared here; F_LIVE too — the compute sets it again if it reads live.
  const storeCause = (node._flags & F_STORE) !== 0;
  // (F_ERRORED stays until a compute succeeds: a re-entrant read meanwhile still gets the error)
  node._flags = (node._flags & (F_INIT | F_ERRORED | F_LIVE_PIN | F_STORE_GATED)) | F_COMPUTING;
  let computeStarted = false;
  const prevScope = currentScope,
    prevObserver = currentObserver,
    prevStartEpoch = currentStartEpoch,
    prevCycle = currentCycle;

  try {
    cleanup(node);
    // A cleanup disposed the node itself (e.g. a child's cleanup disposing its owner): no compute.
    if (node._state === STATE_DISPOSED) return;

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

    const errored = node._flags & F_ERRORED;
    node._flags &= ~F_ERRORED;
    if (!node._effect && node._flags & F_INIT) {
      // A computed's result write: a value, never an updater (not routed through write()); not a
      // signal write either (no epoch stamp, never latched by a reader mid-compute — it is a lazy
      // pull that reader reads fresh). After an error, any value is a change.
      if (errored || node._changed(node._value, result)) {
        node._value = result;
        notifySubsAs(node, storeCause && !(node._flags & (F_LIVE | F_LIVE_PIN)));
      }
    } else {
      const initial = node._value;
      node._value = result;
      node._flags |= F_INIT;
      // A first result is normally not announced (nobody saw a value yet) — unless a reader got
      // the `initial` value: while this first run was still going (see the re-entry guard above),
      // or from an earlier first run that threw (its readers stay linked: `_subs`). Announced if
      // the result differs from it. (`!==`, not the user's `equals`: it never sees `initial`.)
      if ((node._flags & F_REENTERED || node._subs !== null) && (errored || initial !== result)) {
        notifySubsAs(node, storeCause && !(node._flags & (F_LIVE | F_LIVE_PIN)));
      }
    }
  } catch (error) {
    currentScope = prevScope;
    currentObserver = prevObserver;
    currentStartEpoch = prevStartEpoch;
    currentCycle = prevCycle;
    // Keep the deps read before the throw. A failure before compute (in cleanup) keeps them all:
    // purging would unlink every dep and the node would never wake again.
    if (computeStarted) purgeDeps(node);
    node._flags |= F_THREW;
    if (node._effect) {
      handleError(node, error); // unhandled: rethrown to effects.ts, which reports it
    } else {
      try {
        handleError(node, error); // taken by an onError handler: the node keeps its last value
      } catch (unhandled) {
        // The error becomes the node's value until a compute succeeds (reads rethrow it).
        const wasErrored = node._flags & F_ERRORED;
        const changed = !wasErrored || unhandled !== node._value; // value → error, or another error
        node._value = unhandled;
        node._flags |= F_ERRORED;
        if (changed && node._subs !== null) notifySubsAs(node, false);
      }
    }
  } finally {
    const missed = node._flags & F_MISSED;
    node._flags &= F_INIT | F_THREW | F_ERRORED | F_LIVE | F_LIVE_PIN | F_STORE_GATED;
    if (node._state !== STATE_DISPOSED) {
      node._state = STATE_CLEAN;
      if (missed) {
        // A latched write is re-delivered as a plain walk (never parked: conservative).
        const prevWalk = storeWalk;
        storeWalk = false;
        if (DEV) {
          const why = missedWhy!.get(node);
          missedWhy!.delete(node); // (the pair names a store leaf: do not pin it)
          relayDep = why === undefined ? null : why[0];
          relayRoot = why === undefined ? null : why[1];
        }
        try {
          notify(node, STATE_DIRTY, true, null); // propagates to observers / schedules an effect
        } finally {
          storeWalk = prevWalk;
          if (DEV) relayDep = relayRoot = null;
        }
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
 * the compute are purged. Repeated reads of one dep in a run are deduped when cheap (adjacent: the
 * tail; otherwise: the dep's last link, if it is this compute's); else a duplicate link is added.
 * Patch 1b (frameact) lives here: a NEW link to a dep written after this compute started missed
 * that write (we were not subscribed yet) — latch it. Old links stay subscribed for the whole
 * compute, and new ones from the end of the read, so later changes reach notify()'s latch.
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
  if (prevSub !== null && prevSub.version === currentCycle && prevSub.sub === sub) return;
  // A repeated read whose link is no longer the dep's last (another reader subscribed in between)
  // adds a duplicate link, as in alien-signals: both are confirmed in this run, purged or kept
  // together, and the second visit in notify() stops at once. Looking the first one up would make
  // linking O(deps) per new link.
  // A new link missed what happened before it: a write to the dep earlier in this compute, or the
  // dep left unsettled by its pull (it latched a write of its own and re-dirtied itself). A dep
  // still in its own update() (re-entered) is not unsettled: it notifies us when it finishes.
  if (
    dep._writtenAt > currentStartEpoch ||
    (dep._state !== STATE_CLEAN && !(dep._flags & F_COMPUTING))
  ) {
    sub._flags |= F_MISSED;
    if (DEV) missedWhy!.set(sub, [dep, dep]);
  }
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
    else {
      dep._subs = nextSub;
      if (nextSub === null && (dep as any)._leafOwner !== undefined && leafOrphanHook !== null) {
        leafOrphanHook((dep as any)._leafOwner, (dep as any)._leafKey, dep);
      }
    }
  }
}

/** Whether the running compute of `sub` already read the dep behind `link` (P4: link versions). */
function consumed(sub: Computation, link: Link | null): boolean {
  const tail = sub._depsTail;
  return link !== null && tail !== null && link.version === tail.version;
}

/**
 * A computed's result write: its subscribers are DIRTY (not latched unless consumed: notify()).
 *
 * Stage 3 (frameact, alien-signals' shallow propagation): a CHECK subscriber is just set DIRTY,
 * without walking below it. It became CHECK through a walk that also marked everything below it
 * (or is still marking it: a walk paused in a synchronous effect resumes there), and a computing
 * node below that had already consumed it was latched by that walk. Its own subscribers only need
 * to hear from it again if its value changes — its update() notifies them then. Walking down again
 * re-visited every subscriber's subscribers: on a dense graph, fan-out² visits per changed memo.
 * Not for a computing subscriber (latch rules: notify()), nor one left F_UNSURE by an aborted
 * pull or walk (some of its subscribers may be CLEAN: notify() descends there).
 */
function notifySubs(node: Computation) {
  const c = cycle;
  for (let l = node._subs; l !== null; l = l.nextSub) {
    if (l.version > c) continue;
    const sub = l.sub;
    const state = sub._state;
    if (state === STATE_CHECK && !(sub._flags & (F_COMPUTING | F_UNSURE))) sub._state = STATE_DIRTY;
    else if (state < STATE_DIRTY || sub._flags & (F_COMPUTING | F_UNSURE)) notify(sub, STATE_DIRTY, false, l);
  }
}

/**
 * Explicit DFS stack for notify (frames: continuation link, the cycle its level was entered at).
 * Re-entrant: each call works above its base.
 */
const notifyStack: any[] = [];
let notifyTop = 0;

/**
 * P4 (frameact, alien-signals style): iterative push with the recursive version's visiting order
 * (pre-order DFS over subscriber lists): `node` gets `state`, everything below it CHECK.
 *
 * Each level remembers the compute cycle it was entered at (`lc`: when its node was marked). A
 * link confirmed later (`version > lc`) belongs to a compute that started after the mark — it
 * pulled the node fresh, or re-entered it (then the running update() tells it) — and is skipped.
 * Without this, a synchronous effect that re-links the node on every run (it creates an owned
 * node and reads it first) appends a new link behind the walk, which reaches it again, forever.
 * An effect that ran mid-walk BEFORE a memo it read was marked has an older link: visited.
 */
/** DEV: record the dep that reached the effect being scheduled and the walk's root (see notifyDep). */
function stampNotify(l: Link | null, via: Link | null, rootDep: Computation | null) {
  notifyDep = l !== null ? l.dep : via !== null ? via.dep : relayDep;
  notifyRoot = rootDep ?? relayRoot;
}

function notify(node: Computation, state: number, latch: boolean, via: Link | null) {
  const base = notifyTop;
  const rootDep = DEV && via !== null ? via.dep : null; // the written node (DEV attribution)
  let l: Link | null = null, // the link `node` was reached through (null: the root, via `via`)
    lc = 0; // the cycle `l`'s level was entered at
  try {
    for (;;) {
      let subs: Link | null = null;
      const flags = node._flags;
      if (flags & F_COMPUTING) {
        // Patch 1 (frameact): a change landing on a node mid-compute. A signal write may have
        // changed a value this pass already read: latch it; update() re-dirties the node at the
        // end. A computed's result write is latched only if this pass already consumed that dep
        // (its link is confirmed in the running compute) — otherwise it is a lazy pull this pass
        // reads fresh (maverick's behavior; the jagged diamond).
        if (latch || consumed(node, l !== null ? l : via)) {
          node._flags = flags | F_MISSED;
          if (DEV) missedWhy!.set(node, [l !== null ? l.dep : via !== null ? via.dep : relayDep, rootDep ?? relayRoot]);
        }
      } else {
        const prev = node._state;
        if (!storeWalk) {
          // Plain walk (the common case): as before the cause tags, plus — it clears F_STORE (and
          // unparks a parked effect) and descends through a store-tagged node that is already dirty.
          if (prev < state) {
            // The state is set BEFORE the scheduler runs: a synchronous schedule runs the effect
            // right here, and that run must see the node dirty. Scheduled once per dirty period:
            // only on the CLEAN → dirty edge (or on unpark). (Effects have no subscribers.)
            node._state = state;
            if (flags & (F_UNSURE | F_STORE | F_PARKED)) node._flags = flags & ~(F_UNSURE | F_STORE | F_PARKED);
            if (node._effect && (prev === STATE_CLEAN || flags & F_PARKED)) {
              if (DEV) stampNotify(l, via, rootDep);
              effectScheduler(node);
            }
            subs = node._subs;
          } else if (flags & (F_UNSURE | F_STORE)) {
            node._flags = flags & ~(F_UNSURE | F_STORE | F_PARKED);
            if (flags & F_PARKED) {
              if (DEV) stampNotify(l, via, rootDep);
              effectScheduler(node);
            }
            subs = node._subs;
          }
        } else if (prev === STATE_CLEAN) {
          // Store walk, CLEAN → dirty: tag. A live reader is not marked: it is re-delivered by a
          // plain walk once this store walk is done (never tagged or parked, nor anything below it).
          if (flags & (F_LIVE | F_LIVE_PIN)) {
            (liveRelays ??= []).push(node, state);
            if (DEV) (liveRelayWhy ??= []).push(l !== null ? l.dep : via !== null ? via.dep : null, rootDep);
          }
          else {
            node._state = state;
            node._flags = (flags & ~F_UNSURE) | F_STORE;
            if (node._effect) {
              if (DEV) stampNotify(l, via, rootDep);
              effectScheduler(node);
            }
            subs = node._subs;
          }
        } else if (prev < state) {
          // Store walk over a dirty node: no tag change (a mixed node stays untagged).
          node._state = state;
          if (flags & F_UNSURE) node._flags = flags & ~F_UNSURE;
          subs = node._subs;
        } else if (flags & F_UNSURE) {
          node._flags = flags & ~F_UNSURE;
          subs = node._subs;
        }
      }
      // Next link in pre-order, skipping links confirmed after their level was entered.
      for (;;) {
        if (subs !== null) {
          if (l !== null && l.nextSub !== null) {
            notifyStack[notifyTop++] = l.nextSub;
            notifyStack[notifyTop++] = lc;
          }
          l = subs;
          lc = cycle;
          subs = null;
        } else if (l !== null && l.nextSub !== null) {
          l = l.nextSub;
        } else if (notifyTop > base) {
          lc = notifyStack[--notifyTop];
          l = notifyStack[--notifyTop];
          notifyStack[notifyTop] = null;
        } else {
          return;
        }
        if (l!.version <= lc) break;
      }
      node = l!.sub;
      state = STATE_CHECK;
    }
  } catch (error) {
    // Safety net: nothing in the walk throws by design (effects.ts reports a throwing scheduler
    // instead of rethrowing). If something did, the level being visited and every level waiting
    // on the stack would have subscribers it never reached: let the next walk descend there.
    if (l !== null) l.dep._flags |= F_UNSURE;
    for (let i = base; i < notifyTop; i += 2) (notifyStack[i] as Link).dep._flags |= F_UNSURE;
    throw error;
  } finally {
    // Normally already at `base`; after a throwing scheduler, drop this call's frames.
    while (notifyTop > base) notifyStack[--notifyTop] = null;
    if (DEV) notifyDep = notifyRoot = null; // (the stamps were read by the scheduler hook: do not pin a freed store leaf)
  }
}
