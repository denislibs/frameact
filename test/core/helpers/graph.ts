// Implementation-agnostic view of the dependency graph for structural assertions: works with the
// array representation (`_sources` / `_observers`) and the linked one (`_deps` / `_subs` Link lists).
import type { Computation } from '../../../src/core/types';

type AnyNode = Record<string, any>;

/** The nodes `node` currently depends on, in list order (repeats included). */
export function depsOf(node: Computation): Computation[] {
  const n = node as unknown as AnyNode;
  if ('_sources' in n) return n._sources ? [...n._sources] : [];
  const out: Computation[] = [];
  for (let l = n._deps; l; l = l.nextDep) out.push(l.dep);
  return out;
}

/** The nodes currently subscribed to `node`, in list order (repeats included). */
export function subsOf(node: Computation): Computation[] {
  const n = node as unknown as AnyNode;
  if ('_observers' in n) return n._observers ? [...n._observers] : [];
  const out: Computation[] = [];
  for (let l = n._subs; l; l = l.nextSub) out.push(l.sub);
  return out;
}

/** The owned children of `scope`, in creation order (array `_children` or the intrusive list). */
export function childrenOf(scope: object): any[] {
  const n = scope as AnyNode;
  if ('_children' in n) {
    const c = n._children;
    return c == null ? [] : Array.isArray(c) ? [...c] : [c];
  }
  // Back to the first child through `_prevSibling`, then forward through `_nextSibling` (both
  // directions are exercised: a broken link in either shows up as a missing child).
  const out: any[] = [];
  let c = n._lastChild;
  if (!c) return out;
  let back = 1;
  while (c._prevSibling) {
    c = c._prevSibling;
    back++;
  }
  for (; c; c = c._nextSibling) out.push(c);
  if (out.length !== back) throw new Error(`children list: ${back} nodes backwards, ${out.length} forwards`);
  return out;
}
