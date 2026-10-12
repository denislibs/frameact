import { debounce, fastRaf, onTickEnd, flushTickEnd, onIdle, throttleWith, throttleWithTickEnd } from '../../src/scheduler/schedulers';
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

describe('error isolation (I2)', () => {
  it('a throwing fastRaf callback does not drop the rest of the frame batch', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cb = vi.fn();
    fastRaf(() => { throw new Error('raf boom'); });
    fastRaf(cb);
    expect(() => raf.frame()).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('a throwing fastRaf callback does not drop the rest of the timeout-fallback batch', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cb = vi.fn();
    fastRaf(() => { throw new Error('fallback boom'); }, true);
    fastRaf(cb, true);
    expect(() => vi.advanceTimersByTime(35)).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
    raf.frame();
    err.mockRestore();
  });

  it('a throwing flushTickEnd callback does not drop the rest of the batch', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cb = vi.fn();
    onTickEnd(() => { throw new Error('tick boom'); });
    onTickEnd(cb);
    expect(() => flushTickEnd()).not.toThrow();
    expect(cb).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('a throwing onIdle callback does not drop the rest of the idle batch', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = globalThis as { requestIdleCallback?: unknown };
    const pending: Array<(d: { timeRemaining(): number }) => void> = [];
    g.requestIdleCallback = (fn: (d: { timeRemaining(): number }) => void) => { pending.push(fn); return 1; };
    try {
      const cb = vi.fn();
      onIdle(() => { throw new Error('idle boom'); });
      onIdle(cb);
      expect(() => pending.shift()!({ timeRemaining: () => 10 })).not.toThrow();
      expect(cb).toHaveBeenCalledTimes(1);
    } finally {
      delete g.requestIdleCallback;
      err.mockRestore();
    }
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

describe('debounce', () => {
  it('leading + trailing by default; (true, false) fires once and ignores repeats for the window; the window restarts per call', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const both = vi.fn();
    const d = debounce(both, 100);
    d(1);
    d(2);
    expect(both).toHaveBeenCalledTimes(1);
    expect(both).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(99);
    d(3); // restarts the window
    vi.advanceTimersByTime(99);
    expect(both).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(both).toHaveBeenCalledTimes(2);
    expect(both).toHaveBeenLastCalledWith(3);

    const first = vi.fn();
    const loadMore = debounce(first, 1000, true, false);
    loadMore();
    loadMore();
    vi.advanceTimersByTime(1000);
    expect(first).toHaveBeenCalledTimes(1);
    loadMore();
    expect(first).toHaveBeenCalledTimes(2);
  });
});

describe('debounce: a single call (N6)', () => {
  it('with the default (true, true) one call runs fn exactly once — the leading edge, no trailing repeat (lodash semantics; teact would run it twice)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a');
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);
    d('b', 'c'); // the next wait opens a fresh leading call
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b', 'c');
    d('d'); // a second call in the wait owes the trailing one
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).toHaveBeenLastCalledWith('d');
  });
});

describe('throttleWithTickEnd', () => {
  it('runs once per tick with the last arguments', async () => {
    const fn = vi.fn();
    const t = throttleWithTickEnd(fn);
    t(1);
    t(2);
    expect(fn).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });
});
