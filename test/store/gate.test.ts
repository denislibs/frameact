// Cause-tagged parking through the public store API (spec §3.5 req. 6; the mechanics are covered at the
// core level in test/core/storeWalk.test.ts): a store-caused frame effect waits for its scope's animation,
// siblings do not, local changes never wait and read the current store, tickEnd logic is not gated,
// release re-runs exactly the stale readers, live()/ungated() bypass.
import {
  beginHeavyAnimation, createEffect, createHeavyAnimationScope, createMemo, createMutationEffect, createRoot,
  createSignal, flushSync, provideHeavyAnimationScope, type HeavyAnimationScope,
} from '../../src/index';
import { createStore, live, merge, ungated } from 'frameact/store';
import { useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

function inScope<T>(scope: HeavyAnimationScope, fn: () => T): T {
  return createRoot(() => {
    provideHeavyAnimationScope(scope);
    return fn();
  });
}

/** A mutation (frame) effect logging every compute. */
function view<T>(log: T[], fn: () => T) {
  createMutationEffect(() => {
    const v = fn();
    log.push(v);
    return v;
  }, () => {});
}

async function settle() {
  await flushMicrotasks();
  await frame();
}

it('a store update inside an animating scope waits for its end; a sibling scope does not; one run at release, in the next frame', async () => {
  const [state, setState] = createStore({ text: 'a' });
  const s1 = createHeavyAnimationScope();
  const s2 = createHeavyAnimationScope();
  const inside: string[] = [];
  const sibling: string[] = [];
  inScope(s1, () => view(inside, () => state.text));
  inScope(s2, () => view(sibling, () => state.text));
  const end = s1.begin(Infinity);
  try {
    setState('text', 'b');
    await settle();
    expect(sibling).toEqual(['a', 'b']);
    expect(inside).toEqual(['a']);
    expect(state.text).toBe('b'); // imperative read: current
  } finally {
    end();
  }
  expect(inside).toEqual(['a']); // not synchronously in end()
  await settle();
  expect(inside).toEqual(['a', 'b']);
});

it('event handlers and untracked reads see the current state during the animation', () => {
  const [state, setState] = createStore({ n: 0 });
  const scope = createHeavyAnimationScope();
  const seen: number[] = [];
  const btn = document.createElement('button');
  btn.addEventListener('click', () => seen.push(state.n));
  inScope(scope, () => view([], () => state.n));
  const end = scope.begin(Infinity);
  try {
    setState('n', 5);
    btn.click();
    expect(seen).toEqual([5]);
  } finally {
    end();
  }
});

it('tickEnd logic over the store is not gated (scope and global animations); frame effects are, by the global one too', async () => {
  const [state, setState] = createStore({ n: 0 });
  const scope = createHeavyAnimationScope();
  const tick: number[] = [];
  const frameLog: number[] = [];
  inScope(scope, () => {
    createEffect(() => state.n, (n) => { tick.push(n); });
    view(frameLog, () => state.n);
  });
  flushSync();
  const end = scope.begin(Infinity);
  try {
    setState('n', 1);
    await settle();
    expect(tick).toEqual([0, 1]);
    expect(frameLog).toEqual([0]);
  } finally {
    end();
  }
  await settle();
  const endGlobal = beginHeavyAnimation(Infinity);
  try {
    setState('n', 2);
    await settle();
    expect(tick).toEqual([0, 1, 2]);
    expect(frameLog).toEqual([0, 1]);
  } finally {
    endGlobal();
  }
  await settle();
  expect(frameLog).toEqual([0, 1, 2]);
});

it('a local signal is never gated; a mixed effect runs with the CURRENT store and is not re-run at release; release re-runs exactly the stale readers', async () => {
  const [state, setState] = createStore({ s: 'old', same: 0 });
  const [l, setL] = createSignal(0);
  const scope = createHeavyAnimationScope();
  const mixed: string[] = [];
  const stale: string[] = [];
  const untouched: number[] = [];
  inScope(scope, () => {
    view(mixed, () => `${state.s}/${l()}`);
    view(stale, () => state.s);
    view(untouched, () => state.same);
  });
  const end = scope.begin(Infinity);
  try {
    setState('s', 'new');
    await settle();
    expect(mixed).toEqual(['old/0']);
    setL(1);
    await settle();
    expect(mixed).toEqual(['old/0', 'new/1']);
    expect(stale).toEqual(['old']);
  } finally {
    end();
  }
  await settle();
  expect(mixed).toEqual(['old/0', 'new/1']);
  expect(stale).toEqual(['old', 'new']);
  expect(untouched).toEqual([0]);
});

it('no torn reads: a leaf and a shared memo over another leaf, written by one action, are seen from one moment', async () => {
  const [state, setState] = createStore({ a: 1, b: 1 });
  const [l, setL] = createSignal(0);
  const scope = createHeavyAnimationScope();
  const bx10 = createRoot(() => createMemo(() => state.b * 10)); // created OUTSIDE the scope, shared
  const outside: number[] = [];
  createRoot(() => view(outside, () => bx10()));
  const log: string[] = [];
  inScope(scope, () => view(log, () => `a=${state.a} b*10=${bx10()} l=${l()}`));
  const end = scope.begin(Infinity);
  try {
    setState(merge({ a: 2, b: 2 }));
    await settle();
    expect(outside).toEqual([10, 20]);
    expect(log).toEqual(['a=1 b*10=10 l=0']);
    setL(1);
    await settle();
    expect(log).toEqual(['a=1 b*10=10 l=0', 'a=2 b*10=20 l=1']);
  } finally {
    end();
  }
});

it('many writes during an animation collapse into one run with the last value; nested scopes: inner waits for outer too', async () => {
  const [state, setState] = createStore({ n: 0 });
  const outer = createHeavyAnimationScope();
  const inner = createHeavyAnimationScope(outer);
  const innerLog: number[] = [];
  const outerLog: number[] = [];
  inScope(outer, () => view(outerLog, () => state.n));
  inScope(inner, () => view(innerLog, () => state.n));
  const endInner = inner.begin(Infinity);
  for (let i = 1; i <= 100; i++) {
    setState('n', i);
    if (i % 10 === 0) await settle();
  }
  expect(outerLog.at(-1)).toBe(100);
  expect(innerLog).toEqual([0]);
  const endOuter = outer.begin(Infinity);
  setState('n', 101);
  await settle();
  endInner(); // released from inner, parks again on outer
  await settle();
  expect(innerLog).toEqual([0]);
  endOuter();
  await settle();
  expect(innerLog).toEqual([0, 101]);
});

it('live(): the reading computation never parks; a live memo relays to its readers', async () => {
  const [state, setState] = createStore({ draft: '' });
  const scope = createHeavyAnimationScope();
  const gated: string[] = [];
  const liveLog: string[] = [];
  const viaMemo: string[] = [];
  inScope(scope, () => {
    view(gated, () => state.draft);
    view(liveLog, () => live(() => state.draft));
    const m = createMemo(() => live(() => state.draft.toUpperCase()));
    view(viaMemo, () => m());
  });
  const end = scope.begin(Infinity);
  try {
    setState('draft', 'x');
    await settle();
    expect(liveLog).toEqual(['', 'x']);
    expect(viaMemo).toEqual(['', 'X']);
    expect(gated).toEqual(['']);
  } finally {
    end();
  }
  await settle();
  expect(gated).toEqual(['', 'x']);
});

it('ungated(): writes inside run their readers now, a parked reader of the written leaf included, reading every leaf current', async () => {
  const [state, setState] = createStore({ a: 0, b: 0 });
  const scope = createHeavyAnimationScope();
  const log: string[] = [];
  inScope(scope, () => view(log, () => `${state.a}/${state.b}`));
  const end = scope.begin(Infinity);
  try {
    setState('a', 1); // parked
    await settle();
    expect(log).toEqual(['0/0']);
    ungated(() => setState('b', 1));
    await settle();
    expect(log).toEqual(['0/0', '1/1']);
  } finally {
    end();
  }
  await settle();
  expect(log).toEqual(['0/0', '1/1']);
});

it('a parked effect disposed meanwhile is not run at release; blocking animations gate the store too', async () => {
  const [state, setState] = createStore({ n: 0 });
  const scope = createHeavyAnimationScope();
  const log: number[] = [];
  const dispose = createRoot((d) => {
    provideHeavyAnimationScope(scope);
    view(log, () => state.n);
    return d;
  });
  const end = scope.begin(Infinity);
  setState('n', 1);
  await settle();
  dispose();
  end();
  await settle();
  expect(log).toEqual([0]);

  const log2: number[] = [];
  inScope(scope, () => view(log2, () => state.n));
  const endBlocking = scope.begin(Infinity, true);
  setState('n', 2);
  await settle();
  expect(log2).toEqual([1]);
  endBlocking();
  await settle();
  expect(log2).toEqual([1, 2]);
});
