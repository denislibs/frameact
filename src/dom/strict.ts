/**
 * Seam for stricterdom (plan 4). `forceMutation(cb, target)` runs `cb` as a sanctioned live-DOM
 * write outside the mutate phase: `render()`'s mount into an attached container and `Portal`'s
 * attach. Until stricterdom installs its own implementation this is a plain call.
 */
export const strictHooks = {
  forceMutation<T>(cb: () => T, _target: Node): T {
    return cb();
  },
};
