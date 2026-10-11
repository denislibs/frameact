// Core perf pass, stage 1: behavior pinned before the hot-path changes (lean createSignal/createMemo,
// inline computed result write with a parameterized latch flag, packed `_flags`).
import { createMemo, createSignal } from '../../src/index';
import { computed, signal } from '../../src/core/signals';
import { onError, root } from '../../src/core/core';
import { createEffect } from '../../src/core/effects';
import { flushMicrotasks } from '../helpers/micro';

describe('a computed result is a value, never an updater', () => {
  it('createMemo returning a function keeps that function (same identity) and never calls it', () => {
    const f = vi.fn(() => 1);
    const [s, set] = createSignal(0);
    const m = createMemo(() => (s(), f));
    expect(m()).toBe(f);
    set(1);
    expect(m()).toBe(f);
    expect(f).not.toHaveBeenCalled();
  });

  it('computed returning a new function each run stores the new one and calls neither', () => {
    const made: Array<() => number> = [];
    const $s = signal(0);
    const $c = computed(() => {
      const v = $s();
      const fn = vi.fn(() => v);
      made.push(fn);
      return fn;
    });
    expect($c()).toBe(made[0]);
    $s.set(1);
    expect($c()).toBe(made[1]);
    $s.set(2);
    expect($c()).toBe(made[2]);
    for (const fn of made) expect(fn).not.toHaveBeenCalled();
  });

  it('a memo switching from a function to a plain value and back stores each as is', () => {
    const f = vi.fn(() => 'called');
    const [s, set] = createSignal(0);
    const m = createMemo<unknown>(() => (s() === 1 ? 42 : f));
    expect(m()).toBe(f);
    set(1);
    expect(m()).toBe(42);
    set(2);
    expect(m()).toBe(f);
    expect(f).not.toHaveBeenCalled();
  });

  it('observers of a function-valued memo see the change exactly once per new function', async () => {
    const [s, set] = createSignal(0);
    const fns = [() => 'a', () => 'b'];
    const m = createMemo(() => fns[s()]);
    const applied: unknown[] = [];
    root(() => createEffect(() => m(), (v) => { applied.push(v); }));
    await flushMicrotasks();
    set(1);
    await flushMicrotasks();
    expect(applied).toEqual([fns[0], fns[1]]);
  });
});

describe('signal setters keep updater semantics', () => {
  it('a function given to the setter is an updater of the previous value; the setter returns the new value', () => {
    const [n, setN] = createSignal(1);
    expect(setN((p) => p + 1)).toBe(2);
    expect(n()).toBe(2);
    const $s = signal(10);
    expect($s.set((p) => p * 3)).toBe(30);
    expect($s()).toBe(30);
  });

  it('storing a function in a signal needs the updater form; the stored function is not called on reads', () => {
    const f = vi.fn(() => 'x');
    const [g, setG] = createSignal<() => string>(() => 'init');
    setG(() => f);
    expect(g()).toBe(f);
    expect(f).not.toHaveBeenCalled();
  });

  it('an updater returning the same value does not notify', () => {
    const [n, setN] = createSignal(1);
    const spy = vi.fn(() => n());
    const m = createMemo(spy);
    m();
    setN((p) => p);
    m();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('createSignal / createMemo surface', () => {
  it('equals: false always notifies; a custom equals suppresses equal writes', () => {
    const [a, setA] = createSignal(1, { equals: false });
    const spyA = vi.fn(() => a());
    const ma = createMemo(spyA);
    ma();
    setA(1);
    ma();
    expect(spyA).toHaveBeenCalledTimes(2);

    const [b, setB] = createSignal({ v: 1 }, { equals: (x, y) => x.v === y.v });
    const spyB = vi.fn(() => b().v);
    const mb = createMemo(spyB);
    mb();
    setB({ v: 1 });
    mb();
    expect(spyB).toHaveBeenCalledTimes(1);
    setB({ v: 2 });
    expect(mb()).toBe(2);
  });

  it('createMemo equals: an equal result does not propagate to observers', () => {
    const [s, setS] = createSignal(1);
    const parity = createMemo(() => ({ odd: s() % 2 === 1 }), { equals: (x, y) => x.odd === y.odd });
    const spy = vi.fn(() => parity().odd);
    const m = createMemo(spy);
    expect(m()).toBe(true);
    setS(3);
    expect(m()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    setS(4);
    expect(m()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('createMemo is lazy and owned: disposing its owner stops it, the last value stays readable', () => {
    const [s, setS] = createSignal(1);
    const spy = vi.fn(() => s() * 2);
    let m!: () => number;
    let dispose!: () => void;
    root((d) => {
      dispose = d;
      m = createMemo(spy);
    });
    expect(spy).not.toHaveBeenCalled();
    expect(m()).toBe(2);
    dispose();
    setS(5);
    expect(m()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('accessor and setter ignore extra arguments', () => {
    const [n, setN] = createSignal(1);
    expect((n as any)(99)).toBe(1);
    expect((setN as any)(2, 'extra')).toBe(2);
    expect(n()).toBe(2);
  });
});

describe('missed-wake latch through the notify chain', () => {
  it('a write inside the compute reaching the node through two memo levels is latched', () => {
    const $s = signal(0);
    const $m1 = computed(() => $s() + 1);
    const $m2 = computed(() => $m1() * 10);
    const runs: number[] = [];
    const $c = computed(() => {
      const v = $m2();
      runs.push(v);
      if (v === 20) $s.set(5); // $s → $m1 → $m2 → $c (computing): latch at depth 3
      return v;
    });
    expect($c()).toBe(10);
    $s.set(1);
    expect($c()).toBe(20);
    expect($c()).toBe(60);
    expect($c()).toBe(60);
    expect(runs).toEqual([10, 20, 60]);
  });

  it('jagged diamond: a lazy pull through a deeper chain does not latch (one run per change)', () => {
    const $a = signal(1);
    const $b = computed(() => $a() * 2);
    const $c = computed(() => $b() + 1);
    const $d = computed(() => $c() + 1);
    // $e reads the deep end first, then the shallow ones: pulling $d writes $c and $b results while
    // $e computes — those writes reach $e (an observer of all of them) and must not latch it.
    const spy = vi.fn(() => $d() + $b() + $a());
    const $e = computed(spy);
    expect($e()).toBe(4 + 2 + 1);
    $a.set(2);
    expect($e()).toBe(6 + 4 + 2);
    expect($e()).toBe(12);
    expect(spy).toHaveBeenCalledTimes(2);
    $a.set(3);
    expect($e()).toBe(8 + 6 + 3);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('jagged diamond: shallow-first reads, deep pull mid-compute, still one run per change', () => {
    const $a = signal(1);
    const $b = computed(() => $a() * 2);
    const $c = computed(() => $b() + 1);
    const $d = computed(() => $c() + 1);
    const spy = vi.fn(() => $a() + $b() + $d());
    const $e = computed(spy);
    expect($e()).toBe(1 + 2 + 4);
    $a.set(2);
    expect($e()).toBe(2 + 4 + 6);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('jagged diamond into an effect: one compute and one apply per change', async () => {
    const $a = signal(1);
    const $b = computed(() => $a() + 1);
    const $c = computed(() => $b() + 1);
    const compute = vi.fn(() => $c() + $a());
    const apply = vi.fn();
    root(() => createEffect(compute, apply));
    await flushMicrotasks();
    $a.set(2);
    await flushMicrotasks();
    $a.set(3);
    await flushMicrotasks();
    expect(compute).toHaveBeenCalledTimes(3);
    expect(apply.mock.calls.map((c) => c[0])).toEqual([4, 6, 8]);
  });

  it('a memo pulled inside the compute and then invalidated by a write in the same compute re-dirties the reader', () => {
    const $s = signal(0);
    const $m = computed(() => $s() * 2);
    const $mm = computed(() => $m() + 1);
    const runs: number[] = [];
    const $c = computed(() => {
      const v = $mm(); // pulls $mm and $m (their result writes: not latched)…
      runs.push(v);
      if (v === 3) $s.set(4); // …then a signal write invalidates them (latched)
      return v;
    });
    expect($c()).toBe(1);
    $s.set(1);
    expect($c()).toBe(3);
    expect($c()).toBe(9);
    expect(runs).toEqual([1, 3, 9]);
  });

  it('an effect whose compute writes its own source reruns once and settles', async () => {
    const $n = signal(0);
    const applied: number[] = [];
    const compute = vi.fn(() => {
      const v = $n();
      if (v === 1) $n.set(2);
      return v;
    });
    root(() => createEffect(compute, (v) => { applied.push(v); }));
    await flushMicrotasks();
    $n.set(1);
    await flushMicrotasks();
    // initial (0) + the run that writes (1, latched) + the latched re-run (2). The writing run's
    // value is applied too: the latch re-dirties the node after compute, the run still applies.
    expect(compute).toHaveBeenCalledTimes(3);
    expect(compute.mock.results.map((r) => r.value)).toEqual([0, 1, 2]);
    expect(applied).toEqual([0, 1, 2]);
    expect($n()).toBe(2);
    $n.set(3);
    await flushMicrotasks();
    expect(compute).toHaveBeenCalledTimes(4);
    expect(applied).toEqual([0, 1, 2, 3]);
  });

  // Stage-1 review "scenario B": a write made by a memo's user `dirty` (equals) while a reader pulls
  // that memo inside its own compute. The write is a *signal* write and must be latched / stamped
  // even though it happens during a computed result write (995e983 inherited "don't latch" there).
  it('a memo `dirty` that writes a signal the reader binds for the first time in this pass re-dirties the reader', () => {
    const $count = signal(0);
    const $gate = signal(false);
    const $a = signal(1);
    const $m = computed(() => $a() * 2, {
      dirty: (p, n) => {
        $count.set((c) => c + 1);
        return p !== n;
      },
    });
    const spy = vi.fn(() => ($gate() ? $count() : -100) + $m());
    const $x = computed(spy);
    expect($x()).toBe(-98);
    $gate.set(true);
    $a.set(5); // $x first reads $count (new binding), then pulls $m, whose dirty writes $count
    expect($x()).toBe(10); // this pass read $count before the write…
    expect($count()).toBe(1);
    expect($x()).toBe(11); // …the write is latched: 995e983 stays at 10 forever (missed wake)
    expect($x()).toBe(11);
    expect(spy).toHaveBeenCalledTimes(3); // initial + the change + one latched re-run
    $a.set(6);
    // Now $count is an old binding pulled in updateCheck: $m's dirty writes it before $x recomputes.
    expect($x()).toBe(2 + 12);
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it('a memo `dirty` that writes a signal the reader is already bound to re-dirties the reader', () => {
    const $count = signal(0);
    const $trigger = signal(0);
    const $a = signal(1);
    const $m = computed(() => $a() * 2, {
      dirty: (p, n) => {
        $count.set((c) => c + 1);
        return p !== n;
      },
    });
    const spy = vi.fn(() => $trigger() + $count() + $m());
    const $x = computed(spy);
    expect($x()).toBe(2);
    $a.set(5);
    $trigger.set(100); // $x DIRTY: recomputes directly, pulling $m mid-compute (not in updateCheck)
    expect($x()).toBe(100 + 0 + 10); // read $count (old binding), then $m's dirty wrote it
    expect($count()).toBe(1);
    expect($x()).toBe(100 + 1 + 10); // latched (995e983: stuck at 110)
    expect($x()).toBe(111);
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe('per-run flags do not leak between runs', () => {
  it('after a latched re-run settles, reads stay clean and the next write costs exactly one run', () => {
    const $n = signal(0);
    const spy = vi.fn(() => {
      const v = $n();
      if (v === 1) $n.set(2);
      return v;
    });
    const $c = computed(spy);
    $c();
    $n.set(1);
    $c();
    expect($c()).toBe(2);
    const settled = spy.mock.calls.length;
    $c();
    $c();
    expect(spy).toHaveBeenCalledTimes(settled);
    $n.set(3);
    expect($c()).toBe(3);
    expect(spy).toHaveBeenCalledTimes(settled + 1);
  });

  it('a latch set in a pass that then throws still re-dirties the node, and only once', () => {
    const $n = signal(0);
    const handler = vi.fn();
    const spy = vi.fn(() => {
      const v = $n();
      if (v === 1) {
        $n.set(2);
        throw new Error('after write');
      }
      return v;
    });
    let $c!: () => number;
    root(() => {
      onError(handler);
      $c = computed(spy);
    });
    expect($c()).toBe(0);
    $n.set(1);
    expect($c()).toBe(0); // threw: previous value kept…
    expect(handler).toHaveBeenCalledTimes(1);
    expect($c()).toBe(2); // …but the write it made is not lost
    expect($c()).toBe(2);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('a compute that throws is not left "computing": the next source write dirties it', () => {
    const $n = signal(0);
    const handler = vi.fn();
    let $c!: () => number;
    root(() => {
      onError(handler);
      $c = computed(() => {
        const v = $n();
        if (v === 1) throw new Error('boom');
        return v;
      });
    });
    expect($c()).toBe(0);
    $n.set(1);
    $c();
    $n.set(2);
    expect($c()).toBe(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('an error after the first run keeps the memo initialised: later results are compared and propagated', () => {
    const $n = signal(0);
    const handler = vi.fn();
    let $c!: () => number;
    root(() => {
      onError(handler);
      $c = computed(() => {
        const v = $n();
        if (v === 1) throw new Error('boom');
        return v === 2 ? 0 : v; // 2 maps back to the current value 0
      });
    });
    const spy = vi.fn(() => $c());
    const $obs = computed(spy);
    expect($obs()).toBe(0);
    $n.set(1);
    expect($obs()).toBe(0); // $c threw: no result write, $obs resolves CHECK → CLEAN
    expect(spy).toHaveBeenCalledTimes(1);
    $n.set(2);
    expect($obs()).toBe(0); // equal result: compared, not propagated
    expect(spy).toHaveBeenCalledTimes(1);
    $n.set(3);
    expect($obs()).toBe(3); // a changed result reaches the observer (an uninitialised write would not notify)
    expect(spy).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a first run that throws leaves the memo uninitialised: the next successful run stores its result', () => {
    const $ok = signal(false);
    const handler = vi.fn();
    let $c!: () => string;
    root(() => {
      onError(handler);
      $c = computed(
        () => {
          if (!$ok()) throw new Error('not yet');
          return 'ready';
        },
        { initial: 'fallback' },
      );
    });
    expect($c()).toBe('fallback');
    $ok.set(true);
    expect($c()).toBe('ready');
  });

  it('effect prev: undefined until the first successful compute, then the previous value', async () => {
    const $n = signal(0);
    const prevs: Array<number | undefined> = [];
    const handler = vi.fn();
    root(() => {
      onError(handler);
      createEffect(
        (prev: number | undefined) => {
          prevs.push(prev);
          const v = $n();
          if (v === 0) throw new Error('first fails');
          return v;
        },
        () => {},
      );
    });
    await flushMicrotasks();
    $n.set(1);
    await flushMicrotasks();
    $n.set(2);
    await flushMicrotasks();
    expect(prevs).toEqual([undefined, undefined, 1]);
  });
});

describe('error in compute: documented state (node CLEAN, previous value, retries on next change)', () => {
  it('an unhandled throw propagates to the reader; the node is CLEAN with its previous value', () => {
    const $n = signal(0);
    const spy = vi.fn(() => {
      const v = $n();
      if (v === 1) throw new Error('unhandled');
      return v * 10;
    });
    const $c = computed(spy);
    expect($c()).toBe(0);
    $n.set(1);
    expect(() => $c()).toThrow('unhandled');
    expect($c()).toBe(0); // CLEAN: no recompute, previous value
    expect(spy).toHaveBeenCalledTimes(2);
    $n.set(2);
    expect($c()).toBe(20);
  });

  it('sources read before the throw stay linked: a write to them retries the compute', () => {
    const $gate = signal(0);
    const $late = signal('a');
    const handler = vi.fn();
    let $c!: () => string;
    root(() => {
      onError(handler);
      $c = computed(() => {
        if ($gate() === 1) {
          const l = $late(); // read, then throw
          if (l === 'a') throw new Error('late a');
          return l;
        }
        return 'idle';
      });
    });
    expect($c()).toBe('idle');
    $gate.set(1);
    expect($c()).toBe('idle');
    $late.set('b'); // linked during the failed pass
    expect($c()).toBe('b');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('observers of a memo whose recompute throws are not notified and keep its old value', async () => {
    const $n = signal(1);
    const handler = vi.fn();
    const applied: number[] = [];
    root(() => {
      onError(handler);
      const $c = computed(() => {
        const v = $n();
        if (v === 2) throw new Error('two');
        return v;
      });
      createEffect(() => $c(), (v) => { applied.push(v); });
    });
    await flushMicrotasks();
    $n.set(2);
    await flushMicrotasks();
    $n.set(3);
    await flushMicrotasks();
    expect(applied).toEqual([1, 3]);
  });
});

// Stage-2 Part A: notify() used to call the effect scheduler while the node was still CLEAN, so a
// synchronous schedule ran an effect that computeNode() saw as clean (no compute, no apply), and
// the node was then marked DIRTY with no run booked — it never applied again.
const sync = (run: () => void) => run();

describe('a synchronous custom schedule', () => {
  it('runs the effect on every change: set twice → applied [0, 1, 2]', () => {
    const $s = signal(0);
    const applied: number[] = [];
    const compute = vi.fn(() => $s());
    const dispose = root((d) => {
      createEffect(compute, (v) => { applied.push(v); }, sync);
      return d;
    });
    expect(applied).toEqual([0]);
    $s.set(1);
    expect(applied).toEqual([0, 1]);
    $s.set(2);
    expect(applied).toEqual([0, 1, 2]);
    expect(compute).toHaveBeenCalledTimes(3);
    dispose();
    $s.set(3);
    expect(applied).toEqual([0, 1, 2]);
  });

  it('an effect behind a memo runs once per change and sees the settled memo value', () => {
    const $s = signal(1);
    const $m = computed(() => $s() * 10);
    const applied: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $m() + $s(), (v) => { applied.push(v); }, sync);
      return d;
    });
    $s.set(2);
    $s.set(3);
    expect(applied.at(-1)).toBe(33);
    expect(applied[0]).toBe(11);
    expect(applied).toContain(22);
    dispose();
  });

  it('an effect whose compute writes its own source is cut by the self-dirty guard (no stack overflow)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const $n = signal(0);
    let computes = 0;
    let dispose!: () => void;
    const create = () =>
      root((d) => {
        dispose = d;
        createEffect(() => { computes++; const v = $n(); $n.set(v + 1); return v; }, () => {}, sync, { name: 'self' });
      });
    expect(create).not.toThrow();
    // Cut every SELF_DIRTY_LIMIT (100) re-dirties; creation enters twice (first compute, first run).
    expect(computes).toBeGreaterThan(100);
    expect(computes).toBeLessThanOrEqual(2 * 101 + 1);
    const loops = err.mock.calls.map((c) => String(c[0])).filter((m) => /infinite loop/i.test(m));
    expect(loops.length).toBeGreaterThanOrEqual(1);
    expect(loops.length).toBeLessThanOrEqual(2);
    expect(loops.every((m) => m.includes('"self"') && m.includes('re-dirtied itself'))).toBe(true);
    dispose(); // the deferred runs find the node disposed
    const settled = computes;
    await new Promise((r) => setTimeout(r, 0));
    expect(computes).toBe(settled);
    err.mockRestore();
  });

  it('effects writing signals from a synchronous run propagate to other synchronous effects', () => {
    const $a = signal(0);
    const $b = signal(0);
    const seen: number[] = [];
    const dispose = root((d) => {
      createEffect(() => $a(), (v) => { $b.set(v * 10); }, sync);
      createEffect(() => $b(), (v) => { seen.push(v); }, sync);
      return d;
    });
    $a.set(1);
    $a.set(2);
    expect(seen).toEqual([0, 10, 20]);
    expect($b()).toBe(20);
    dispose();
  });
});
