// Core perf pass, stage 3: a pull or a notify walk aborted by a throw leaves nodes CHECK/DIRTY
// whose subscribers were not reached (the reader whose pull threw is CLEAN; a walk cut short by a
// throwing scheduler never visited the rest). Those nodes are marked F_UNSURE: the next walk that
// reaches them descends into their subscribers although they are already dirty. Pre-existing
// since the vendored maverick (995e983): an effect whose source threw two levels down never ran
// again when the source recovered. The flag is also what keeps the shallow marking of a recomputed
// memo's CHECK subscribers sound (notifySubs, stage 3).
import { computed, signal } from '../../src/core/signals';
import { root } from '../../src/core/core';
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
  const $k = signal(0); // makes the reader DIRTY, so the throwing pull happens inside its compute
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
  expect($r()).toBe(-1); // the reader handled the error: CLEAN, $m1 left CHECK
  $s.set(2); // reaches the reader only through $m2 → $m1
  expect($r()).toBe(20);
});

it('a walk cut short by a throwing scheduler: the next write through the dirty memo reaches the rest', () => {
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
  expect(() => $a.set(1)).toThrow('scheduler'); // the walk stops at the first effect
  flush();
  expect(seen).toEqual([[0], [0], [0]]);
  $b.set(1); // $m is already DIRTY: this walk must still reach all three
  flush();
  expect(seen).toEqual([[0, 2], [0, 2], [0, 2]]);
});

it('a recomputed memo marks its CHECK subscriber DIRTY without walking below it — unless that one was left unsure by an error', () => {
  // M1 = M2 + M3. E reads M1. M2 throws once: E's pull aborts, M1 stays CHECK, E is CLEAN (error
  // handled). Then M3 changes and another reader pulls M3 first: the result write reaches M1
  // (CHECK). A shallow mark would stop at M1 and E would never run again.
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
  root(() => createEffect(() => $m1(), (v) => { seen.push(v); }, schedule));
  const $other = computed(() => $m3() + 1);
  expect($other()).toBe(1);
  flush();
  $s.set(1);
  flush();
  expect(seen).toEqual([0]);
  $t.set(1);
  expect($other()).toBe(101); // recomputes M3 → its result write reaches M1 (CHECK)
  $s.set(0); // M2 recovers to its old value: no change from M2 itself
  flush();
  expect(seen).toEqual([0, 100]);
});
