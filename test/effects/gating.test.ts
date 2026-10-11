import { createMeasureEffect, createMutationEffect, createIdleEffect, gateOnHeavyAnimation, deferUntilIdle } from '../../src/core/frame';
import { createEffect, tickEnd } from '../../src/core/effects';
import { signal } from '../../src/core/signals';
import { root } from '../../src/core/core';
import {
  beginHeavyAnimation, createHeavyAnimationScope, onHeavyAnimation, provideHeavyAnimationScope, rootScope,
} from '../../src/scheduler/heavyAnimation';
import { getPhase, requestMeasure } from '../../src/scheduler/fasterdom';
import { installFakeRaf } from '../helpers/raf';
import { frame } from '../helpers/frame';
import { flushMicrotasks } from '../helpers/micro';

let raf: ReturnType<typeof installFakeRaf>;
beforeEach(() => { raf = installFakeRaf(); });
afterEach(async () => {
  for (let i = 0; i < 10 && raf.pending(); i++) { raf.frame(); await flushMicrotasks(); }
  raf.uninstall();
});

it('blocking animation parks frame effects; release lands them in ONE following frame, measure before mutate, in order', async () => {
  const $a = signal(0);
  const log: string[] = [];
  root(() => {
    createMutationEffect(() => $a(), (v) => { if (v) log.push('m1'); });
    createMeasureEffect(() => $a(), (v) => { if (v) log.push('r1'); });
    createMutationEffect(() => $a(), (v) => { if (v) log.push('m2'); });
  });
  await frame(raf);
  const end = beginHeavyAnimation(1000, true);
  $a.set(1);
  await frame(raf);
  expect(log).toEqual([]);
  end();                      // nothing runs synchronously in the end callback
  expect(log).toEqual([]);
  await frame(raf);
  expect(log).toEqual(['r1', 'm1', 'm2']);
});

it('the gate is sampled per drain: an applier that starts a blocking animation does not split the frame', async () => {
  const $a = signal(0);
  const log: string[] = [];
  let end!: () => void;
  root(() => {
    createMutationEffect(() => $a(), (v) => { if (v) { log.push('a'); end = beginHeavyAnimation(1000, true); } });
    createMutationEffect(() => $a(), (v) => { if (v) log.push('b'); });
  });
  $a.set(1);
  await frame(raf);
  expect(log).toEqual(['a', 'b']);
  end();
});

it('one once-subscription per scope, parked entries are released through requestMeasure', async () => {
  const $a = signal(0);
  const applied = vi.fn();
  root(() => { for (let i = 0; i < 50; i++) createMutationEffect(() => $a(), applied); });
  const once = vi.spyOn(rootScope.isBlockingAnimating, 'once');
  const end = beginHeavyAnimation(1000, true);
  $a.set(1);
  await frame(raf);
  expect(once).toHaveBeenCalledTimes(1);
  expect(rootScope._releaseArmed).toBe(true);
  end();
  expect(rootScope._releaseArmed).toBe(false);
  await frame(raf);
  expect(applied).toHaveBeenCalledTimes(100); // 50 sync first applies + 50 released
  once.mockRestore();
});

it('an effect disposed while parked is dropped at release', async () => {
  const $a = signal(0);
  const applied = vi.fn();
  const dispose = root((d) => { createMutationEffect(() => $a(), applied); return d; });
  const end = beginHeavyAnimation(1000, true);
  $a.set(1);
  await frame(raf);
  dispose();
  end();
  await frame(raf);
  expect(applied).toHaveBeenCalledTimes(1);
});

it('a released applier that starts a new blocking animation re-parks the rest without looping', async () => {
  const $a = signal(0);
  const log: string[] = [];
  let end2!: () => void;
  root(() => {
    createMutationEffect(() => $a(), (v) => { if (v) { log.push('x'); end2 = beginHeavyAnimation(1000, true); } });
    createMutationEffect(() => $a(), (v) => { if (v) log.push('y'); });
  });
  const end1 = beginHeavyAnimation(1000, true);
  $a.set(1);
  await frame(raf);
  end1();
  await frame(raf);
  expect(log).toEqual(['x', 'y']); // same drain: gate sampled before x ran
  end2();
  await frame(raf);
  expect(log).toEqual(['x', 'y']);
});

it('scopes: an effect under a blocking scope waits; a sibling outside does not; nested waits for outer', async () => {
  const outer = createHeavyAnimationScope();
  const inner = createHeavyAnimationScope(outer);
  const $a = signal(0);
  const log: string[] = [];
  root(() => {
    createMutationEffect(() => $a(), (v) => { if (v) log.push('free'); });
    root(() => { provideHeavyAnimationScope(outer); createMutationEffect(() => $a(), (v) => { if (v) log.push('outer'); }); });
    root(() => { provideHeavyAnimationScope(inner); createMutationEffect(() => $a(), (v) => { if (v) log.push('inner'); }); });
  });
  const end = outer.begin(1000, true);
  $a.set(1);
  await frame(raf);
  expect(log).toEqual(['free']);
  end();
  await frame(raf);
  expect(log).toEqual(['free', 'outer', 'inner']);
});

it('tickEnd effects are never gated', async () => {
  const $a = signal(0);
  const applied = vi.fn();
  root(() => createEffect(() => $a(), applied));
  await flushMicrotasks(); // let the deferred first apply (0) run before the animation
  const end = beginHeavyAnimation(1000, true);
  $a.set(1);
  await flushMicrotasks();
  expect(applied).toHaveBeenLastCalledWith(1, 0);
  end();
});

it('gateOnHeavyAnimation(tickEnd) waits for a NON-blocking animation in the node scope, even when created at module level', async () => {
  const gated = gateOnHeavyAnimation(tickEnd); // module-level: scope comes from the node
  const scope = createHeavyAnimationScope();
  const $a = signal(0);
  const applied = vi.fn();
  root(() => { provideHeavyAnimationScope(scope); createEffect(() => $a(), applied, gated); });
  await flushMicrotasks();
  const end = scope.begin(1000, false);
  $a.set(1);
  await flushMicrotasks();
  expect(applied).toHaveBeenCalledTimes(1);
  end();
  await flushMicrotasks();
  expect(applied).toHaveBeenLastCalledWith(1, 0);
});

it('createIdleEffect runs when idle and not animating', async () => {
  const applied = vi.fn();
  const end = beginHeavyAnimation(1000, false);
  root(() => createIdleEffect(() => 1, applied));
  await flushMicrotasks();
  expect(applied).not.toHaveBeenCalled();
  end();
  await flushMicrotasks();
  expect(applied).toHaveBeenCalledWith(1, undefined);
});

it('deferUntilIdle returns the placeholder until the scope is idle, then memoizes fn()', async () => {
  const scope = createHeavyAnimationScope();
  const fn = vi.fn(() => 'content');
  let content!: () => string;
  const end = scope.begin(1000, false);
  root(() => { content = deferUntilIdle(scope, fn, 'placeholder'); });
  expect(content()).toBe('placeholder');
  await flushMicrotasks();
  expect(content()).toBe('placeholder');
  end();
  await flushMicrotasks();
  expect(content()).toBe('content');
  expect(content()).toBe('content');
  expect(fn).toHaveBeenCalledTimes(1);
  expect(getPhase()).toBe('measure');
});

it('a scope that ends mid-drain does not strand its later parked entries', async () => {
  const S = createHeavyAnimationScope();
  const $a = signal(0);
  const log: string[] = [];
  let endS!: () => void;
  root(() => {
    root(() => { provideHeavyAnimationScope(S); createMutationEffect(() => $a(), (v) => { if (v) log.push('g1'); }); });
    createMutationEffect(() => $a(), (v) => { if (v) { log.push('free'); endS(); } });
    root(() => { provideHeavyAnimationScope(S); createMutationEffect(() => $a(), (v) => { if (v) log.push('g2'); }); });
  });
  endS = S.begin(1000, true);
  $a.set(1);
  await frame(raf);
  await frame(raf);
  expect(log).toContain('free');
  expect(log).toContain('g1');
  expect(log).toContain('g2');
  expect(S._parked.length).toBe(0);
  expect(S._releaseArmed).toBe(false);
});

it('release lands measure before mutate even when a measure drain is already armed', async () => {
  const $a = signal(0);
  const $b = signal(0);
  const log: string[] = [];
  root(() => {
    createMeasureEffect(() => $a(), (v) => { if (v) log.push('r1'); });
    createMutationEffect(() => $a(), (v) => { if (v) log.push('m1'); });
    createMeasureEffect(() => $b(), (v) => { if (v) log.push('r2'); });
  });
  await frame(raf);
  const end = beginHeavyAnimation(1000, true);
  $a.set(1);
  await frame(raf);
  expect(log).toEqual([]);
  requestMeasure(() => $b.set(1));
  end();
  await frame(raf);
  expect(log).toContain('r1');
  expect(log).toContain('m1');
  expect(log.indexOf('r1')).toBeLessThan(log.indexOf('m1'));
  await frame(raf);
  expect(log).toContain('r2');
});

it('an entry released from an inner scope re-parks on the still-blocking outer scope', async () => {
  const outer = createHeavyAnimationScope();
  const inner = createHeavyAnimationScope(outer);
  const $a = signal(0);
  const log: string[] = [];
  root(() => { provideHeavyAnimationScope(inner); createMutationEffect(() => $a(), (v) => { if (v) log.push('x'); }); });
  const endOuter = outer.begin(1000, true);
  const endInner = inner.begin(1000, true);
  $a.set(1);
  await frame(raf);
  endInner();
  await frame(raf);
  await frame(raf);
  expect(log).toEqual([]);
  endOuter();
  await frame(raf);
  expect(log).toEqual(['x']);
});

it('if arming the release throws, the entry runs once and is not left parked', async () => {
  const S = createHeavyAnimationScope();
  const $a = signal(0);
  const applied = vi.fn();
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  root(() => { provideHeavyAnimationScope(S); createMutationEffect(() => $a(), applied); });
  const once = vi.spyOn(S.isBlockingAnimating, 'once').mockImplementation(() => { throw new Error('boom'); });
  const end = S.begin(1000, true);
  $a.set(1);
  await frame(raf);
  expect(applied).toHaveBeenCalledTimes(2); // sync first apply + one ungated fallback run
  expect(S._parked.length).toBe(0);
  expect(S._releaseArmed).toBe(false);
  once.mockRestore();
  err.mockRestore();
  end();
});

// C1 (final review): a throwing heavy-animation callback must not freeze frame work.
it('C1a: a throwing onHeavyAnimation end listener does not leave the scope blocking; parked work applies next frame', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $a = signal(0);
  const applied = vi.fn();
  root(() => createMutationEffect(() => $a(), applied));
  const off = onHeavyAnimation(undefined, () => { throw new Error('listener boom'); });
  const end = beginHeavyAnimation(1000, true);
  $a.set(1);
  await frame(raf);
  expect(applied).toHaveBeenCalledTimes(1); // parked
  try { end(); } finally { off(); }
  expect(rootScope.isAnimating.peek()).toBe(false);
  expect(rootScope.isBlockingAnimating.peek()).toBe(false);
  await frame(raf);
  expect(applied).toHaveBeenLastCalledWith(1, 0);
  expect(err.mock.calls.some((c) => String(c[0]).includes('heavy-animation callback failed'))).toBe(true);
  err.mockRestore();
});

it('C1b: a throwing user once-callback registered before the release does not strand parked entries', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const $a = signal(0);
  const applied = vi.fn();
  root(() => createMutationEffect(() => $a(), applied));
  const end = beginHeavyAnimation(1000, true);
  rootScope.isBlockingAnimating.once(() => { throw new Error('once boom'); });
  $a.set(1);
  await frame(raf); // parks; the release `once` is registered after the user's
  end();
  expect(rootScope._releaseArmed).toBe(false);
  await frame(raf);
  expect(applied).toHaveBeenLastCalledWith(1, 0);
  expect(err.mock.calls.some((c) => String(c[0]).includes('heavy-animation callback failed'))).toBe(true);
  err.mockRestore();
});
