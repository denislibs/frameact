// The store gate (spec §3.5 req. 6, "парковка по причине"): a frame effect whose run is due to store
// writes only waits for the end of the heavy animations in its scope chain. Installed into the core's
// runEffect hook when `frameact/store` is imported; without a store nothing carries F_STORE and the
// hook is never consulted. The core decides WHETHER a run is a candidate (F_STORE, store-gated schedule,
// not live); this module decides WHERE it waits and releases it.
import { effectScopeOf, parkEffect, rebookParked, setStoreGate, type EffectNode } from '../core/effects';
import { firstAnimatingScopeSampled, isAnyScopeAnimating, type HeavyAnimationScope } from '../scheduler/heavyAnimation';

/**
 * Effects parked on a scope, in park order. A list exists exactly while a release is armed on its
 * scope. An effect unparked by a plain walk and parked again later is listed twice (the second
 * rebook finds it already clean and skips it), and a disposed effect stays listed until the release:
 * both are bounded by one animation of that scope.
 */
const parked = new WeakMap<HeavyAnimationScope, EffectNode[]>();

function release(scope: HeavyAnimationScope) {
  const list = parked.get(scope);
  if (list === undefined) return;
  parked.delete(scope);
  // Re-booked in park order; each lands in the next frame through its own schedule. An effect that
  // ran meanwhile (unparked by a plain walk) or was disposed is skipped; one whose chain still
  // animates (a nested scope) parks there again at its run.
  for (let i = 0; i < list.length; i++) rebookParked(list[i]);
}

setStoreGate((node) => {
  if (!isAnyScopeAnimating()) return false;
  // (a scope that ended mid-drain is not returned: it animates no more, and its `once` has fired)
  const scope = firstAnimatingScopeSampled(effectScopeOf(node));
  if (scope === null) return false;
  let list = parked.get(scope);
  if (list === undefined) {
    parked.set(scope, (list = []));
    scope.isAnimating.once(() => release(scope));
  }
  parkEffect(node);
  list.push(node);
  return true;
});
