import { createSignalNode, readSignal, writeStoreNode } from '../../../src/core/core';
import '../../../src/store/gate'; // installs the store gate into runEffect

/** A bare store leaf: a slim core signal node written by a store walk (`set`) or a plain walk (`setPlain`, the `ungated()` path). */
export function leaf<T>(value: T) {
  const node = createSignalNode(value);
  return {
    get: readSignal.bind(node) as () => T,
    set(v: T) {
      if (v !== node._value) writeStoreNode(node, v, true);
    },
    setPlain(v: T) {
      if (v !== node._value) writeStoreNode(node, v, false);
    },
  };
}
