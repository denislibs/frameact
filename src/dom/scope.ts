import { compute, createScope } from '../core/core';
import {
  createHeavyAnimationScope,
  provideHeavyAnimationScope,
  type HeavyAnimationScope as HeavyAnimationScopeHandle,
} from '../scheduler/heavyAnimation';

/**
 * `<HeavyAnimationScope scope?>`: every effect created in `children` snapshots `scope` (or a fresh
 * child of the enclosing scope) as its `node._scope`, so a blocking animation on it parks only this
 * subtree's frame work (spec §3.2 "Per-subtree"). The scope gates updates, not creation:
 * `children` are created right here.
 */
export function HeavyAnimationScope(props: { scope?: HeavyAnimationScopeHandle; children?: unknown }): unknown {
  const owner = createScope(); // a child of the current owner: context set here stays inside
  return compute(
    owner,
    () => {
      provideHeavyAnimationScope(props.scope ?? createHeavyAnimationScope());
      return props.children;
    },
    null,
  );
}
