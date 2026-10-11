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

  it('a nested compute linking the dep between two reads does not make a duplicate link', () => {
    // The dep's last subscriber link is the nested memo's, not ours: found among this run's links.
    const $a = signal(1);
    const $inner = computed(() => $a() * 2); // links $a → inner between the outer's two reads
    const spy = vi.fn(() => $a() + $inner() + $a());
    const $x = computed(spy);
    expect($x()).toBe(4);
    expect(depsOf(nodeOf($x))).toEqual([nodeOf($a), nodeOf($inner)]);
    expect(subsOf(nodeOf($a)).filter((n) => n === nodeOf($x)).length).toBe(1);
    for (let i = 2; i < 5; i++) {
      $a.set(i);
      expect($x()).toBe(4 * i);
      expect(depLinks(nodeOf($x)).length).toBe(2);
    }
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('a re-run reading a shared dep twice (others subscribed after us) keeps one link', () => {
    const $a = signal(1);
    const $b = signal(2);
    const $x = computed(() => $a() + $b() + $a());
    $x();
    const $other = computed(() => $a()); // subscribes to $a after $x
    $other();
    $a.set(2);
    expect($x()).toBe(6);
    expect(depsOf(nodeOf($x))).toEqual([nodeOf($a), nodeOf($b)]);
    expect(subsOf(nodeOf($a))).toEqual([nodeOf($x), nodeOf($other)]);
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
