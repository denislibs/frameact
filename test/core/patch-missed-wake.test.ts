import { computed, signal } from '../../src/core/signals';

it('a write to its own source during compute is not lost', () => {
  // The self-write must happen on a re-run: only then is the node already an observer of $n
  // (maverick links observers *after* compute, so a first-run self-write cannot reach it).
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
