import { computed, signal } from '../../src/core/signals';
import { root } from '../../src/core/core';
import { createEffect } from '../../src/core/effects';
import { flushMicrotasks } from '../helpers/micro';

it('a write to its own source during compute is not lost', () => {
  // Re-run case: the node is already an observer of $n, so the write reaches it through notify()
  // and is latched. (Writes to sources not yet linked in this pass — first compute, or a dependency
  // new in this pass — are caught by the write epoch instead; see the I1 tests below.)
  // Simulates "component body calls an action that writes the store the ancestor reads".
  const $n = signal(0);
  const runs: number[] = [];
  const $c = computed(() => {
    const v = $n();
    runs.push(v);
    if (v === 1) $n.set(2);
    return v;
  });

  expect($c()).toBe(0);
  $n.set(1);
  expect($c()).toBe(1);          // this pass wrote $n = 2 into its own source…
  expect($c()).toBe(2);          // …so it must be dirty again (pre-patch: stays 1)
  expect(runs).toEqual([0, 1, 2]);
});

it('a write that reaches the computing node through a memo it already read is not lost', () => {
  const $s = signal(0);
  const $m = computed(() => $s() * 10);
  const $c = computed(() => {
    const m = $m();              // reads the memo first…
    if (m === 10) $s.set(2);     // …then invalidates it
    return m;
  });
  expect($c()).toBe(0);
  $s.set(1);
  expect($c()).toBe(10);
  expect($c()).toBe(20);         // stale read of $m was latched
});

it('a lazy pull of a computed inside the compute does not cause an extra recompute', () => {
  const $a = signal(1);
  const $b = computed(() => $a() + 1);
  const spy = vi.fn(() => $b() * 2);
  const $c = computed(spy);
  expect($c()).toBe(4);
  $a.set(2);
  expect($c()).toBe(6);
  expect($c()).toBe(6);
  expect(spy).toHaveBeenCalledTimes(2);
});

it('a clean compute stays clean (no spurious recompute)', () => {
  const $a = signal(1);
  const spy = vi.fn(() => $a() * 2);
  const $c = computed(spy);
  expect($c()).toBe(2);
  expect($c()).toBe(2);
  expect(spy).toHaveBeenCalledTimes(1);
});

// I1 (final review): writes to a source that is not linked yet in this pass.
it('I1a: a child created in the container compute writing the container store re-runs the container (first compute)', async () => {
  const $store = signal('initial');
  const applied: string[] = [];
  root(() =>
    createEffect(
      () => {
        const v = $store();
        // child component body calls an action that writes the store the container reads
        createEffect(() => { $store.set('updated-by-child'); }, () => {});
        return v;
      },
      (v) => { applied.push(v); },
    ),
  );
  await flushMicrotasks();
  expect(applied.at(-1)).toBe('updated-by-child');
  expect($store()).toBe('updated-by-child');
});

it('I1b: a dependency new in this pass that the compute reads, then writes, re-dirties the node', () => {
  const $flag = signal(false);
  const $s = signal(0);
  const $c = computed(() => {
    if (!$flag()) return -1;
    const v = $s();
    if (v === 0) $s.set(5);
    return v;
  });
  expect($c()).toBe(-1);
  $flag.set(true);
  expect($c()).toBe(0); // this pass read 0, then wrote 5 into a source it was not linked to yet…
  expect($c()).toBe(5); // …so it must be dirty again
});

it('I1b: write-then-read of a new dependency costs at most one extra recompute and settles', () => {
  const $flag = signal(false);
  const $s = signal(0);
  const spy = vi.fn(() => {
    if (!$flag()) return -1;
    $s.set(7);
    return $s();
  });
  const $c = computed(spy);
  expect($c()).toBe(-1);
  $flag.set(true);
  expect($c()).toBe(7);
  expect($c()).toBe(7);
  expect($c()).toBe(7);
  expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
});

it('I1: a newly linked memo that a later write in the same pass invalidates re-dirties the node', () => {
  const $flag = signal(false);
  const $s = signal(1);
  const $m = computed(() => $s() * 10);
  const $c = computed(() => {
    if (!$flag()) return -1;
    const m = $m();          // first read of $m in this pass (not linked yet)…
    if (m === 10) $s.set(2); // …then invalidated
    return m;
  });
  expect($c()).toBe(-1);
  $flag.set(true);
  expect($c()).toBe(10);
  expect($c()).toBe(20);
});

it('I1: a lazy pull of a stale memo newly linked in this pass does not cause an extra recompute', () => {
  const $flag = signal(false);
  const $a = signal(1);
  const $m = computed(() => $a() * 2);
  expect($m()).toBe(2);
  $a.set(2); // $m is stale now; its recompute will write a new result
  const spy = vi.fn(() => ($flag() ? $m() : 0));
  const $c = computed(spy);
  expect($c()).toBe(0);
  $flag.set(true);
  expect($c()).toBe(4); // pulls $m lazily: its result write is a fresh read, not a missed wake
  expect($c()).toBe(4);
  expect(spy).toHaveBeenCalledTimes(2);
});
