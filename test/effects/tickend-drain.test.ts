// tickEnd loop guard: "a cascade is one drain until empty". The guard counts an effect's runs per
// flushTickEnd drain (not per macrotask), so high-frequency work driven by external writes (many
// flushSync() calls, a for-await over resolved promises) is never mistaken for a loop, while a
// self-sustaining cascade is still cut every TICK_LIMIT runs and yields to the event loop.
import { createEffect, type Schedule } from '../../src/core/effects';
import { signal } from '../../src/core/signals';
import { root } from '../../src/core/core';
import { flushSync } from '../../src/core/flush';
import { flushTickEnd, getTickDrainEpoch, onTickEnd } from '../../src/scheduler/schedulers';
import { installFakeRaf } from '../helpers/raf';
import { flushMicrotasks } from '../helpers/micro';

let raf: ReturnType<typeof installFakeRaf>;
beforeEach(() => { raf = installFakeRaf(); });
afterEach(() => { raf.uninstall(); vi.restoreAllMocks(); });

/** A fully synchronous custom scheduler (test 7). */
const sync: Schedule = (run) => run();
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const loopErrors = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((c) => String(c[0])).filter((m) => /infinite loop/i.test(m));

describe('flushTickEnd drains until empty', () => {
  it('callbacks queued while flushing run in the same flush', () => {
    const calls: string[] = [];
    onTickEnd(() => {
      calls.push('a');
      onTickEnd(() => {
        calls.push('b');
        onTickEnd(() => calls.push('c'));
      });
    });
    flushTickEnd();
    expect(calls).toEqual(['a', 'b', 'c']);
  });

  it('a throwing callback queued mid-flush does not drop the ones queued after it', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    onTickEnd(() => {
      onTickEnd(() => { throw new Error('nested boom'); });
      onTickEnd(after);
    });
    expect(() => flushTickEnd()).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('nested enqueues while flushing do not schedule extra microtask flushes', async () => {
    flushTickEnd(); // start from an empty queue (module setup may have queued work)
    const spy = vi.spyOn(Promise, 'resolve'); // onTickEnd books its microtask with Promise.resolve().then
    onTickEnd(() => { onTickEnd(() => {}); onTickEnd(() => {}); });
    const fromEnqueue = spy.mock.calls.length; // the one microtask booked on empty → non-empty
    flushTickEnd();
    const afterFlush = spy.mock.calls.length;
    spy.mockRestore();
    expect(fromEnqueue).toBe(1);
    expect(afterFlush).toBe(fromEnqueue);
    await flushMicrotasks(); // the already-scheduled microtask finds an empty queue
  });

  it('the drain epoch advances once per outermost drain: not for nested flushes, not for empty ones', () => {
    const start = getTickDrainEpoch();
    flushTickEnd(); // nothing pending
    expect(getTickDrainEpoch()).toBe(start);
    const seen: number[] = [];
    onTickEnd(() => {
      seen.push(getTickDrainEpoch());
      onTickEnd(() => seen.push(getTickDrainEpoch()));
      flushTickEnd(); // re-entrant: runs the pending callback, same epoch
      seen.push(getTickDrainEpoch());
    });
    flushTickEnd();
    expect(seen).toEqual([start + 1, start + 1, start + 1]);
    onTickEnd(() => seen.push(getTickDrainEpoch()));
    flushTickEnd();
    expect(seen.at(-1)).toBe(start + 2);
  });
});

it('1: a for-await loop of external writes is not a loop', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $v = signal(0);
  const applied: number[] = [];
  const dispose = root((d) => { createEffect(() => $v(), (v) => { applied.push(v); }, undefined, { name: 'reader' }); return d; });
  await flushMicrotasks();
  for (let i = 1; i <= 1000; i++) {
    $v.set(i);
    await Promise.resolve();
  }
  await flushMicrotasks();
  expect(err).not.toHaveBeenCalled();
  expect(applied.at(-1)).toBe(1000);
  expect(applied.length).toBeGreaterThanOrEqual(1000); // each step its own drain: nothing coalesced away
  dispose();
});

it('2: repeated flushSync() calls in one macrotask are not a loop', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $v = signal(0);
  const applied: number[] = [];
  const dispose = root((d) => { createEffect(() => $v(), (v) => { applied.push(v); }, undefined, { name: 'reader' }); return d; });
  flushSync();
  for (let i = 1; i <= 1000; i++) {
    $v.set(i);
    flushSync();
  }
  expect(err).not.toHaveBeenCalled();
  expect(applied.at(-1)).toBe(1000);
  expect(applied.length).toBe(1001);
  dispose();
});

it('3: a mutual loop is caught, named, and does not starve the event loop', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const LIMIT = 20_000; // safety bound: an unguarded loop stops here instead of hanging the test
  const $a = signal(0);
  const $b = signal(0);
  const $go = signal(false);
  const dispose = root((d) => {
    createEffect(() => [$go(), $a()] as const, ([go, v]) => { if (go && v < LIMIT) $b.set(v + 1); }, undefined, { name: 'A' });
    createEffect(() => $b(), (v) => { if (v) $a.set(v + 1); }, undefined, { name: 'B' });
    return d;
  });
  await flushMicrotasks();
  let atSentinel = -1;
  const sentinel = new Promise<void>((resolve) => setTimeout(() => { atSentinel = $a(); resolve(); }, 0));
  $go.set(true);
  await sentinel;
  expect(atSentinel).toBeGreaterThan(0);
  expect(atSentinel).toBeLessThan(LIMIT); // the sentinel ran while the loop was still going
  for (let i = 0; i < 3; i++) await macrotask();
  expect($a()).toBeGreaterThan(atSentinel); // ... and the loop keeps going between macrotasks
  const loops = loopErrors(err);
  expect(loops.length).toBeGreaterThan(0);
  expect(loops.some((m) => /"A"|"B"/.test(m))).toBe(true);
  dispose();
});

it('4: a self loop via compute is caught by the per-drain counter only — one report per drain', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $n = signal(0);
  const $go = signal(false);
  const dispose = root((d) => {
    createEffect(() => { const v = $n(); if ($go()) $n.set(v + 1); return 0; }, () => {}, undefined, { name: 'self' });
    return d;
  });
  await flushMicrotasks();
  $go.set(true);
  const N = 10;
  for (let i = 0; i < N; i++) await macrotask();
  const loops = loopErrors(err);
  // One drain per macrotask, one report per drain (the self-dirty guard does not double-count).
  expect(loops.length).toBeGreaterThanOrEqual(N - 1);
  expect(loops.length).toBeLessThanOrEqual(N + 1);
  expect(loops.every((m) => m.includes('"self"') && /tickEnd drain/.test(m))).toBe(true);
  dispose();
});

it('5: a cascade completes in the same microtask flush that started it', async () => {
  const $a = signal(0);
  const $b = signal(0);
  const seenByB: number[] = [];
  const dispose = root((d) => {
    createEffect(() => $a(), (v) => { $b.set(v * 10); });
    createEffect(() => $b(), (v) => { seenByB.push(v); });
    return d;
  });
  await flushMicrotasks();
  $a.set(1);
  let atSentinel: number | undefined;
  await Promise.resolve().then(() => { atSentinel = seenByB.at(-1); });
  expect(atSentinel).toBe(10);
  dispose();
});

it('6: a bounded legit cascade of depth 50 is applied in one drain, without a report', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const DEPTH = 50;
  const sigs = Array.from({ length: DEPTH + 1 }, () => signal(0));
  const dispose = root((d) => {
    for (let i = 0; i < DEPTH; i++) createEffect(() => sigs[i](), (v) => { sigs[i + 1].set(v); });
    return d;
  });
  await flushMicrotasks();
  const before = getTickDrainEpoch();
  sigs[0].set(7);
  let atSentinel = -1;
  await Promise.resolve().then(() => { atSentinel = sigs[DEPTH](); });
  expect(atSentinel).toBe(7);
  expect(getTickDrainEpoch()).toBe(before + 1);
  expect(err).not.toHaveBeenCalled();
  dispose();
});

it('7: a custom synchronous scheduler with a self-writing effect is still stopped by the self-dirty guard', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $n = signal(0);
  let applies = 0;
  let dispose: (() => void) | undefined;
  // A synchronous scheduler runs the effect from inside the write. Every apply writes the effect's
  // own source: write → notify (node DIRTY) → schedule → run → compute → apply → write ... — a
  // recursion only the self-dirty guard cuts.
  const create = () =>
    root((d) => {
      dispose = d;
      createEffect(() => $n(), () => { applies++; $n.set($n() + 1); }, sync, { name: 'sync' });
    });
  expect(create).not.toThrow(); // no stack overflow
  expect(applies).toBeGreaterThan(100);
  expect(applies).toBeLessThan(200);
  const loops = loopErrors(err);
  expect(loops.length).toBe(1);
  expect(loops[0]).toContain('"sync"');
  expect(loops[0]).toContain('re-dirtied itself');
  dispose!(); // the guard defers the next run to a macrotask: stop it here
  await macrotask();
});
