// Core perf pass, stage 2 (P4): properties of the linked dependency lists themselves — link reuse
// (a re-run reading the same deps in the same order allocates nothing), dedup of repeated reads,
// and subscriber order (first-read order, kept across re-runs and unsubscriptions).
import { computed, signal } from '../../src/core/signals';
import { root } from '../../src/core/core';
import { createEffect, type Schedule } from '../../src/core/effects';
import type { Computation, Link, ReadSignal } from '../../src/core/types';
import { depsOf, subsOf } from './helpers/graph';

const nodeOf = (s: ReadSignal<unknown>) => s.node!;
const depLinks = (node: Computation) => {
  const out: Link[] = [];
  for (let l = node._deps; l; l = l.nextDep) out.push(l);
  return out;
};
const subLinks = (node: Computation) => {
  const out: Link[] = [];
  for (let l = node._subs; l; l = l.nextSub) out.push(l);
  return out;
};

function recordingQueue() {
  const order: string[] = [];
  const queue: (() => void)[] = [];
  const schedule: Schedule = (run, node) => {
    order.push(node._name ?? '?');
    queue.push(run);
  };
  const flush = () => {
    for (let i = 0; i < queue.length; i++) queue[i]();
    queue.length = 0;
  };
  return { order, schedule, flush };
}

describe('link reuse', () => {
  it('a re-run reading the same deps in the same order keeps every link object', () => {
    const $a = signal(1);
    const $b = signal(2);
    const $c = signal(3);
    const $x = computed(() => $a() + $b() + $c());
    $x();
    const x = nodeOf($x);
    const before = depLinks(x);
    const subsBefore = subLinks(nodeOf($b));
    $b.set(5);
    expect($x()).toBe(9);
    expect(depLinks(x)).toEqual(before);
    depLinks(x).forEach((l, i) => expect(l).toBe(before[i]));
    expect(subLinks(nodeOf($b))[0]).toBe(subsBefore[0]);
  });

  it('a changed read order keeps the reused prefix, re-links the rest, and purges what was not read', () => {
    const $mode = signal(0);
    const $a = signal(1);
    const $b = signal(2);
    const $c = signal(3);
    const $x = computed(() => ($mode() === 0 ? $a() + $b() + $c() : $a() + $c()));
    $x();
    const x = nodeOf($x);
    const [lMode, lA] = depLinks(x);
    $mode.set(1);
    expect($x()).toBe(4);
    const after = depLinks(x);
    expect(after.map((l) => l.dep)).toEqual([nodeOf($mode), nodeOf($a), nodeOf($c)]);
    expect(after[0]).toBe(lMode);
    expect(after[1]).toBe(lA);
    for (const l of after) {
      expect(l.sub).toBe(x);
      expect(subLinks(l.dep)).toContain(l);
    }
    expect(subsOf(nodeOf($b))).toEqual([]);
    // the prev/next pointers of the dep list agree both ways
    for (let i = 0; i < after.length; i++) {
      expect(after[i].prevDep).toBe(i ? after[i - 1] : null);
      expect(after[i].nextDep).toBe(after[i + 1] ?? null);
    }
    expect(x._depsTail).toBe(after.at(-1));
  });

  it('repeated reads of one dep in a run make one link (adjacent and non-adjacent)', () => {
    const $a = signal(1);
    const $b = signal(2);
    const $x = computed(() => $a() + $a() + $b() + $a() + $b());
    $x();
    expect(depsOf(nodeOf($x))).toEqual([nodeOf($a), nodeOf($b)]);
    expect(subLinks(nodeOf($a)).length).toBe(1);
    $a.set(2);
    $x();
    expect(depsOf(nodeOf($x))).toEqual([nodeOf($a), nodeOf($b)]);
    expect(subLinks(nodeOf($a)).length).toBe(1);
  });

  it('a nested compute linking the dep between two reads leaves at most one duplicate, stable across re-runs', () => {
    // The dep's last subscriber link is the nested memo's: a duplicate is added (as alien-signals
    // does) — looking the first link up would make linking quadratic (see "linking cost").
    const $a = signal(1);
    const $inner = computed(() => $a() * 2); // links $a → inner between the outer's two reads
    const spy = vi.fn(() => $a() + $inner() + $a());
    const $x = computed(spy);
    expect($x()).toBe(4);
    const links = depLinks(nodeOf($x)).length;
    expect(links).toBeLessThanOrEqual(3);
    expect(new Set(depsOf(nodeOf($x)))).toEqual(new Set([nodeOf($a), nodeOf($inner)]));
    for (let i = 2; i < 5; i++) {
      $a.set(i);
      expect($x()).toBe(4 * i);
      expect(depLinks(nodeOf($x)).length).toBe(links);
    }
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('a re-run reading a shared dep twice (others subscribed after us): one duplicate, purged with the dep', () => {
    const $a = signal(1);
    const $b = signal(2);
    const $flag = signal(true);
    const spy = vi.fn(() => ($flag() ? $a() + $b() + $a() : $b()));
    const $x = computed(spy);
    $x();
    const $other = computed(() => $a()); // subscribes to $a after $x
    $other();
    $a.set(2);
    expect($x()).toBe(6);
    expect(subsOf(nodeOf($a)).filter((n) => n === nodeOf($x)).length).toBeLessThanOrEqual(2);
    $a.set(3);
    expect($x()).toBe(8);
    expect(spy).toHaveBeenCalledTimes(3); // one run per change despite the duplicate
    $flag.set(false); // drops $a: every link to it goes
    expect($x()).toBe(2);
    expect(subsOf(nodeOf($a))).toEqual([nodeOf($other)]);
    $a.set(4);
    expect($x()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(4);
  });
});

/** Time of the first run of a memo over `n` signals that already have another subscriber. */
function firstRun(n: number) {
  const signals = Array.from({ length: n }, () => signal(1));
  const others = signals.map((s) => computed(() => s()));
  for (const o of others) o();
  const $sum = computed(() => {
    let t = 0;
    for (const s of signals) t += s();
    return t;
  });
  const t0 = performance.now();
  const v = $sum();
  const ms = performance.now() - t0;
  expect(v).toBe(n);
  expect(depLinks(nodeOf($sum)).length).toBe(n);
  return ms;
}

describe('linking cost', () => {
  // Review stage 2, Important 1: a dedup scan over the run's links made a first run (or a full
  // change of deps) O(n²) when the deps had other subscribers — 16k deps: ~270 ms vs ~1 ms.
  // Stage-3 Part A: a scaling check instead of an absolute time (no flake on a slow machine):
  // linking 4N such deps costs ~4× N when linear (up to ~5× measured: cache, GC), ~16× when
  // quadratic; the bound 8× sits between them (the log midpoint). Min of a few repetitions.
  // (2N vs N measured 1.5–2.6× linear vs 4.0× quadratic under a parallel test run: too tight.)
  it('a first run over signals that already have subscribers scales linearly (4N ≤ 8× N)', () => {
    const N = 10_000;
    firstRun(N); // warm-up (JIT)
    firstRun(4 * N);
    // Interleaved, so a load spike on the machine hits both sizes alike; min of each.
    let tN = Infinity,
      t4N = Infinity;
    for (let r = 0; r < 7; r++) {
      tN = Math.min(tN, firstRun(N));
      t4N = Math.min(t4N, firstRun(4 * N));
    }
    expect(t4N).toBeLessThanOrEqual(8 * tN);
  });
});

describe('subscriber order (changed by P4: first-read order, stable across re-runs)', () => {
  // The array implementation subscribed at the END of a compute (a nested compute's subscription
  // came first) and swapped-with-last on unsubscription. The design relies on neither (spec §3.2,
  // "order inside a queue").
  it('a reader is subscribed when it reads, before the memos it pulls subscribe', () => {
    const q = recordingQueue();
    const $a = signal(0);
    const $y = computed(() => $a() + 1);
    const $x = computed(() => $a() + $y());
    const dispose = root((d) => {
      createEffect(() => $x(), () => {}, q.schedule, { name: 'EX' });
      createEffect(() => $y(), () => {}, q.schedule, { name: 'EY' });
      return d;
    });
    expect(subsOf(nodeOf($a))).toEqual([nodeOf($x), nodeOf($y)]);
    q.flush();
    q.order.length = 0;
    $a.set(1);
    expect(q.order).toEqual(['EX', 'EY']);
    dispose();
  });

  it('a parent effect that read a signal before creating its child is scheduled before the child', () => {
    const q = recordingQueue();
    const $s = signal(0);
    const dispose = root((d) => {
      createEffect(
        () => {
          $s();
          createEffect(() => $s(), () => {}, q.schedule, { name: 'child' });
        },
        () => {},
        q.schedule,
        { name: 'parent' },
      );
      return d;
    });
    q.flush();
    q.order.length = 0;
    $s.set(1);
    expect(q.order).toEqual(['parent', 'child']);
    dispose();
  });

  it('unsubscribing keeps the order of the remaining subscribers; a re-run keeps its place', () => {
    const $s = signal(0);
    const $flag = signal(true);
    const $p = computed(() => $s());
    const $q = computed(() => ($flag() ? $s() : 0));
    const $r = computed(() => $s());
    $p();
    $q();
    $r();
    const [p, q, r] = [$p, $q, $r].map(nodeOf);
    expect(subsOf(nodeOf($s))).toEqual([p, q, r]);
    $flag.set(false);
    $q();
    expect(subsOf(nodeOf($s))).toEqual([p, r]);
    $s.set(1);
    $p(); // re-run, same deps: keeps its link and place
    $r();
    expect(subsOf(nodeOf($s))).toEqual([p, r]);
    $flag.set(true);
    $q(); // re-subscribes: appended
    expect(subsOf(nodeOf($s))).toEqual([p, r, q]);
  });
});
