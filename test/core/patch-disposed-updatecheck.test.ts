import { computed, signal } from '../../src/core/signals';
import { root, updateCheck, STATE_DISPOSED, STATE_CHECK } from '../../src/core/core';
import type { Computation } from '../../src/core/types';

it('updateCheck leaves a disposed node disposed', () => {
  const $a = signal(1);
  let node!: Computation;
  const dispose = root((d) => {
    const $b = computed(() => $a() + 1);
    $b();
    node = $b.node!; // DEV-only handle
    return d;
  });
  dispose();
  expect(node._state).toBe(STATE_DISPOSED);

  // Simulate a stale CHECK observer pulling us: must not flip us back to CLEAN.
  node._state = STATE_DISPOSED;
  updateCheck(node);
  expect(node._state).toBe(STATE_DISPOSED);

  // And a CHECK node that is not disposed still resolves normally.
  const $c = computed(() => $a() * 2);
  $c();
  $c.node!._state = STATE_CHECK;
  updateCheck($c.node!);
  expect($c.node!._state).not.toBe(STATE_CHECK);
});
