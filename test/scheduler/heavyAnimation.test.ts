import {
  createHeavyAnimationScope, rootScope, beginHeavyAnimation, getIsHeavyAnimating,
  getIsBlockingAnimating, firstAnimatingScope, onHeavyAnimation, onFullyIdle,
  provideHeavyAnimationScope, currentHeavyAnimationScope, listenerCountOf,
} from '../../src/scheduler/heavyAnimation';
import { watchHeavyAnimation } from '../../src/core/lifecycle';
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

it('C1c: a throwing onStart listener does not break begin(); the animation still ends', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const scope = createHeavyAnimationScope();
  const off = onHeavyAnimation(() => { throw new Error('start boom'); }, undefined, scope);
  let end: (() => void) | undefined;
  try { end = scope.begin(1000, true); } finally { off(); }
  expect(scope.isAnimating.peek()).toBe(true);
  expect(scope.isBlockingAnimating.peek()).toBe(true);
  end!();
  expect(scope.isAnimating.peek()).toBe(false);
  expect(scope.isBlockingAnimating.peek()).toBe(false);
  expect(err).toHaveBeenCalled();
  err.mockRestore();
});

it('C1: once-callbacks are isolated from each other', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const scope = createHeavyAnimationScope();
  const second = vi.fn();
  const end = scope.begin(1000, false);
  scope.isAnimating.once(() => { throw new Error('first'); });
  scope.isAnimating.once(second);
  expect(() => end()).not.toThrow();
  expect(second).toHaveBeenCalledTimes(1);
  err.mockRestore();
});


describe('M3: begin() durations', () => {
  it('NaN auto-ends after the default 1 s', () => {
    vi.useFakeTimers();
    const scope = createHeavyAnimationScope();
    scope.begin(Number.NaN, true);
    vi.advanceTimersByTime(999);
    expect(scope.isBlockingAnimating.peek()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(scope.isBlockingAnimating.peek()).toBe(false);
    expect(scope.isAnimating.peek()).toBe(false);
  });

  it('a negative duration auto-ends after the default 1 s', () => {
    vi.useFakeTimers();
    const scope = createHeavyAnimationScope();
    scope.begin(-5);
    vi.advanceTimersByTime(999);
    expect(scope.isAnimating.peek()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(scope.isAnimating.peek()).toBe(false);
  });

  it('a non-number duration auto-ends after the default 1 s', () => {
    vi.useFakeTimers();
    const scope = createHeavyAnimationScope();
    scope.begin('500' as unknown as number);
    vi.advanceTimersByTime(999);
    expect(scope.isAnimating.peek()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(scope.isAnimating.peek()).toBe(false);
  });

  it('only Infinity is manual: it stays until end()', () => {
    vi.useFakeTimers();
    const scope = createHeavyAnimationScope();
    const end = scope.begin(Infinity, true);
    vi.advanceTimersByTime(10_000_000);
    expect(scope.isBlockingAnimating.peek()).toBe(true);
    end();
    expect(scope.isBlockingAnimating.peek()).toBe(false);
  });

  it('a huge finite duration is clamped to the timer maximum instead of firing immediately', () => {
    vi.useFakeTimers();
    const scope = createHeavyAnimationScope();
    const end = scope.begin(3e10);
    vi.advanceTimersByTime(1000);
    expect(scope.isAnimating.peek()).toBe(true);
    vi.advanceTimersByTime(2 ** 31 - 1);
    expect(scope.isAnimating.peek()).toBe(false);
    end();
  });
});

describe('a listener on a scope hears the chain (scope → parent → … → root), as gating does', () => {
  it('an ancestor animation starts it once, and it ends only when the whole chain is idle', () => {
    const parent = createHeavyAnimationScope(null);
    const child = createHeavyAnimationScope(parent);
    const log: string[] = [];
    const off = onHeavyAnimation(() => log.push('start'), () => log.push('end'), child);
    const endParent = parent.begin(Infinity, true);
    expect(log).toEqual(['start']);
    const endChild = child.begin(Infinity);
    expect(log).toEqual(['start']); // already animating through the parent: no second start
    endParent();
    expect(log).toEqual(['start']); // the child still animates
    endChild();
    expect(log).toEqual(['start', 'end']);
    off();
    parent.begin(Infinity, true)();
    expect(log).toEqual(['start', 'end']); // unsubscribed from every scope of the chain
  });

  it('fires onStart at once when an ancestor already animates, and a sibling scope is not heard', () => {
    const parent = createHeavyAnimationScope(null);
    const child = createHeavyAnimationScope(parent);
    const sibling = createHeavyAnimationScope(parent);
    const end = parent.begin(Infinity);
    const onStart = vi.fn(), onEnd = vi.fn();
    const off = onHeavyAnimation(onStart, onEnd, child);
    expect(onStart).toHaveBeenCalledTimes(1);
    end();
    expect(onEnd).toHaveBeenCalledTimes(1);
    sibling.begin(Infinity)();
    expect(onStart).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('onHeavyAnimation is reentrant: subscribing or unsubscribing inside a notification keeps the chain state exact', () => {
  it('a listener subscribed from another listener\'s onStart (same scope) gets its onEnd', () => {
    const scope = createHeavyAnimationScope(null);
    const log: string[] = [];
    let off2: (() => void) | undefined;
    const off1 = onHeavyAnimation(() => {
      log.push('L1 start');
      off2 ??= onHeavyAnimation(() => log.push('L2 start'), () => log.push('L2 end'), scope);
    }, () => log.push('L1 end'), scope);
    scope.begin(Infinity)();
    expect(log).toEqual(['L1 start', 'L2 start', 'L1 end', 'L2 end']);
    log.length = 0;
    scope.begin(Infinity)();
    expect(log).toEqual(['L1 start', 'L2 start', 'L1 end', 'L2 end']);
    off1();
    off2!();
  });

  it('a child-scope listener subscribed during the parent\'s start notification gets its onEnd', () => {
    const parent = createHeavyAnimationScope(null);
    const child = createHeavyAnimationScope(parent);
    const log: string[] = [];
    let offChild: (() => void) | undefined;
    const offParent = onHeavyAnimation(() => {
      offChild ??= onHeavyAnimation(() => log.push('child start'), () => log.push('child end'), child);
    }, undefined, parent);
    parent.begin(Infinity)();
    expect(log).toEqual(['child start', 'child end']);
    offParent();
    offChild!();
  });

  it('a listener subscribed from onEnd hears the next animations', () => {
    const scope = createHeavyAnimationScope(null);
    const log: string[] = [];
    let off2: (() => void) | undefined;
    const off1 = onHeavyAnimation(undefined, () => {
      off2 ??= onHeavyAnimation(() => log.push('start'), () => log.push('end'), scope);
    }, scope);
    scope.begin(Infinity)();
    expect(log).toEqual([]);
    scope.begin(Infinity)();
    scope.begin(Infinity)();
    expect(log).toEqual(['start', 'end', 'start', 'end']);
    off1();
    off2!();
  });

  it('a listener subscribed from isAnimating.once (runs before the listeners) starts once and ends', () => {
    const scope = createHeavyAnimationScope(null);
    const log: string[] = [];
    let off: (() => void) | undefined;
    scope.isAnimating.once(() => {
      off = onHeavyAnimation(() => log.push('start'), () => log.push('end'), scope);
    });
    scope.begin(Infinity)();
    expect(log).toEqual(['start', 'end']);
    off!();
  });

  it('a listener that unsubscribes itself from onStart or onEnd is not called again', () => {
    const scope = createHeavyAnimationScope(null);
    const log: string[] = [];
    const offA = onHeavyAnimation(() => { log.push('A start'); offA(); }, () => log.push('A end'), scope);
    const offB = onHeavyAnimation(() => log.push('B start'), () => { log.push('B end'); offB(); }, scope);
    scope.begin(Infinity)();
    scope.begin(Infinity)();
    expect(log).toEqual(['A start', 'B start', 'B end']);
  });

  it('nested begin/end on several ancestors: one start, one end when the whole chain is idle', () => {
    const grand = createHeavyAnimationScope(null);
    const parent = createHeavyAnimationScope(grand);
    const child = createHeavyAnimationScope(parent);
    const log: string[] = [];
    const off = onHeavyAnimation(() => log.push('start'), () => log.push('end'), child);
    const endGrand = grand.begin(Infinity, true);
    const endParent = parent.begin(Infinity);
    const endChild = child.begin(Infinity);
    const endParent2 = parent.begin(Infinity);
    endParent();
    endChild();
    endGrand();
    expect(log).toEqual(['start']);
    endParent2();
    expect(log).toEqual(['start', 'end']);
    off();
  });
});

it('the root keeps no listener of a nested scope after the unsubscribe or the owner\'s disposal', () => {
  const baseline = listenerCountOf(rootScope);
  const nested = createHeavyAnimationScope(); // parent: root
  const leaf = createHeavyAnimationScope(nested);
  const off = onHeavyAnimation(undefined, undefined, leaf);
  expect(listenerCountOf(rootScope)).toBe(baseline + 1);
  expect(listenerCountOf(nested)).toBe(1);
  off();
  expect([listenerCountOf(rootScope), listenerCountOf(nested), listenerCountOf(leaf)]).toEqual([baseline, 0, 0]);
  let dispose!: () => void;
  root((d) => {
    dispose = d;
    provideHeavyAnimationScope(leaf);
    for (let i = 0; i < 3; i++) watchHeavyAnimation(() => {}, () => {});
  });
  expect([listenerCountOf(rootScope), listenerCountOf(nested), listenerCountOf(leaf)]).toEqual([baseline + 3, 3, 3]);
  dispose();
  expect([listenerCountOf(rootScope), listenerCountOf(nested), listenerCountOf(leaf)]).toEqual([baseline, 0, 0]);
});
