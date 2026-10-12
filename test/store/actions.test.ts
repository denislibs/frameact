// Actions (spec §3.5 req. 5): typed plain functions, nested calls serialized FIFO, afterActions after the
// cascade, errors isolated, async actions re-read the live state, the DEV slow-update timer.
import { createEffect, createRoot, flushSync } from '../../src/index';
import { afterActions, createStore, defineActions } from 'frameact/store';

it('typed plain-function actions; nested calls are serialized; afterActions runs after the cascade; errors are isolated; async actions read the live state', async () => {
  const [state, setState] = createStore({ log: [] as string[], n: 0 });
  const push = (s: string) => setState('log', (l) => [...l, s]);
  const actions = defineActions({
    outer(x: number) {
      afterActions(() => push('after-outer'));
      actions.inner('i'); // queued: runs after outer returns
      push(`outer:${x}`);
    },
    inner(tag: string) {
      push(`inner:${tag}`);
    },
    fail() {
      throw new Error('boom');
    },
    async later() {
      await Promise.resolve();
      setState('n', (n) => n + 1); // after await: the live state again (req. 4)
    },
    async rejects() {
      await Promise.resolve();
      throw new Error('late');
    },
  });
  actions.outer(1);
  expect(state.log).toEqual(['outer:1', 'inner:i', 'after-outer']);
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    actions.fail();
    actions.inner('still works');
    expect(spy).toHaveBeenCalledTimes(1);
    const settled = actions.rejects(); // an async action: a promise that never rejects
    expect(settled).toBeInstanceOf(Promise);
    await settled;
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }
  expect(state.log.at(-1)).toBe('inner:still works');
  const p: Promise<void> = actions.later();
  setState('n', 10);
  await p; // resolves after the action settled
  flushSync();
  expect(state.n).toBe(11);
  expect(actions.inner('sync')).toBeUndefined(); // a sync action returns void (no allocation)
  // @ts-expect-error — typed from the definition
  actions.inner(42);
  // @ts-expect-error — a sync definition returns void, not a promise
  const q: Promise<void> = actions.inner('a');
  void q;
});

it('afterActions inside an after-callback is queued behind it; an action dispatched from an after-callback runs in the same cascade before the remaining callbacks; afterActions outside a cascade runs at once', () => {
  const log: string[] = [];
  const actions = defineActions({
    a() {
      afterActions(() => {
        log.push('after1');
        afterActions(() => log.push('after2'));
        actions.b();
        log.push('after1-end');
      });
      afterActions(() => log.push('after3'));
      log.push('a');
    },
    b() {
      log.push('b');
    },
  });
  actions.a();
  expect(log).toEqual(['a', 'after1', 'after1-end', 'b', 'after3', 'after2']);
  afterActions(() => log.push('now'));
  expect(log.at(-1)).toBe('now');
});

it('DEV: a cascade longer than 7 ms is reported as a slow store update, naming the actions', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const now = vi.spyOn(performance, 'now');
  let t = 0;
  now.mockImplementation(() => (t += 10)); // each call advances the clock by 10 ms
  try {
    const actions = defineActions({ heavy() { actions.light(); }, light() {} });
    actions.heavy();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Slow store update: .* in heavy, light/));
  } finally {
    now.mockRestore();
    warn.mockRestore();
  }
});

it('a plain function that returns a promise (a thenable) returns a never-rejecting Promise<void> that resolves after it settled (final review I4)', async () => {
  const [state, setState] = createStore({ n: 0 });
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const actions = defineActions({
      load(): Promise<number> {
        return Promise.resolve().then(() => { setState('n', 5); return 5; });
      },
      fails(): Promise<void> {
        return Promise.reject(new Error('nope'));
      },
      thenable() {
        // oxlint-disable-next-line unicorn/no-thenable
        return { then: (ok: () => void) => { queueMicrotask(() => { setState('n', 7); ok(); }); } };
      },
      sync() {},
    });
    const p: Promise<void> = actions.load();
    expect(p).toBeInstanceOf(Promise);
    expect(state.n).toBe(0);
    await p;
    expect(state.n).toBe(5);
    await actions.fails();
    expect(spy).toHaveBeenCalledTimes(1);
    await (actions.thenable() as unknown as Promise<void>);
    expect(state.n).toBe(7);
    expect(actions.sync()).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

it('a nested call to a promise-returning plain function also returns a promise that resolves after it settled', async () => {
  const log: string[] = [];
  const actions = defineActions({
    outer() {
      void (actions.inner() as unknown as Promise<void>).then(() => log.push('inner-settled'));
      log.push('outer');
    },
    inner(): Promise<void> {
      log.push('inner');
      return Promise.resolve();
    },
  });
  actions.outer();
  await Promise.resolve();
  await Promise.resolve();
  expect(log).toEqual(['outer', 'inner', 'inner-settled']);
});

it('actions run untracked: reading the store inside an action called from an effect does not subscribe the effect (final review 16)', () => {
  const [state, setState] = createStore({ n: 0, other: 0 });
  const actions = defineActions({ peek() { return void state.n; } });
  let runs = 0;
  createRoot(() => {
    createEffect(() => { runs++; actions.peek(); return state.other; }, () => {});
  });
  flushSync();
  setState('n', 1);
  flushSync();
  expect(runs).toBe(1);
  setState('other', 1);
  flushSync();
  expect(runs).toBe(2);
});

it('afterActions: a throwing callback is reported and the queue goes on, inside a cascade and outside of it alike', () => {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const log: string[] = [];
    const actions = defineActions({
      a() {
        afterActions(() => { throw new Error('in-cascade'); });
        afterActions(() => log.push('next'));
      },
    });
    actions.a();
    expect(log).toEqual(['next']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(() => afterActions(() => { throw new Error('outside'); })).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(2);
  } finally {
    spy.mockRestore();
  }
});

it('a long queue drains in FIFO order', () => {
  const out: number[] = [];
  const actions = defineActions({
    fill() { for (let i = 0; i < 5000; i++) actions.push(i); },
    push(i: number) { out.push(i); },
  });
  actions.fill();
  expect(out.length).toBe(5000);
  expect(out.slice(0, 3)).toEqual([0, 1, 2]);
  expect(out.at(-1)).toBe(4999);
});

it('N3: a result whose `then` getter throws is reported and does not abort the cascade (a queued action still runs)', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const log: string[] = [];
  const actions = defineActions({
    outer() {
      actions.badThen();
      actions.later();
      log.push('outer');
    },
    badThen() {
      // oxlint-disable-next-line unicorn/no-thenable -- the point of the test
      return { get then(): never { throw new Error('getter'); } };
    },
    later() {
      log.push('later');
    },
  });
  expect(() => actions.outer()).not.toThrow();
  expect(log).toEqual(['outer', 'later']);
  expect(errorSpy).toHaveBeenCalled();
  expect(() => actions.badThen()).not.toThrow(); // as a top-level call too
  actions.later();
  expect(log).toEqual(['outer', 'later', 'later']);
  errorSpy.mockRestore();
});
