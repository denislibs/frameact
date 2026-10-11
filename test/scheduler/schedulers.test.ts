import { fastRaf, onTickEnd, flushTickEnd, onIdle, throttleWith } from '../../src/scheduler/schedulers';
import { installFakeRaf } from '../helpers/raf';
import { flushMicrotasks } from '../helpers/micro';

let raf: ReturnType<typeof installFakeRaf>;
beforeEach(() => { raf = installFakeRaf(); });
afterEach(() => { raf.uninstall(); vi.useRealTimers(); });

describe('fastRaf', () => {
  it('batches callbacks into one requestAnimationFrame', () => {
    const calls: string[] = [];
    fastRaf(() => calls.push('a'));
    fastRaf(() => calls.push('b'));
    expect(raf.pending()).toBe(1);
    raf.frame();
    expect(calls).toEqual(['a', 'b']);
  });

  it('falls back to a 35ms timeout when rAF does not fire', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const cb = vi.fn();
    fastRaf(cb, true);
    vi.advanceTimersByTime(34);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
    raf.frame(); // the rAF fires later: callback must not run twice
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('onTickEnd', () => {
  it('batches into one microtask, in order', async () => {
    const calls: number[] = [];
    onTickEnd(() => calls.push(1));
    onTickEnd(() => calls.push(2));
    expect(calls).toEqual([]);
    await flushMicrotasks();
    expect(calls).toEqual([1, 2]);
  });

  it('flushTickEnd runs pending callbacks synchronously, once', async () => {
    const cb = vi.fn();
    onTickEnd(cb);
    flushTickEnd();
    expect(cb).toHaveBeenCalledTimes(1);
    await flushMicrotasks();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('onIdle', () => {
  it('falls back to onTickEnd when requestIdleCallback is missing (jsdom)', async () => {
    const cb = vi.fn();
    onIdle(cb);
    expect(cb).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('throttleWith', () => {
  it('runs once per scheduler tick with the latest args', () => {
    const scheduled: Array<() => void> = [];
    const fn = vi.fn();
    const throttled = throttleWith((cb) => scheduled.push(cb), fn);
    throttled(1); throttled(2); throttled(3);
    expect(scheduled.length).toBe(1);
    scheduled[0]();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });
});
