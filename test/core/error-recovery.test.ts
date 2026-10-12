// Core perf pass, stage 3 + review fix round 1: error recovery. An error never freezes part of the
// graph: a memo whose compute threw (unhandled) holds the error — every read rethrows it, in
// whichever phase it was recomputed — and recovering (even to the old value) is a change for its
// readers; a node whose compute threw recomputes on its next check (F_THREW); the first good result
// after a failed first run reaches the readers that saw the failure. A pull or walk aborted by an
// unexpected throw marks the unverified nodes F_UNSURE (safety net; the shallow marking of a
// recomputed memo's CHECK subscribers relies on it). Pre-existing since the vendored maverick
// (995e983): an effect whose source threw two levels down never ran again when it recovered.
import { computed, signal } from '../../src/core/signals';
import { F_UNSURE, getScope, onError, root, STATE_CLEAN } from '../../src/core/core';
import type { Computation } from '../../src/core/types';
import { createEffect, type Schedule } from '../../src/core/effects';

function queue() {
  const q: (() => void)[] = [];
  const schedule: Schedule = (run) => {
    q.push(run);
  };
  const flush = () => {
    while (q.length) q.shift()!();
  };
  return { schedule, flush };
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

it('an effect whose source threw two levels down runs again when the source recovers', () => {
  const { schedule, flush } = queue();
  const $s = signal(0);
  const $m2 = computed(() => {
    if ($s() === 1) throw new Error('boom');
    return $s();
  });
  const $m1 = computed(() => $m2() * 10);
  const seen: number[] = [];
  root(() => createEffect(() => $m1(), (v) => { seen.push(v); }, schedule));
  flush();
  $s.set(1);
  flush();
  expect(seen).toEqual([0]);
  expect(errorSpy).toHaveBeenCalled();
  $s.set(2);
  flush();
  expect(seen).toEqual([0, 20]);
});

it('a memo that caught a throwing read two levels down recomputes when the source recovers', () => {
  const $s = signal(0);
  const $k = signal(0); // (makes the reader DIRTY: the throwing pull happens inside its compute)
  const $m2 = computed(() => {
    if ($s() === 1) throw new Error('boom');
    return $s();
  });
  const $m1 = computed(() => $m2() * 10);
  const $r = computed(() => {
    $k();
    try {
      return $m1();
    } catch {
      return -1;
    }
  });
  expect($r()).toBe(0);
  $s.set(1);
  $k.set(1);
  expect($r()).toBe(-1); // the reader handled the error
  $s.set(2); // reaches the reader only through $m2 → $m1
  expect($r()).toBe(20);
});

it('a throwing scheduler is reported; the walk goes on, and that effect re-runs on its next change (review Minor 6)', () => {
  const { schedule, flush } = queue();
  let armed = false;
  const throwing: Schedule = (run, node) => {
    if (armed) {
      armed = false;
      throw new Error('scheduler');
    }
    schedule(run, node);
  };
  const $a = signal(0);
  const $b = signal(0);
  const $m = computed(() => $a() + $b());
  const seen: number[][] = [[], [], []];
  root(() => {
    // subscribed first: the walk from $m visits it before the other two
    createEffect(() => $m(), (v) => { seen[0].push(v); }, throwing);
    createEffect(() => $m(), (v) => { seen[1].push(v); }, schedule);
    createEffect(() => $m(), (v) => { seen[2].push(v); }, schedule);
  });
  flush();
  armed = true;
  expect(() => $a.set(1)).not.toThrow(); // the writer does not get another effect's scheduler error
  expect(errorSpy).toHaveBeenCalled();
  flush();
  // The walk reached the other two; the first one, back to CLEAN, was reached again by $m's
  // result write when the others pulled $m (a CLEAN subscriber gets a full notify).
  expect(seen).toEqual([[0, 1], [0, 1], [0, 1]]);
  $b.set(1);
  flush();
  expect(seen).toEqual([[0, 1, 2], [0, 1, 2], [0, 1, 2]]);
});

it('a scheduler throwing during a memo result write is not that memo compute error', () => {
  const { schedule, flush } = queue();
  let armed = false;
  const throwing: Schedule = (run, node) => {
    if (armed) {
      armed = false;
      throw new Error('scheduler');
    }
    schedule(run, node);
  };
  const $s = signal(0);
  const $m = computed(() => $s() * 2);
  const handled: unknown[] = [];
  let effect!: Computation;
  root(() => {
    onError((e) => { handled.push(e); });
    createEffect(() => {
      effect = getScope() as Computation;
      return $m();
    }, () => {}, throwing);
  });
  flush();
  $s.set(1); // the walk marks the effect CHECK and books its run
  // White-box: a subscriber that is CLEAN when the memo's update() writes its result gets a full
  // notify — its scheduler then runs inside that update() (re-entry by a synchronous effect is the
  // natural way there). Simulate it.
  effect._state = STATE_CLEAN;
  armed = true;
  expect($m()).toBe(2); // the memo is fine whatever its subscribers' schedulers do
  expect(handled).toEqual([]); // and its owner's onError did not get the scheduler's error
  expect(errorSpy).toHaveBeenCalled(); // (reported as the effect's)
});

it('while a dep holds an error, the reader catching it keeps its fallback; recovery brings the other input in', () => {
  // M1 = M2 + M3, E reads M1 (catching). M2 throws: M1 holds the error (its run stopped at M2, so
  // it no longer reads M3); M3 changes meanwhile. When M2 recovers to its old value, M1 recomputes
  // (it was errored) and picks up M3's change.
  const { schedule, flush } = queue();
  const $s = signal(0);
  const $t = signal(0);
  const $m2 = computed(() => {
    if ($s() === 1) throw new Error('boom');
    return $s();
  });
  const $m3 = computed(() => $t() * 100);
  const $m1 = computed(() => $m2() + $m3());
  const seen: number[] = [];
  root(() =>
    createEffect(() => {
      try {
        return $m1();
      } catch {
        return -1;
      }
    }, (v) => { seen.push(v); }, schedule),
  );
  const $other = computed(() => $m3() + 1);
  expect($other()).toBe(1);
  flush();
  $t.set(1);
  $s.set(1);
  flush();
  expect(seen).toEqual([0, -1]);
  expect($other()).toBe(101);
  flush();
  expect(seen).toEqual([0, -1]);
  $s.set(0);
  flush();
  expect(seen).toEqual([0, -1, 100]);
});

it('shallow marking: a computing reader that consumed the memo was latched by the walk that made it CHECK', () => {
  const $s = signal(0);
  const $y = computed(() => $s());
  const $x = computed(() => $y() + 1);
  const $w = computed(() => $y() * 2);
  let wrote = false;
  const spy = vi.fn(() => {
    const a = $x(); // consumed
    if (!wrote) {
      wrote = true;
      $s.set(5); // walk: $y DIRTY → $x CHECK → this compute (computing, latched)
      $w(); // pulls $y: its result write reaches $x (CHECK) — marked DIRTY without a walk below
    }
    return a;
  });
  const $z = computed(spy);
  expect($z()).toBe(1); // the run that wrote returns what it read; it is re-dirtied (latched)
  expect($z()).toBe(6);
  expect(spy).toHaveBeenCalledTimes(2);
  expect($z()).toBe(6);
  expect(spy).toHaveBeenCalledTimes(2);
  expect($w()).toBe(10);
});

/** P1/P1b graph: an effect reads a throwing branch ($s1 → $y1 → $x1) and a healthy one. */
function setupP1() {
  const q = queue();
  const $s1 = signal(0);
  const $s2 = signal(0);
  const $y1 = computed(() => {
    if ($s1() === 1) throw new Error('boom');
    return $s1();
  });
  const $y2 = computed(() => $s2());
  const $x1 = computed(() => $y1() * 10);
  const $x2 = computed(() => $y2() * 100);
  const seen: number[] = [];
  root(() => createEffect(() => $x1() + $x2(), (v) => { seen.push(v); }, q.schedule));
  return { ...q, $s1, $s2, $y2, seen };
}

describe('stage-3 review, P1/P1b: an error in one branch does not blind the reader to the other', () => {
  // (Under the stage-3 code the effect's pull aborted with $x2/$y2 left dirty and unmarked: the
  // effect never heard from that branch again — HEAD [0] where 5d60063 gave [0, 100].)
  it('P1: another reader pulls the healthy branch while the effect is errored; recovery to the old value applies both', () => {
    const { flush, $s1, $s2, $y2, seen } = setupP1();
    const $r = computed(() => $y2() + 1);
    $r();
    flush();
    $s1.set(1);
    $s2.set(1);
    flush(); // the effect's compute gets $x1's error
    expect(seen).toEqual([0]);
    $r(); // recomputes $y2
    flush();
    expect(seen).toEqual([0]);
    $s1.set(0); // back to the old value: $y1 and $x1 were errored, so this is a change
    flush();
    expect(seen).toEqual([0, 100]);
  });

  it('P1b: the healthy source changes again while the effect is errored; recovery applies the latest', () => {
    const { flush, $s1, $s2, seen } = setupP1();
    flush();
    $s1.set(1);
    $s2.set(1);
    flush();
    expect(seen).toEqual([0]);
    $s2.set(2);
    flush();
    expect(seen).toEqual([0]);
    $s1.set(0);
    flush();
    expect(seen).toEqual([0, 200]);
  });
});

describe('stage-3 review, Important 2: a node whose compute threw re-runs on its next check', () => {
  it('a memo whose run threw (another input had changed) recomputes when the thrower recovers to its old value', () => {
    const $o = signal('a');
    const $s = signal(0);
    const $t = computed(() => {
      if ($s() === 1) throw new Error('boom');
      return $s();
    });
    const spy = vi.fn(() => $o() + $t());
    const $r = computed(spy);
    expect($r()).toBe('a0');
    $o.set('b');
    $s.set(1);
    expect(() => $r()).toThrow('boom'); // read 'b', then $t threw: $r keeps 'a0'
    $s.set(0); // $t recovers to its old value: no change seen through $t
    expect($r()).toBe('b0');
    expect($r()).toBe('b0');
    expect(spy).toHaveBeenCalledTimes(3); // no extra run once it succeeded
  });

  it('an effect whose compute threw re-runs its compute on the next check', () => {
    const { schedule, flush } = queue();
    const $o = signal(1);
    const $s = signal(0);
    const $t = computed(() => {
      if ($s() === 1) throw new Error('boom');
      return $s();
    });
    const seen: number[] = [];
    root(() => createEffect(() => $o() * 10 + $t(), (v) => { seen.push(v); }, schedule));
    flush();
    $o.set(2);
    $s.set(1);
    flush();
    expect(seen).toEqual([10]);
    $s.set(0);
    flush();
    expect(seen).toEqual([10, 20]);
  });
});

it('stage-3 review, Important 3 (P2): the first successful result of a memo whose first run threw reaches its readers', () => {
  const { schedule, flush } = queue();
  const $s = signal(1);
  const $t = computed(() => {
    if ($s() === 1) throw new Error('boom');
    return $s();
  });
  const $m = computed(() => {
    try {
      return $t() * 10;
    } catch {
      return -1;
    }
  });
  const seen: number[] = [];
  root(() => createEffect(() => $m(), (v) => { seen.push(v); }, schedule));
  flush();
  expect(seen).toEqual([-1]);
  $s.set(2); // $t's first successful run: 2 (it never had a value before)
  flush();
  expect(seen).toEqual([-1, 20]);
});

describe('a memo whose compute threw (unhandled) holds the error: every read rethrows it until it recomputes', () => {
  it('a reader catching errors in its compute gets the error of a dep even when the dep is pulled in the check phase', () => {
    const $s = signal(0);
    const $m2 = computed(() => {
      if ($s() === 1) throw new Error('boom');
      return $s();
    });
    const $m1 = computed(() => $m2() * 10);
    const $r = computed(() => {
      try {
        return $m1();
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect($r()).toBe(0);
    $s.set(1); // $r is only CHECK: $m2 is recomputed while $r's deps are verified
    expect($r()).toBe('boom');
    $s.set(2);
    expect($r()).toBe(20);
  });

  it('every reader sees the error, not only the one whose pull ran the throwing compute', () => {
    const $s = signal(0);
    const $t = computed(() => {
      if ($s() === 1) throw new Error('boom');
      return $s();
    });
    const $a = computed(() => $t() + 1);
    const $b = computed(() => $t() + 2);
    expect([$a(), $b()]).toEqual([1, 2]);
    $s.set(1);
    expect(() => $a()).toThrow('boom');
    expect(() => $b()).toThrow('boom');
    expect(() => $t()).toThrow('boom');
    $s.set(0); // recovers to its old value: the readers saw an error, so they hear about it
    expect([$a(), $b(), $t()]).toEqual([1, 2, 0]);
  });

  it('an effect catching errors in its compute gets the fallback, not an effect error', () => {
    const { schedule, flush } = queue();
    const $s = signal(0);
    const $m2 = computed(() => {
      if ($s() === 1) throw new Error('boom');
      return $s();
    });
    const $m1 = computed(() => $m2() * 10);
    const seen: unknown[] = [];
    root(() =>
      createEffect(() => {
        try {
          return $m1();
        } catch {
          return 'fallback';
        }
      }, (v) => { seen.push(v); }, schedule),
    );
    flush();
    $s.set(1);
    flush();
    $s.set(2);
    flush();
    expect(seen).toEqual([0, 'fallback', 20]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('an error handled by onError is not held: readers keep the last value', () => {
    const $s = signal(0);
    const handled: unknown[] = [];
    let $t!: () => number;
    root(() => {
      onError((e) => { handled.push((e as Error).message); });
      $t = computed(() => {
        if ($s() === 1) throw new Error('boom');
        return $s();
      });
    });
    expect($t()).toBe(0);
    $s.set(1);
    expect($t()).toBe(0);
    expect(handled).toEqual(['boom']);
  });
});

it('review Minor 5: F_UNSURE does not stick to a node that resolved CLEAN or was descended into', () => {
  // White-box: the flag only arises from an unexpected throw (a safety net); set it by hand.
  const $s = signal(0);
  const $a = computed(() => $s() * 0); // never changes
  const $m = computed(() => $a() + 1);
  expect($m()).toBe(1);
  $s.set(1); // $a DIRTY, $m CHECK
  const m = $m.node!;
  m._flags |= F_UNSURE;
  expect($m()).toBe(1); // $a recomputes to the same value: $m resolves CLEAN without a run
  expect(m._flags & F_UNSURE).toBe(0);
  m._flags |= F_UNSURE;
  $s.set(2); // marking a CLEAN node descends anyway: the flag goes
  expect(m._flags & F_UNSURE).toBe(0);
});
