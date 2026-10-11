import {
  createHeavyAnimationScope, rootScope, beginHeavyAnimation, getIsHeavyAnimating,
  getIsBlockingAnimating, firstAnimatingScope, onHeavyAnimation, onFullyIdle,
  provideHeavyAnimationScope, currentHeavyAnimationScope,
} from '../../src/scheduler/heavyAnimation';
import { root } from '../../src/core/core';
import { flushMicrotasks } from '../helpers/micro';

afterEach(() => { vi.useRealTimers(); });

it('counts nested begins and ends once', () => {
  const end1 = beginHeavyAnimation();
  const end2 = beginHeavyAnimation(1000, true);
  expect(getIsHeavyAnimating.peek()).toBe(true);
  expect(getIsBlockingAnimating.peek()).toBe(true);
  end1(); end1(); // idempotent
  expect(getIsHeavyAnimating.peek()).toBe(true);
  end2();
  expect(getIsHeavyAnimating.peek()).toBe(false);
  expect(getIsBlockingAnimating.peek()).toBe(false);
});

it('auto-ends after the duration', () => {
  vi.useFakeTimers();
  beginHeavyAnimation(300);
  vi.advanceTimersByTime(299);
  expect(getIsHeavyAnimating.peek()).toBe(true);
  vi.advanceTimersByTime(1);
  expect(getIsHeavyAnimating.peek()).toBe(false);
});

it('once fires on the next change only, and callbacks added during the flush wait for the next one', () => {
  const scope = createHeavyAnimationScope();
  const log: string[] = [];
  const end = scope.begin(1000, true);
  scope.isBlockingAnimating.once(() => {
    log.push('first');
    scope.isBlockingAnimating.once(() => log.push('second'));
  });
  end();
  expect(log).toEqual(['first']);         // 'second' did not run inside the same flush
  const end2 = scope.begin(1000, true);
  expect(log).toEqual(['first', 'second']); // it ran on the next change (→ true)
  end2();
});

it('firstAnimatingScope walks the parent chain up to root', () => {
  const outer = createHeavyAnimationScope();
  const inner = createHeavyAnimationScope(outer);
  expect(firstAnimatingScope(inner, true)).toBeNull();
  const end = outer.begin(1000, true);
  expect(firstAnimatingScope(inner, true)).toBe(outer);
  expect(firstAnimatingScope(inner, false)).toBe(outer);
  end();
  const endRoot = beginHeavyAnimation(1000, true);
  expect(firstAnimatingScope(inner, true)).toBe(rootScope);
  endRoot();
});

it('onHeavyAnimation reports start/end and unsubscribes', () => {
  const scope = createHeavyAnimationScope();
  const onStart = vi.fn(), onEnd = vi.fn();
  const off = onHeavyAnimation(onStart, onEnd, scope);
  const end = scope.begin();
  expect(onStart).toHaveBeenCalledTimes(1);
  end();
  expect(onEnd).toHaveBeenCalledTimes(1);
  off();
  scope.begin()();
  expect(onStart).toHaveBeenCalledTimes(1);
});

it('onFullyIdle waits for the animation to end (no polling)', async () => {
  const scope = createHeavyAnimationScope();
  const cb = vi.fn();
  const end = scope.begin();
  onFullyIdle(cb, scope);
  await flushMicrotasks(); // jsdom has no requestIdleCallback → onTickEnd
  expect(cb).not.toHaveBeenCalled();
  end();
  await flushMicrotasks();
  expect(cb).toHaveBeenCalledTimes(1);
});

it('provide/current scope via owner context', () => {
  const scope = createHeavyAnimationScope();
  root(() => {
    expect(currentHeavyAnimationScope()).toBe(rootScope);
    provideHeavyAnimationScope(scope);
    expect(currentHeavyAnimationScope()).toBe(scope);
    root(() => expect(currentHeavyAnimationScope()).toBe(scope)); // inherited by children
  });
});
