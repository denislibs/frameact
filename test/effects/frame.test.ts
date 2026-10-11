import { createMeasureEffect, createMutationEffect, createRenderEffect, frameForcedReflow } from '../../src/core/frame';
import { createEffect } from '../../src/core/effects';
import { signal } from '../../src/core/signals';
import { root } from '../../src/core/core';
import { getPhase, flushSync } from '../../src/scheduler/fasterdom';
import { installFakeRaf } from '../helpers/raf';
import { frame } from '../helpers/frame';
import { flushMicrotasks } from '../helpers/micro';

let raf: ReturnType<typeof installFakeRaf>;
beforeEach(() => { raf = installFakeRaf(); });
afterEach(async () => {
  // Drain pending frames: fasterdom/fastRaf throttle state is module-global and leaks otherwise.
  for (let i = 0; i < 10 && raf.pending(); i++) { raf.frame(); await flushMicrotasks(); }
  raf.uninstall();
});

it('mutation effect: first apply is synchronous, later applies run in the mutate phase, coalesced per frame', async () => {
  const $a = signal(1);
  const applies: Array<[number, string]> = [];
  root(() => createMutationEffect(() => $a(), (v) => { applies.push([v, getPhase()]); }));
  expect(applies).toEqual([[1, 'measure']]); // detached-DOM creation happens wherever the owner runs
  $a.set(2); $a.set(3);
  expect(applies.length).toBe(1);
  expect(raf.pending()).toBe(1);
  await frame(raf);
  expect(applies).toEqual([[1, 'measure'], [3, 'mutate']]);
});

it('createRenderEffect is createMutationEffect', () => {
  expect(createRenderEffect).toBe(createMutationEffect);
});

it('measure effect: first apply is NOT synchronous; it runs in the measure phase of the next frame', async () => {
  const applies: string[] = [];
  root(() => createMeasureEffect(() => 1, () => { applies.push(getPhase()); }));
  expect(applies).toEqual([]);
  await frame(raf);
  expect(applies).toEqual(['measure']);
});

it('within one frame: measure applies before mutation applies, regardless of dirtying order', async () => {
  const $a = signal(0);
  const log: string[] = [];
  root(() => {
    createMutationEffect(() => $a(), (v) => { if (v) log.push('mutate'); });
    createMeasureEffect(() => $a(), (v) => { if (v) log.push('measure'); });
  });
  await frame(raf); // first measure apply (v=0)
  $a.set(1);
  await frame(raf);
  expect(log).toEqual(['measure', 'mutate']);
});

it('a signal written in a measure apply reaches a mutation effect in the same frame', async () => {
  const $h = signal(0);
  const applied: number[] = [];
  root(() => {
    createMutationEffect(() => $h(), (v) => { applied.push(v); });
    createMeasureEffect(() => 1, () => { $h.set(42); });
  });
  await frame(raf);
  expect(applied).toEqual([0, 42]);
});

it('a mutation effect dirtied during the mutate drain (from compute or apply) runs in the same drain', async () => {
  const $src = signal(0);
  const $derived = signal(0);
  const applied: number[] = [];
  root(() => {
    // like a mapArray row: reads a signal that another mutation effect's compute writes
    createMutationEffect(() => $derived(), (v) => { applied.push(v); });
    createMutationEffect(() => { const v = $src(); $derived.set(v * 10); return v; }, () => {});
  });
  $src.set(1);
  await frame(raf);
  expect(applied).toEqual([0, 10]);
});

it('a measure effect dirtied from the mutate phase runs next frame and warns in DEV', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const $x = signal(0);
  const measured: number[] = [];
  root(() => {
    createMeasureEffect(() => $x(), (v) => { measured.push(v); });
    createMutationEffect(() => 1, () => { $x.set(7); }); // runs synchronously now, phase is 'measure' → no warn
  });
  await frame(raf); // measure applies 7
  root(() => createMutationEffect(() => 2, () => { $x.set(8); })); // sync again; still outside mutate
  const $t = signal(0);
  root(() => createMutationEffect(() => $t(), (v) => { if (v) $x.set(9); }));
  $t.set(1);
  await frame(raf); // mutate apply writes $x → measure effect scheduled for the NEXT frame
  expect(measured).toEqual([7, 8]);
  expect(warn.mock.calls.some((c) => String(c[0]).includes('mutate phase'))).toBe(true);
  await frame(raf);
  expect(measured).toEqual([7, 8, 9]);
  warn.mockRestore();
});

it('frameForcedReflow applies after the mutate phase in the same frame', async () => {
  const log: string[] = [];
  const $a = signal(0);
  root(() => {
    createEffect(() => $a(), (v) => { if (v) log.push('reflow:' + getPhase()); }, frameForcedReflow);
    createMutationEffect(() => $a(), (v) => { if (v) log.push('mutate:' + getPhase()); });
  });
  await frame(raf);
  $a.set(1);
  await frame(raf);
  expect(log).toEqual(['mutate:mutate', 'reflow:measure']);
});

it('apply-cleanup of a mutation effect disposed outside the mutate phase is deferred to the mutate phase', async () => {
  const log: string[] = [];
  const dispose = root((d) => {
    createMutationEffect(() => 1, () => () => log.push('cleanup:' + getPhase()));
    return d;
  });
  dispose(); // phase is 'measure' here
  expect(log).toEqual([]);
  await frame(raf);
  expect(log).toEqual(['cleanup:mutate']);
});

it('apply-cleanup of a tickEnd effect runs inline on dispose', async () => {
  const log: string[] = [];
  const dispose = root((d) => { createEffect(() => 1, () => () => log.push('c')); return d; });
  await flushMicrotasks();
  dispose();
  expect(log).toEqual(['c']);
});

it('a mutation ping-pong loop is cut by the drain guard, reported, and finishes next frame', async () => {
  // Two effects feeding each other (not a self-write: the DEV self-dirty guard from Task 8 must not
  // be what stops it). Bounded so the test leaves no pending frame behind.
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $a = signal(0);
  const $b = signal(0);
  root(() => {
    createMutationEffect(() => $a(), (v) => { if (v < 5_100) $b.set(v + 1); });
    createMutationEffect(() => $b(), (v) => { $a.set(v); });
  });
  await frame(raf);
  expect(err.mock.calls.some((c) => String(c[0]).includes('drain limit'))).toBe(true);
  expect($a()).toBeLessThan(5_100);
  await frame(raf);   // overflow moved to this frame
  expect($a()).toBe(5_100);
  err.mockRestore();
});

it('flushSync runs pending frame effects synchronously', () => {
  const $a = signal(1);
  const applied: number[] = [];
  root(() => createMutationEffect(() => $a(), (v) => { applied.push(v); }));
  $a.set(2);
  flushSync();
  expect(applied).toEqual([1, 2]);
});
