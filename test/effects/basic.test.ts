import { createEffect, NOT_APPLIED } from '../../src/core/effects';
import { computed, signal } from '../../src/core/signals';
import { root, onDispose } from '../../src/core/core';
import { flushMicrotasks } from '../helpers/micro';

it('compute runs synchronously at creation; apply runs on tickEnd with (value, prev)', async () => {
  const $a = signal(1);
  const computeSpy = vi.fn(() => $a() * 10);
  const apply = vi.fn();
  root(() => createEffect(computeSpy, apply));
  expect(computeSpy).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
  await flushMicrotasks();
  expect(apply).toHaveBeenCalledWith(10, undefined);

  $a.set(2);
  expect(apply).toHaveBeenCalledTimes(1); // nothing synchronous
  await flushMicrotasks();
  expect(apply).toHaveBeenLastCalledWith(20, 10);
});

it('does not apply when the compute result is unchanged', async () => {
  const $a = signal(1);
  const apply = vi.fn();
  root(() => createEffect(() => ($a() > 0 ? 'pos' : 'neg'), apply));
  await flushMicrotasks();
  $a.set(5);
  await flushMicrotasks();
  expect(apply).toHaveBeenCalledTimes(1);
});

it('apply cleanup runs before the next apply and on dispose; onDispose in compute runs before recompute', async () => {
  const $a = signal(0);
  const log: string[] = [];
  const dispose = root((d) => {
    createEffect(
      () => { onDispose(() => log.push('compute-cleanup')); return $a(); },
      (v) => { log.push('apply:' + v); return () => log.push('apply-cleanup:' + v); },
    );
    return d;
  });
  await flushMicrotasks();
  $a.set(1);
  await flushMicrotasks();
  expect(log).toEqual(['apply:0', 'compute-cleanup', 'apply-cleanup:0', 'apply:1']);
  dispose();
  expect(log.slice(-2)).toEqual(['compute-cleanup', 'apply-cleanup:1']);
});

it('apply cleanup does NOT run when a recompute yields the same value', async () => {
  const $a = signal(1);
  const log: string[] = [];
  root(() => createEffect(() => ($a() > 0 ? 'pos' : 'neg'), (v) => { log.push(v); return () => log.push('cleanup'); }));
  await flushMicrotasks();
  $a.set(2);
  await flushMicrotasks();
  expect(log).toEqual(['pos']);
});

it('an error in apply is reported, other effects still run, and the node recovers on the next change', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $a = signal(1);
  const second = vi.fn();
  root(() => {
    createEffect(() => $a(), (v) => { if (v === 1) throw new Error('boom'); });
    createEffect(() => $a(), second);
  });
  await flushMicrotasks();
  expect(err).toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith(1, undefined);
  $a.set(2);
  await flushMicrotasks();
  expect(second).toHaveBeenLastCalledWith(2, 1);
  err.mockRestore();
});

it('immediateApply (internal) applies synchronously at creation', () => {
  const apply = vi.fn();
  root(() => createEffect(() => 1, apply, undefined, { immediateApply: true }));
  expect(apply).toHaveBeenCalledWith(1, undefined);
});

it('a child effect bails while its parent effect is dirty; the parent recreates it exactly once', async () => {
  const $a = signal(1);
  const childCompute = vi.fn();
  const childApply = vi.fn();
  root(() => {
    createEffect(
      () => { const v = $a(); createEffect(() => { childCompute(); return $a(); }, childApply); return v; },
      () => {},
    );
  });
  await flushMicrotasks();
  expect(childCompute).toHaveBeenCalledTimes(1);
  $a.set(2);
  await flushMicrotasks();
  // parent recomputed → disposed old child → created a new one (compute #2). The old child never recomputed.
  expect(childCompute).toHaveBeenCalledTimes(2);
  expect(childApply).toHaveBeenLastCalledWith(2, undefined);
});

it('a bailed child is re-scheduled when its parent resolves CHECK without recomputing', async () => {
  const $a = signal(1);
  const $clamped = computed(() => Math.min($a(), 1)); // stays 1 for a ≥ 1
  const childApply = vi.fn();
  root(() => {
    createEffect(
      () => {
        createEffect(() => $a(), childApply); // child subscribes to $a BEFORE the parent reads $clamped
        return $clamped();
      },
      () => {},
    );
  });
  await flushMicrotasks();
  $a.set(2); // child notified first (bails: parent is CHECK), parent resolves clean, child must still apply
  await flushMicrotasks();
  expect(childApply).toHaveBeenLastCalledWith(2, 1);
});

it('a write to its own source inside compute re-schedules the effect until stable', async () => {
  // Self-writes start on a re-run (the effect only observes $n after its first compute).
  const $n = signal(0);
  const applied: number[] = [];
  root(() => createEffect(() => { const v = $n(); if (v >= 1 && v < 3) $n.set(v + 1); return v; }, (v) => { applied.push(v); }));
  await flushMicrotasks();
  expect(applied).toEqual([0]);
  $n.set(1);
  await flushMicrotasks(20);
  expect(applied.at(-1)).toBe(3);
});

it('DEV: an effect that re-dirties itself forever is stopped with an error', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $n = signal(0);
  const $go = signal(false);
  root(() => createEffect(() => { const v = $n(); if ($go()) $n.set(v + 1); return 0; }, () => {}));
  await flushMicrotasks();
  $go.set(true);
  await flushMicrotasks(400);
  expect(err.mock.calls.some((c) => String(c[0]).includes('infinite'))).toBe(true);
  err.mockRestore();
});

it('exposes NOT_APPLIED for the runtime', () => {
  expect(typeof NOT_APPLIED).toBe('symbol');
});
