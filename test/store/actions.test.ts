// Actions (spec §3.5 req. 5): typed plain functions, nested calls serialized FIFO, afterActions after the
// cascade, errors isolated, async actions re-read the live state, the DEV slow-update timer.
import { flushSync } from '../../src/index';
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
