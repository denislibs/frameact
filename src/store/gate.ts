// The store gate (spec §3.5 req. 6, "парковка по причине"): a frame effect whose run is due to store
// writes only waits for the end of the heavy animations in its scope chain. Installed into the core's
// runEffect hook when `frameact/store` is imported; without a store nothing carries F_STORE and the
// hook is never consulted. The core decides WHETHER a run is a candidate (F_STORE, store-gated schedule,
// not live); this module decides WHERE it waits and releases it.
import { releaseInFrame } from '../core/frame';
import { isParked, parkEffect, rebookParked, setStoreGate, type EffectNode } from '../core/effects';
import { effectScopeOf, firstAnimatingScopeSampled, installGating, isAnyScopeAnimating, type HeavyAnimationScope } from '../scheduler/heavyAnimation';

/**
 * Effects parked on a scope, in first-park order (a Set: an effect that a plain walk unparked and
 * that parked again meanwhile is listed once). A set exists exactly while a release is armed on its
 * scope. Entries that are no longer parked (ran, disposed) are swept out whenever the set doubles,
 * so a long animation with a stream of park / unpark cycles keeps it bounded by the number of
 * distinct effects that wait, not by the number of cycles.
 */
interface Parked {
  effects: Set<EffectNode>;
  sweepAt: number;
}
const parked = new WeakMap<HeavyAnimationScope, Parked>();
const MIN_SWEEP = 64;

function sweep(p: Parked) {
  for (const node of p.effects) if (!isParked(node)) p.effects.delete(node);
  p.sweepAt = Math.max(MIN_SWEEP, p.effects.size * 2);
}

function release(scope: HeavyAnimationScope) {
  const p = parked.get(scope);
  if (p === undefined) return;
  parked.delete(scope);
  // Re-booked in park order inside a measure task (as the blocking release does): the whole set lands
  // in the next frame, measure effects before mutate ones, even when the animation ends in the mutate
  // phase. Each goes through its own schedule. An effect that ran meanwhile (unparked by a plain walk)
  // or was disposed is skipped; one whose chain still animates (a nested scope) parks there again at its run.
  releaseInFrame(() => {
    for (const node of p.effects) rebookParked(node);
  });
}

installGating(); // the store gate samples animations per drain: the drains must open a sample from now on

setStoreGate((node) => {
  if (!isAnyScopeAnimating()) return false;
  // (a scope that ended mid-drain is not returned: it animates no more, and its `once` has fired)
  const scope = firstAnimatingScopeSampled(effectScopeOf(node));
  if (scope === null) return false;
  let p = parked.get(scope);
  if (p === undefined) {
    parked.set(scope, (p = { effects: new Set(), sweepAt: MIN_SWEEP }));
    scope.isAnimating.once(() => release(scope));
  }
  parkEffect(node);
  p.effects.add(node);
  if (p.effects.size >= p.sweepAt) sweep(p);
  return true;
});
