// Core perf pass, stage 2 (P4: the dependency graph as doubly-linked Link lists). Targeted stress
// tests written against the array implementation BEFORE the port and kept green after it: effect
// scheduling order, dispose during traversal, dynamic deps, deep/wide graphs (no stack overflow),
// re-entrancy (synchronous schedules, writes mid-walk), and links detached both ways on dispose.
import { computed, signal } from '../../src/core/signals';
import { getScope, root } from '../../src/core/core';
import { createEffect, type EffectNode, type Schedule } from '../../src/core/effects';
import type { Computation, ReadSignal } from '../../src/core/types';
import { depsOf, subsOf } from './helpers/graph';

const sync: Schedule = (run) => run();

/** A queue schedule drained by hand; records the order effects were scheduled in (by name). */
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

const nodeOf = (s: ReadSignal<unknown>) => s.node!;

describe('effect scheduling order: pre-order DFS over subscribers, scheduled on the CLEAN → dirty edge', () => {
  it('fan-out with shared memos and a diamond: depth-first, each effect once', () => {
    const q = recordingQueue();
    const $s = signal(0);
    const $m1 = computed(() => $s() + 1);
    const $m2 = computed(() => $s() + 2);
    const $m3 = computed(() => $m1() * 2);
    const eff = (name: string, fn: () => number) => createEffect(fn, () => {}, q.schedule, { name });
    const dispose = root((d) => {
      eff('E2', () => $m1());
      eff('E1', () => $s());
      eff('E3', () => $m3() + $m2()); // reachable through m1→m3 and m2: scheduled at its first visit
      eff('E4', () => $m2());
      eff('E5', () => $m3());
      return d;
    });
    q.flush();
    q.order.length = 0;
    $s.set(1);
    // s.subs = [m1, E1, m2]; m1.subs = [E2, m3]; m3.subs = [E3, E5]; m2.subs = [E3, E4]
    expect(q.order).toEqual(['E2', 'E3', 'E5', 'E1', 'E4']);
    $s.set(2); // already dirty: nobody is scheduled twice
    expect(q.order).toEqual(['E2', 'E3', 'E5', 'E1', 'E4']);
    q.flush();
    q.order.length = 0;
    $s.set(3);
    expect(q.order).toEqual(['E2', 'E3', 'E5', 'E1', 'E4']);
    dispose();
  });

  it('a batch of writes schedules in write order, then subscriber order', () => {
    const q = recordingQueue();
    const $a = signal(0);
    const $b = signal(0);
    const $ab = computed(() => $a() + $b());
    const eff = (name: string, fn: () => number) => createEffect(fn, () => {}, q.schedule, { name });
    const dispose = root((d) => {
      eff('B', () => $b());
      eff('AB', () => $ab());
      eff('A', () => $a());
      eff('BA', () => $b() + $a());
      return d;
    });
    q.flush();
    q.order.length = 0;
    $b.set(1); // b.subs = [B, ab, BA]
    $a.set(1); // a.subs = [ab (CHECK already), A, BA (dirty already)]
    expect(q.order).toEqual(['B', 'AB', 'BA', 'A']);
    dispose();
  });

  it('a deep chain fans out at every level: still depth-first', () => {
    const q = recordingQueue();
    const $s = signal(0);
    const dispose = root((d) => {
      let prev: ReadSignal<number> = $s;
      for (let i = 0; i < 4; i++) {
        const p = prev;
        const m = computed(() => p() + 1);
        createEffect(() => m(), () => {}, q.schedule, { name: `deep${i}` });
        createEffect(() => p(), () => {}, q.schedule, { name: `side${i}` });
        prev = m;
      }
      return d;
    });
    q.flush();
    q.order.length = 0;
    $s.set(1);
    // s.subs = [m0, side0]; m_i.subs = [deep_i, m_{i+1}, side_{i+1}]
    expect(q.order).toEqual(['deep0', 'deep1', 'deep2', 'deep3', 'side3', 'side2', 'side1', 'side0']);
    dispose();
  });
});

describe('dispose during traversal', () => {
  it('updateCheck: a dep disposed by an earlier dep recompute is skipped, not resurrected', () => {
    const $s = signal(0);
    let disposeR!: () => void;
    let bRuns = 0;
    let $b!: ReadSignal<number>;
    root((d) => {
      disposeR = d;
      $b = computed(() => {
        bRuns++;
        return $s() * 10;
      });
    });
    const $a = computed(() => {
      if ($s() === 1) disposeR();
      return 0; // unchanged: the walk goes on to $b
    });
    const xSpy = vi.fn(() => $a() + $b());
    const $x = computed(xSpy);
    expect($x()).toBe(0);
    $s.set(1);
    expect($x()).toBe(0); // $b disposed: skipped, $x resolves clean
    expect(bRuns).toBe(1);
    expect(xSpy).toHaveBeenCalledTimes(1);
    expect(subsOf(nodeOf($s))).not.toContain(nodeOf($b));
    $s.set(2);
    expect($x()).toBe(0);
    expect(bRuns).toBe(1);
  });

  it('updateCheck: the node being checked is disposed by its dep recompute — no compute, no throw', () => {
    const $s = signal(0);
    let disposeR!: () => void;
    const xSpy = vi.fn();
    let $x!: ReadSignal<number>;
    const $a = computed(() => {
      const v = $s();
      if (v === 1) disposeR();
      return v;
    });
    const $c = computed(() => $s() + 100);
    root((d) => {
      disposeR = d;
      $x = computed(() => {
        xSpy();
        return $a() + $c();
      });
    });
    expect($x()).toBe(100);
    $s.set(1);
    expect(() => $x()).not.toThrow();
    expect($x()).toBe(100); // disposed mid-check: keeps its last value
    expect(xSpy).toHaveBeenCalledTimes(1);
    expect($c()).toBe(101); // the skipped dep is still correct when read
    $s.set(2);
    expect($x()).toBe(100);
    expect(xSpy).toHaveBeenCalledTimes(1);
    expect(subsOf(nodeOf($a))).not.toContain(nodeOf($x));
    expect(subsOf(nodeOf($c))).not.toContain(nodeOf($x));
  });

  it('notify: a synchronous effect disposes an owner whose effects and memos come later in the walk', () => {
    const $s = signal(0);
    let disposeR!: () => void;
    const e2: number[] = [];
    const e3: number[] = [];
    let $m!: ReadSignal<number>;
    const outer = root((d) => {
      createEffect(() => $s(), (v) => { if (v === 1) disposeR(); }, sync, { name: 'E1' });
      return d;
    });
    root((d) => {
      disposeR = d;
      createEffect(() => $s(), (v) => { e2.push(v); }, sync, { name: 'E2' });
      $m = computed(() => $s() * 2);
      createEffect(() => $m(), (v) => { e3.push(v); }, sync, { name: 'E3' });
    });
    expect(e2).toEqual([0]);
    expect(e3).toEqual([0]);
    expect(() => $s.set(1)).not.toThrow();
    expect(e2).toEqual([0]);
    expect(e3).toEqual([0]);
    expect(subsOf(nodeOf($s)).length).toBe(1); // only E1 is left
    $s.set(2);
    expect(e2).toEqual([0]);
    expect(e3).toEqual([0]);
    expect($m()).toBe(0); // disposed before it saw the write: keeps its last value
    outer();
    expect(subsOf(nodeOf($s))).toEqual([]);
  });

  it('notify: an effect run disposes its own owner (and itself) mid-walk', () => {
    const $s = signal(0);
    const later: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $s(), (v) => { if (v === 1) d(); }, sync, { name: 'self-dispose' });
      createEffect(() => $s(), (v) => { later.push(v); }, sync, { name: 'later' });
      return d;
    });
    expect(() => $s.set(1)).not.toThrow();
    expect(later).toEqual([0]);
    expect(subsOf(nodeOf($s))).toEqual([]);
    dispose();
  });
});

describe('dynamic deps: links reused, reordered and purged', () => {
  it('A,B → B,A → A → A,C: subscriptions follow the last run, dropped deps never rerun it', () => {
    const $mode = signal(0);
    const $a = signal(1);
    const $b = signal(10);
    const $c = signal(100);
    const spy = vi.fn(() => {
      switch ($mode()) {
        case 0: return $a() + $b();
        case 1: return $b() + $a();
        case 2: return $a();
        default: return $a() + $c();
      }
    });
    const $x = computed(spy);
    const x = nodeOf($x);
    const deps = () => depsOf(x).filter((n) => n !== nodeOf($mode));
    const subscribed = (s: ReadSignal<number>) => subsOf(nodeOf(s)).filter((n) => n === x).length;

    expect($x()).toBe(11);
    expect(deps()).toEqual([nodeOf($a), nodeOf($b)]);
    $b.set(20);
    expect($x()).toBe(21);
    expect(spy).toHaveBeenCalledTimes(2);

    $mode.set(1);
    expect($x()).toBe(21);
    expect(deps()).toEqual([nodeOf($b), nodeOf($a)]);
    expect(subscribed($a)).toBe(1);
    expect(subscribed($b)).toBe(1);
    $a.set(2);
    expect($x()).toBe(22);

    $mode.set(2);
    expect($x()).toBe(2);
    expect(deps()).toEqual([nodeOf($a)]);
    expect(subscribed($b)).toBe(0);
    const runs = spy.mock.calls.length;
    $b.set(30); // dropped: no rerun
    expect($x()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(runs);

    $mode.set(3);
    expect($x()).toBe(102);
    expect(deps()).toEqual([nodeOf($a), nodeOf($c)]);
    expect(subscribed($b)).toBe(0);
    expect(subscribed($c)).toBe(1);
    $c.set(200);
    expect($x()).toBe(202);
    const runs2 = spy.mock.calls.length;
    $b.set(40);
    expect($x()).toBe(202);
    expect(spy).toHaveBeenCalledTimes(runs2);

    $mode.set(0); // back to A,B
    expect($x()).toBe(42);
    expect(deps()).toEqual([nodeOf($a), nodeOf($b)]);
    expect(subscribed($c)).toBe(0);
  });

  it('an effect switching deps does not rerun for a dropped dep', () => {
    const q = recordingQueue();
    const $flag = signal(true);
    const $a = signal(0);
    const $b = signal(0);
    const compute = vi.fn(() => ($flag() ? $a() : $b()));
    const dispose = root((d) => {
      createEffect(compute, () => {}, q.schedule, { name: 'E' });
      return d;
    });
    q.flush();
    $flag.set(false);
    q.flush();
    expect(compute).toHaveBeenCalledTimes(2);
    $a.set(1);
    q.flush();
    expect(compute).toHaveBeenCalledTimes(2);
    $b.set(1);
    q.flush();
    expect(compute).toHaveBeenCalledTimes(3);
    dispose();
  });

  it('repeated reads of one dep in a run: one subscription, one rerun per change', () => {
    const $a = signal(1);
    const $b = signal(2);
    const spy = vi.fn(() => $a() + $b() + $a() + $a());
    const $x = computed(spy);
    expect($x()).toBe(5);
    $a.set(2);
    expect($x()).toBe(8);
    expect(spy).toHaveBeenCalledTimes(2);
    $a.set(3);
    $b.set(3);
    expect($x()).toBe(12);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(new Set(depsOf(nodeOf($x)))).toEqual(new Set([nodeOf($a), nodeOf($b)]));
  });
});

describe('deep and wide graphs: no stack overflow', () => {
  const N = 10_000;

  // The array implementation's recursive notify() overflowed the stack at this depth (P4: iterative).
  it(`a ${N}-deep memo chain: notify, updateCheck, effect and dispose`, () => {
    const q = recordingQueue();
    const $s = signal(0);
    let tail!: ReadSignal<number>;
    const applied: number[] = [];
    const dispose = root((d) => {
      let prev: ReadSignal<number> = $s;
      for (let i = 0; i < N; i++) {
        const p = prev;
        const m = computed(() => p() + 1);
        m(); // computed incrementally: the first pulls stay shallow
        prev = m;
      }
      tail = prev;
      createEffect(() => tail(), (v) => { applied.push(v); }, q.schedule, { name: 'tail' });
      return d;
    });
    q.flush();
    expect(applied).toEqual([N]);
    $s.set(1); // notify walks the whole chain
    q.flush(); // updateCheck walks the whole chain
    expect(applied).toEqual([N, N + 1]);
    $s.set(2);
    expect(tail()).toBe(N + 2); // updateCheck from a plain read
    q.flush();
    expect(applied).toEqual([N, N + 1, N + 2]);
    dispose();
    expect(subsOf(nodeOf($s))).toEqual([]);
  });

  it(`a ${N}-deep chain whose middle stays unchanged: the walk stops there (CHECK resolves clean)`, () => {
    const $s = signal(0);
    let runs = 0;
    const $cut = computed(() => ($s(), 0));
    let prev: ReadSignal<number> = $cut;
    for (let i = 0; i < N; i++) {
      const p = prev;
      const m = computed(() => {
        runs++;
        return p() + 1;
      });
      m();
      prev = m;
    }
    const tail = prev;
    expect(tail()).toBe(N);
    runs = 0;
    $s.set(1);
    expect(tail()).toBe(N);
    expect(runs).toBe(0);
  });

  it(`a signal with ${N} effect subscribers and a memo reading ${N} memos`, () => {
    const q = recordingQueue();
    const $s = signal(0);
    let sum = 0;
    const memos: ReadSignal<number>[] = [];
    const dispose = root((d) => {
      for (let i = 0; i < N; i++) createEffect(() => $s(), (v) => { sum += v; }, q.schedule);
      for (let i = 0; i < N; i++) memos.push(computed(() => $s() + i));
      createEffect(() => memos.reduce((acc, m) => acc + m(), 0), () => {}, q.schedule);
      return d;
    });
    q.flush();
    expect(subsOf(nodeOf($s)).length).toBe(2 * N);
    $s.set(1);
    expect(q.order.length).toBe(2 * (N + 1)); // creation + this write: N effects + the fan-in effect
    q.flush();
    expect(sum).toBe(N);
    const fanIn = computed(() => memos.reduce((acc, m) => acc + m(), 0));
    expect(fanIn()).toBe(N + (N * (N - 1)) / 2);
    dispose();
    expect(subsOf(nodeOf($s))).toEqual([]);
  });
});

// Review stage 2, Critical 1: under a synchronous schedule an effect whose compute creates an
// owned node and reads it before the source re-links the source on every run — the new link is
// appended to the tail of the source's subscriber list while write()'s loop is still walking it,
// so the walk reached the effect again, forever. A walk must skip links confirmed after it reached
// their level (their compute read the value fresh) — but still visit an effect that ran mid-walk
// before a memo it read was marked (P8).
const effectRuns = (make: () => void) => {
  let runs = 0;
  const $s = signal(0);
  const dispose = root((d) => {
    createEffect(
      () => {
        if (++runs > 50) throw new Error('runaway');
        make();
        return $s();
      },
      () => {},
      sync,
    );
    return d;
  });
  runs = 0;
  $s.set(1);
  const n = runs;
  dispose();
  return n;
};

describe('a walk does not chase links appended behind it', () => {
  it('an effect creating and reading an owned memo before the source runs once per write', () => {
    expect(effectRuns(() => { computed(() => 1)(); })).toBe(1);
  });

  it('an effect creating and reading an owned signal before the source runs once per write', () => {
    expect(effectRuns(() => { signal(1)(); })).toBe(1);
  });

  it('the same through an intermediate memo', () => {
    let runs = 0;
    const $s = signal(0);
    const $m = computed(() => $s() * 2);
    const dispose = root((d) => {
      createEffect(() => { runs++; computed(() => 1)(); return $m(); }, () => {}, sync);
      return d;
    });
    runs = 0;
    $s.set(1);
    expect(runs).toBe(1);
    dispose();
  });

  it('a memo result loop does not chase them either', () => {
    let runs = 0;
    const $s = signal(0);
    const $m = computed(() => $s() * 2);
    const dispose = root((d) => {
      createEffect(() => { runs++; signal(1)(); return $m(); }, () => {}, sync);
      createEffect(() => $m(), () => {}, sync); // pulls $m first: $m's result write walks its subs
      return d;
    });
    runs = 0;
    $s.set(1);
    expect(runs).toBeLessThanOrEqual(2);
    dispose();
  });

  it('an effect that read a memo mid-walk before the walk marked it runs again when the walk reaches it', () => {
    const $s = signal(0);
    const $a = computed(() => $s());
    const $t = computed(() => $s());
    const $u = computed(() => $t());
    $a(); // $s.subs = [$a, $t]: the walk reaches the effect through $a before it marks $t/$u
    const seen: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $u() + $a() * 10, (v) => { seen.push(v); }, sync);
      return d;
    });
    $s.set(1);
    expect(seen).toEqual([0, 10, 11]); // 10: $u not marked yet (glitch); 11 once the walk got there
    dispose();
  });
});

describe('re-entrancy', () => {
  it('synchronous effects writing signals mid-walk settle to consistent values', () => {
    const $s = signal(0);
    const $t = signal(0);
    const $m = computed(() => $s() + 1);
    const seen: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $s(), (v) => { $t.set(v * 10); }, sync, { name: 'E1' });
      createEffect(() => $m() + $t(), (v) => { seen.push(v); }, sync, { name: 'E3' });
      return d;
    });
    expect(seen).toEqual([1]);
    $s.set(1);
    expect(seen.at(-1)).toBe(2 + 10);
    $s.set(2);
    expect(seen.at(-1)).toBe(3 + 20);
    expect($t()).toBe(20);
    // Exact sequence (pinned on the array implementation): E1's synchronous apply writes $t while
    // the walk from $s has not reached $m yet, so E3 first runs with the old $m (11, 22) and then
    // once more when the walk reaches it — the walk order and the schedule edge are unchanged.
    expect(seen).toEqual([1, 11, 12, 22, 23]);
    dispose();
  });

  it('a synchronous effect writing a signal read by a memo that a later subscriber in the walk depends on', () => {
    const $s = signal(0);
    const $t = signal(0);
    const $mt = computed(() => $t() * 2);
    const out: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $s(), (v) => { $t.set(v); }, sync, { name: 'writer' });
      createEffect(() => $s() + $mt(), (v) => { out.push(v); }, sync, { name: 'reader' });
      return d;
    });
    $s.set(1);
    $s.set(2);
    expect(out.at(-1)).toBe(2 + 4);
    expect(out).toEqual([0, 3, 6]); // the writer runs first in the walk: the reader sees fresh values
    expect($mt()).toBe(4);
    dispose();
  });

  it('a synchronous effect woken by a memo result write does not recompute that memo again', () => {
    // E1's run pulls $m; $m's result write wakes E2 (still CLEAN: the walk from $s has not reached
    // it yet), which runs right there and reads $m — while $m's update() is still finishing.
    const $s = signal(0);
    const mSpy = vi.fn(() => $s() * 2);
    const $m = computed(mSpy);
    const seen: string[] = [];
    const dispose = root((d) => {
      createEffect(() => $m(), (v) => { seen.push(`E1:${v}`); }, sync, { name: 'E1' });
      createEffect(() => $m(), (v) => { seen.push(`E2:${v}`); }, sync, { name: 'E2' });
      return d;
    });
    expect(mSpy).toHaveBeenCalledTimes(1);
    $s.set(1);
    expect(mSpy).toHaveBeenCalledTimes(2); // once per change (was 3: re-entrant update of $m)
    expect(seen).toEqual(['E1:0', 'E2:0', 'E2:2', 'E1:2']);
    $s.set(2);
    expect(mSpy).toHaveBeenCalledTimes(3);
    dispose();
  });

  it('a synchronous effect woken by a write made inside a memo compute does not re-enter that compute', () => {
    // $m's compute writes $s; that wakes E2, which reads $m while $m's update() is still running.
    // E2 gets $m's current value; when $m finishes with a different result, E2 is notified.
    const $s = signal(0);
    const $t = signal(1);
    const mSpy = vi.fn(() => {
      $s.set((v) => v + 1);
      return $t() * 10;
    });
    const $m = computed(mSpy);
    const seen: unknown[] = [];
    const dispose = root((d) => {
      createEffect(() => ($s() > 0 ? $m() : -1), (v) => { seen.push(v); }, sync, { name: 'E2' });
      createEffect(() => $m(), () => {}, sync, { name: 'E1' }); // $m's first run happens here
      return d;
    });
    expect(mSpy).toHaveBeenCalledTimes(1); // not re-entered by E2's read
    expect(seen.at(-1)).toBe(10); // E2 saw `undefined` mid-run, then was told about the first result
    $t.set(2);
    expect(seen.at(-1)).toBe(20);
    expect($m()).toBe(20);
    dispose();
  });

  it('a queue drained from inside an effect apply (nested flush) keeps the graph consistent', () => {
    const queue: (() => void)[] = [];
    const schedule: Schedule = (run) => { queue.push(run); };
    const drain = () => { while (queue.length) queue.shift()!(); };
    const $a = signal(0);
    const $b = signal(0);
    const $sum = computed(() => $a() + $b());
    const seen: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $a(), (v) => { if (v) { $b.set(v * 10); drain(); } }, schedule);
      createEffect(() => $sum(), (v) => { seen.push(v); }, schedule);
      return d;
    });
    drain();
    $a.set(1);
    drain();
    expect(seen).toEqual([0, 11]);
    expect($sum()).toBe(11);
    dispose();
  });
});

// Found by the differential fuzz (writers mode): patch 1b's checkNewSources() only sees a dep bound
// for the first time in this pass if, at the end of the compute, it was written after the compute
// started (signals) or is still DIRTY/CHECK (memos). A memo that was invalidated after this pass
// read it AND re-pulled (recomputed, CLEAN again) later in the same pass slips through: the reader
// keeps the value it read first and is never woken again. The array implementation subscribes at
// the end of the compute, so the invalidation's notify() could not reach the reader to latch it.
// Failed on the array implementation; subscribing at read time (P4) closes the hole.
describe('missed wake: a dep bound for the first time, invalidated and re-pulled in the same pass', () => {
  it('a memo whose own compute is latched (it wrote what it read), then re-pulled by the reader', () => {
    const $s = signal(0);
    const $m = computed(() => {
      const v = $s();
      if (v === 1) $s.set(2); // latched: $m re-dirties itself at the end of this run
      return v;
    });
    const $gate = signal(false);
    const spy = vi.fn(() => {
      if (!$gate()) return -1;
      const first = $m(); // new binding: reads 1, then $m is DIRTY again
      $m(); // re-pulls $m: 2, CLEAN
      return first;
    });
    const $r = computed(spy);
    expect($r()).toBe(-1);
    $s.set(1);
    $gate.set(true);
    expect($r()).toBe(1); // this pass read 1 …
    expect($m()).toBe(2);
    expect($r()).toBe(2); // … and is re-run once (array impl: stuck at 1)
    expect($r()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('a memo invalidated by a write made later in the same pass, then re-pulled through another memo', () => {
    const $s = signal(0);
    const $t = signal(0);
    const $gate = signal(false);
    const $m = computed(() => $s() * 10);
    const $w = computed(() => {
      const t = $t();
      $s.set(t); // a write inside a nested compute: invalidates $m after $r read it
      return t;
    });
    const $n = computed(() => $m() + 1); // re-pulls $m
    const spy = vi.fn(() => {
      if (!$gate()) return -1;
      const first = $m();
      $w();
      $n();
      return first;
    });
    const $r = computed(spy);
    expect($r()).toBe(-1);
    $t.set(1);
    $gate.set(true);
    expect($r()).toBe(0);
    expect($m()).toBe(10);
    expect($r()).toBe(10); // array impl: stuck at 0
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

// Found by the differential fuzz (writers mode), also on the array implementation and 995e983:
// a signal write made inside an updateCheck walk (by a dep that latched a write of its own, or by
// a writing memo recomputed later in the walk) re-dirties a dep of a CHECK node, but its notify()
// stops at that node (already CHECK) — which the walk then resolved CLEAN. Nothing woke it again.
const f = (v: number) => (v === 2 ? 5 : 0); // the latched run (v = 1) returns the old result 0

const selfLatching = () => {
  const $s = signal(0);
  const spy = vi.fn(() => {
    const v = $s();
    if (v === 1) $s.set(2); // latched: re-dirties itself at the end of this run
    return f(v);
  });
  return { $s, $d: computed(spy), spy };
};

// MAX_RESCANS (4): a dep that writes what it reads for a while (v = 100 … 109) stays unsettled
// through every re-scan; the reader is then recomputed conservatively and latched, and settles
// over the next pulls. No hang, a bounded number of dep runs per pull, the right final value.
const windowDep = () => {
  const $n = signal(0);
  const dSpy = vi.fn(() => {
    const v = $n();
    if (v >= 100 && v < 110) $n.set(v + 1); // latched: re-dirties itself
    return v >= 110 ? 1 : 0; // unchanged until it settles: its reader stays CHECK in the walk
  });
  return { $n, $d: computed(dSpy), dSpy };
};

describe('a dep re-dirtied inside an updateCheck walk', () => {
  it('a direct reader is not resolved clean on the unsettled dep', () => {
    const { $s, $d, spy } = selfLatching();
    const xSpy = vi.fn(() => $d() * 10);
    const $x = computed(xSpy);
    expect($x()).toBe(0);
    $s.set(1);
    expect($x()).toBe(50); // was 0, forever
    expect($x()).toBe(50);
    expect($d()).toBe(5);
    expect(spy).toHaveBeenCalledTimes(3); // initial, the latched run, the settling run
    expect(xSpy).toHaveBeenCalledTimes(2);
  });

  it('a reader one level up (the dep is reached by descending into a CHECK memo)', () => {
    const { $s, $d } = selfLatching();
    const ySpy = vi.fn(() => $d() + 1);
    const $y = computed(ySpy);
    const $x = computed(() => $y() * 10);
    expect($x()).toBe(10);
    $s.set(1);
    expect($x()).toBe(60); // was 10, forever
    expect($y()).toBe(6);
    expect(ySpy).toHaveBeenCalledTimes(2);
  });

  it('an effect reading the dep applies the settled value', async () => {
    const { $s, $d } = selfLatching();
    const seen: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $d(), (v) => { seen.push(v); });
      return d;
    });
    await Promise.resolve();
    $s.set(1);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(seen).toEqual([0, 5]); // was [0]: the effect resolved clean, never applied 5
    dispose();
  });

  it('a dep verified earlier in the walk, re-dirtied by a write a later dep makes, is verified again', () => {
    const $s = signal(0);
    const $t = signal(0);
    const $a = computed(() => $s()); // verified clean first …
    const $w = computed(() => {
      $s.set($t()); // … then this writer, recomputed later in the same walk, invalidates it
      return 0; // unchanged: the reader stays CHECK through the walk
    });
    const nSpy = vi.fn(() => $a() + $w());
    const $n = computed(nSpy);
    expect($n()).toBe(0);
    $t.set(5);
    expect($n()).toBe(5); // was 0, forever
    expect(nSpy).toHaveBeenCalledTimes(2);
  });

  it('a dep still unsettled after MAX_RESCANS: 6 dep runs on the pull, then one per pull until it settles', () => {
    const { $n, $d, dSpy } = windowDep();
    const xSpy = vi.fn(() => $d() * 10);
    const $x = computed(xSpy);
    expect($x()).toBe(0);
    dSpy.mockClear();
    xSpy.mockClear();
    $n.set(100);
    expect($x()).toBe(0);
    // 1 run in the scan + 4 re-scans, then the conservative recompute of $x pulls it once more
    expect(dSpy).toHaveBeenCalledTimes(6);
    expect(xSpy).toHaveBeenCalledTimes(1);
    expect(nodeOf($x)._state).toBe(2); // latched by the dep's re-dirty: not settled yet
    const perPull: number[] = [];
    for (let i = 0; i < 8; i++) {
      const before = dSpy.mock.calls.length;
      $x();
      perPull.push(dSpy.mock.calls.length - before);
    }
    // each later pull: one dep run (v = 106 … 109 still latch, 110 settles), one reader run; then quiet
    expect(perPull).toEqual([1, 1, 1, 1, 1, 0, 0, 0]);
    expect(xSpy).toHaveBeenCalledTimes(6);
    expect($x()).toBe(10);
    expect($n()).toBe(110);
  });

  it('through a tickEnd effect: applies [0, 1], nothing in between', async () => {
    const { $n, $d } = windowDep();
    const applied: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $d(), (v) => { applied.push(v); });
      return d;
    });
    await Promise.resolve();
    $n.set(100);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(applied).toEqual([0, 1]);
    dispose();
  });
});

describe('a dep whose pull throws', () => {
  it('a reader that catches the error inside its compute stays subscribed and re-runs on recovery', () => {
    const $k = signal(1);
    const $trigger = signal(0);
    const $m = computed(() => {
      if ($k() < 0) throw new Error('negative');
      return $k() * 10;
    }, { initial: 0 });
    const spy = vi.fn(() => {
      $trigger(); // a direct dep: the reader recomputes, and pulls $m inside its own compute
      try {
        return $m();
      } catch {
        return -1;
      }
    });
    const $r = computed(spy);
    expect($r()).toBe(10);
    $k.set(-1);
    $trigger.set(1);
    expect($r()).toBe(-1); // the pull threw inside the compute; the reader caught it
    expect(depsOf(nodeOf($r))).toContain(nodeOf($m));
    $k.set(2); // reaches the reader only through its link to $m
    expect($r()).toBe(20);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('dispose detaches links both ways', () => {
  it('a disposed subscriber is gone from every dependency; a disposed dependency has no subscribers', () => {
    const $a = signal(1);
    const $b = signal(2);
    const $c = signal(3);
    let disposeX!: () => void;
    let $x!: ReadSignal<number>;
    root((d) => {
      disposeX = d;
      $x = computed(() => $a() + $b() + $c());
    });
    let effectNode!: Computation;
    const disposeE = root((d) => {
      createEffect(() => {
        effectNode = getScope() as Computation;
        return $x() + $a();
      }, () => {});
      return d;
    });
    expect(subsOf(nodeOf($x))).toEqual([effectNode]);
    expect(subsOf(nodeOf($a))).toContain(effectNode);
    disposeE();
    expect(subsOf(nodeOf($x))).toEqual([]);
    expect(subsOf(nodeOf($a))).not.toContain(effectNode);
    expect(depsOf(effectNode)).toEqual([]);
    disposeX();
    for (const s of [$a, $b, $c]) expect(subsOf(nodeOf(s))).toEqual([]);
    expect(depsOf(nodeOf($x))).toEqual([]);
    expect(subsOf(nodeOf($x))).toEqual([]);
  });

  it('disposing a memo that has subscribers clears its subscriber list; they read its last value', () => {
    const $a = signal(1);
    let disposeM!: () => void;
    let $m!: ReadSignal<number>;
    root((d) => {
      disposeM = d;
      $m = computed(() => $a() * 2);
    });
    const $r = computed(() => $m() + 1);
    expect($r()).toBe(3);
    disposeM();
    expect(subsOf(nodeOf($m))).toEqual([]);
    expect(subsOf(nodeOf($a))).toEqual([]);
    $a.set(5);
    expect($r()).toBe(3);
  });

  it('effect node fields are dropped on dispose (no stale graph references kept alive)', () => {
    const $a = signal(0);
    let node!: EffectNode;
    const dispose = root((d) => {
      createEffect(() => {
        node = getScope() as EffectNode;
        return $a();
      }, () => {});
      return d;
    });
    dispose();
    expect(depsOf(node)).toEqual([]);
    expect(subsOf(node)).toEqual([]);
    expect(subsOf(nodeOf($a))).toEqual([]);
  });
});
