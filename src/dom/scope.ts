import { DEV } from '../env';
import { getScope } from '../core/core';
import { SCOPE } from '../core/symbols';
import {
  createHeavyAnimationScope,
  provideHeavyAnimationScope,
  type HeavyAnimationScope as HeavyAnimationScopeHandle,
} from '../scheduler/heavyAnimation';
import { children } from './component';

/**
 * `<HeavyAnimationScope scope?>`: every effect created in `children` snapshots `scope` (or a fresh
 * child of the enclosing scope) as its `node._scope`, so a blocking animation on it parks only this
 * subtree's frame work (spec §3.2 "Per-subtree"). The scope gates updates, not creation:
 * `children` are created right here, inside the component's own scope (render it through
 * `createComponent`/JSX, which gives it one; DEV warns when there is no owner). Returns an accessor
 * of the resolved children (a reactive `children` getter stays reactive; accessor children run under
 * the scope). The children are created on the first read of the result (JSX always reads it).
 *
 * `scope` is read once, as a snapshot at creation. A fresh inner scope is not force-released on
 * unmount: a child that began a blocking animation on it must call `end` itself (a finite duration
 * ends on its own); an explicit `scope` prop is never touched. Parked runs of unmounted nodes are
 * skipped, not run, when the scope is released.
 */
export function HeavyAnimationScope(props: { scope?: HeavyAnimationScopeHandle; children?: unknown }): unknown {
  if (DEV && getScope()?.[SCOPE] == null) {
    console.warn('[frameact] <HeavyAnimationScope> rendered without an owner (or inside an effect apply): what its children create is never disposed.');
  }
  // The component scope from createComponent is already a child of the current owner, so the
  // context provided here stays inside it.
  provideHeavyAnimationScope(props.scope ?? createHeavyAnimationScope());
  return children(() => props.children);
}
