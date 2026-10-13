// Adapted from maverick-js/signals v6 (MIT, © 2022 Rahim Alwer) — https://github.com/maverick-js/signals
import { computationConstructor, computationPrototype, initComputationNode, onDispose, read, write } from './core';
import { createEffect } from './effects';
import { Computation, ReadSignal } from './types';

export interface SelectorSignal<T> {
  (key: T): ReadSignal<Boolean>;
}

/**
 * Creates a signal that observes the given `source` and returns a new signal who only notifies
 * observers when entering or exiting a specified key.
 */
export function selector<T>(source: ReadSignal<T>): SelectorSignal<T> {
  let currentKey: T | undefined,
    nodes = new Map<T, Selector<T>>();

  createEffect(
    () => source(),
    (newKey) => {
      const prev = nodes.get(currentKey!),
        next = nodes.get(newKey);
      prev && write.call(prev, false);
      next && write.call(next, true);
      currentKey = newKey;
    },
    undefined,
    { immediateApply: true },
  );

  return function observeSelector(key: T) {
    let node = nodes.get(key);

    if (!node) nodes.set(key, (node = new (Selector as any)(key, key === currentKey, nodes)));

    node!._refs += 1;
    onDispose(node);

    return read.bind(node!);
  };
}

interface Selector<T = any> extends Computation {
  _key: T;
  _value: boolean;
  _nodes: Map<T, Selector> | null;
  _refs: number;
  call(): void;
}

// Patch P3a (frameact): the full computation field set first (not owned: selector nodes are shared
// across owners and ref-counted), then the selector's own fields.
function Selector<T>(this: Selector<T>, key: T, initialValue: boolean, nodes: Map<T, Selector>) {
  initComputationNode(this, initialValue, null, undefined, false);
  this._key = key;
  this._refs = 0;
  this._nodes = nodes;
}

const SelectorProto = (Selector.prototype = Object.create(computationPrototype));
Object.setPrototypeOf(Selector, computationConstructor); // V8 counts the base fields towards the in-object size (core.ts)
// `call` is the disposal entry (the node registers itself with onDispose); reads go through read.bind.
SelectorProto.call = function (this: Selector) {
  this._refs -= 1;
  if (!this._refs) {
    this._nodes!.delete(this._key);
    this._nodes = null;
  }
};
