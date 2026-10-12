// Cause-tagged parking at the core level (spec §3.5 req. 6), over bare leaves (helpers/storeLeaf.ts):
// store walks tag, plain walks untag and descend, frame effects park, tickEnd effects never do,
// live readers are relayed, release re-books exactly the parked ones. Task 6 repeats the headline
// cases through the public store API.
import {
  beginHeavyAnimation, createEffect, createHeavyAnimationScope, createMemo, createMutationEffect, createRoot,
  createSignal, flushSync, provideHeavyAnimationScope, type HeavyAnimationScope,
} from '../../src/index';
import { markLiveRead } from '../../src/core/core';
import { leaf } from './helpers/storeLeaf';
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

it('a store-caused frame effect inside an animating scope parks; a sibling scope runs; release books one run into the next frame', async () => {
  const text = leaf('a');
  const s1 = createHeavyAnimationScope();
  const s2 = createHeavyAnimationScope();
  const inside: string[] = [];
  const sibling: string[] = [];
  inScope(s1, () => view(inside, () => text.get()));
  inScope(s2, () => view(sibling, () => text.get()));
  const end = s1.begin(Infinity);
  try {
    text.set('b');
    await settle();
    expect(sibling).toEqual(['a', 'b']);
    expect(inside).toEqual(['a']);
    expect(text.get()).toBe('b'); // imperative read: current
  } finally {
    end();
  }
  expect(inside).toEqual(['a']); // not synchronously inside end()
  await settle();
  expect(inside).toEqual(['a', 'b']);
});

it('tickEnd effects are not gated by the store, under a scope animation and under the global one; frame effects are', async () => {
  const n = leaf(0);
  const scope = createHeavyAnimationScope();
  const tick: number[] = [];
  const frameLog: number[] = [];
  inScope(scope, () => {
    createEffect(() => n.get(), (v) => { tick.push(v); });
    view(frameLog, () => n.get());
  });
  flushSync();
  const end = scope.begin(Infinity);
  try {
    n.set(1);
    await settle();
    expect(tick).toEqual([0, 1]);
    expect(frameLog).toEqual([0]);
  } finally {
    end();
  }
  await settle();
  expect(frameLog).toEqual([0, 1]);
  const endGlobal = beginHeavyAnimation(Infinity);
  try {
    n.set(2);
    await settle();
    expect(tick).toEqual([0, 1, 2]);
    expect(frameLog).toEqual([0, 1]);
  } finally {
    endGlobal();
  }
  await settle();
  expect(frameLog).toEqual([0, 1, 2]);
});

it('plain-signal updates are never gated; a mixed effect runs on the local change with the current store and is not re-run at release', async () => {
  const s = leaf('old');
  const [l, setL] = createSignal(0);
  const scope = createHeavyAnimationScope();
  const log: string[] = [];
  inScope(scope, () => view(log, () => `${s.get()}/${l()}`));
  const end = scope.begin(Infinity);
  try {
    s.set('new');
    await settle();
    expect(log).toEqual(['old/0']);
    setL(1);
    await settle();
    expect(log).toEqual(['old/0', 'new/1']);
  } finally {
    end();
  }
  await settle();
  expect(log).toEqual(['old/0', 'new/1']); // it was not stale any more: exactly the stale readers re-run
});

it('mixed memo already dirtied by a store walk: the plain change descends through it and unparks the effect', async () => {
  const s = leaf(1);
  const [l, setL] = createSignal(100);
  const scope = createHeavyAnimationScope();
  const log: number[] = [];
  let memoRuns = 0;
  inScope(scope, () => {
    const m = createMemo(() => {
      memoRuns++;
      return s.get() + l();
    });
    view(log, () => m());
  });
  const end = scope.begin(Infinity);
  try {
    s.set(2);
    await settle();
    expect(log).toEqual([101]);
    expect(memoRuns).toBe(1); // parked: the memo is not even pulled
    setL(200);
    await settle();
    expect(log).toEqual([101, 202]);
  } finally {
    end();
  }
  await settle();
  expect(log).toEqual([101, 202]);
});

it('no torn reads: a leaf and a shared memo over another leaf (pulled meanwhile by an outside reader) are seen from one moment', async () => {
  const a = leaf(1);
  const b = leaf(1);
  const [l, setL] = createSignal(0);
  const scope = createHeavyAnimationScope();
  const bx10 = createRoot(() => createMemo(() => b.get() * 10)); // created OUTSIDE the scope, shared
  const outside: number[] = [];
  createRoot(() => view(outside, () => bx10()));
  const log: string[] = [];
  inScope(scope, () => view(log, () => `a=${a.get()} b*10=${bx10()} l=${l()}`));
  const end = scope.begin(Infinity);
  try {
    a.set(2);
    b.set(2);
    await settle();
    expect(outside).toEqual([10, 20]); // the outside reader pulled the shared memo during the animation
    expect(log).toEqual(['a=1 b*10=10 l=0']); // still parked: the memo's store-caused result write did not wake it
    setL(1);
    await settle();
    expect(log).toEqual(['a=1 b*10=10 l=0', 'a=2 b*10=20 l=1']);
  } finally {
    end();
  }
});

it('a memo recomputed for a plain reason writes its result as a plain walk: store-only readers below it run now', async () => {
  const s = leaf(1);
  const [l, setL] = createSignal(1);
  const scope = createHeavyAnimationScope();
  const log: number[] = [];
  inScope(scope, () => {
    const sum = createMemo(() => s.get() + l());
    view(log, () => sum());
  });
  const end = scope.begin(Infinity);
  try {
    s.set(2); // store-only: parked at run time
    await settle();
    expect(log).toEqual([2]);
    setL(2); // plain: descends through the memo, unparks, the effect reads s = 2 too
    await settle();
    expect(log).toEqual([2, 4]);
  } finally {
    end();
  }
});

it('live relay: a memo marked live is re-delivered by a plain walk after the store walk; its readers never park', async () => {
  const draft = leaf('');
  const scope = createHeavyAnimationScope();
  const gated: string[] = [];
  const liveLog: string[] = [];
  inScope(scope, () => {
    view(gated, () => draft.get());
    const m = createMemo(() => {
      markLiveRead();
      return draft.get().toUpperCase();
    });
    view(liveLog, () => m());
  });
  const end = scope.begin(Infinity);
  try {
    draft.set('x');
    await settle();
    expect(liveLog).toEqual(['', 'X']);
    expect(gated).toEqual(['']);
  } finally {
    end();
  }
  await settle();
  expect(gated).toEqual(['', 'x']);
});

it('ancestor rule: a plain change below a parked ancestor effect runs the ancestor first (as a plain run) and the child after it', async () => {
  const msg = leaf<{ text: string } | null>({ text: 'hi' });
  const [hover, setHover] = createSignal(false);
  const scope = createHeavyAnimationScope();
  const parentLog: string[] = [];
  const childLog: string[] = [];
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a); });
  try {
    inScope(scope, () => {
      createMutationEffect(() => {
        const m = msg.get();
        parentLog.push(m ? m.text : 'null');
        if (m) createMutationEffect(() => { const v = `${msg.get()!.text}:${hover()}`; childLog.push(v); return v; }, () => {});
        return m;
      }, () => {});
    });
    const end = scope.begin(Infinity);
    try {
      msg.set({ text: 'new' });
      await settle();
      expect(parentLog).toEqual(['hi']); // parked
      setHover(true); // the child is plain-dirty, its ancestor is parked
      await settle();
      expect(parentLog).toEqual(['hi', 'new']); // the ancestor ran first…
      expect(childLog).toEqual(['hi:false', 'new:true']); // …the recreated child shows the local change now
      msg.set(null);
      await settle();
      setHover(false);
      await settle();
      expect(parentLog).toEqual(['hi', 'new', 'null']); // the child was disposed by the ancestor's run: never read null.text
    } finally {
      end();
    }
    await settle();
    expect(errors).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

it('ancestor rule: a plain child run booked BEFORE its ancestor parks still runs now — the ancestor loses its store tag and runs plain', async () => {
  const msg = leaf({ text: 'hi' });
  const [hover, setHover] = createSignal(false);
  const scope = createHeavyAnimationScope();
  const parentLog: string[] = [];
  const childLog: string[] = [];
  inScope(scope, () => {
    createMutationEffect(() => {
      const m = msg.get();
      parentLog.push(m.text);
      createMutationEffect(() => { const v = `${hover()}`; childLog.push(v); return v; }, () => {});
      return m;
    }, () => {});
  });
  const end = scope.begin(Infinity);
  try {
    setHover(true); // the child is booked first…
    msg.set({ text: 'new' }); // …then the ancestor, store-caused: the child bails onto it before it parks
    await settle();
    expect(parentLog).toEqual(['hi', 'new']);
    expect(childLog).toEqual(['false', 'true']);
  } finally {
    end();
  }
});

it('sampling: a scope begun mid-drain does not split the frame even while an unrelated scope animates; an inner scope that ended mid-drain does not hide the outer one', async () => {
  const n = leaf(0);
  const unrelated = createHeavyAnimationScope();
  const x = createHeavyAnimationScope();
  let endX: (() => void) | undefined;
  const log: number[] = [];
  createRoot(() => createMutationEffect(() => n.get(), (v) => { if (v === 1) endX = x.begin(Infinity); })); // an applier outside X
  inScope(x, () => view(log, () => n.get()));
  const endUnrelated = unrelated.begin(Infinity);
  try {
    n.set(1);
    await settle();
    expect(endX).toBeDefined();
    expect(log).toEqual([0, 1]); // same drain, after X began: not parked
  } finally {
    endUnrelated();
    endX?.();
  }
  await settle();

  const outer = createHeavyAnimationScope();
  const inner = createHeavyAnimationScope(outer);
  let endInner: (() => void) | undefined;
  const innerLog: number[] = [];
  createRoot(() => createMutationEffect(() => n.get(), (v) => { if (v === 2) endInner?.(); })); // an applier OUTSIDE the scopes (never parked) that ends the inner animation mid-drain
  inScope(inner, () => view(innerLog, () => n.get()));
  const endOuter = outer.begin(Infinity);
  endInner = inner.begin(Infinity);
  try {
    n.set(2);
    await settle();
    expect(inner.isAnimating.peek()).toBe(false);
    expect(innerLog).toEqual([1]); // the inner scope ended, but the outer still animates: parked on the outer
  } finally {
    endOuter();
  }
  await settle();
  expect(innerLog).toEqual([1, 2]);
});

it('one decision per drain: an applier that begins an animation mid-drain does not split its frame; the next flush parks', async () => {
  const n = leaf(0);
  const scope = createHeavyAnimationScope();
  let end: (() => void) | undefined;
  const log: number[] = [];
  inScope(scope, () => {
    createMutationEffect(() => n.get(), (v) => { if (v === 1) end = scope.begin(Infinity); });
    view(log, () => n.get());
  });
  try {
    n.set(1);
    await settle();
    expect(end).toBeDefined();
    expect(log).toEqual([0, 1]); // ran in the same drain, after the applier began the animation
    n.set(2);
    await settle();
    expect(log).toEqual([0, 1]);
  } finally {
    end?.();
  }
  await settle();
  expect(log).toEqual([0, 1, 2]);
});

it('a plain-walk write to a leaf (ungated) unparks a parked reader, which reads every leaf current; many store writes collapse into one run', async () => {
  const a = leaf(0);
  const b = leaf(0);
  const scope = createHeavyAnimationScope();
  const log: string[] = [];
  inScope(scope, () => view(log, () => `${a.get()}/${b.get()}`));
  const end = scope.begin(Infinity);
  try {
    for (let i = 1; i <= 50; i++) a.set(i);
    await settle();
    expect(log).toEqual(['0/0']);
    b.setPlain(1);
    await settle();
    expect(log).toEqual(['0/0', '50/1']);
  } finally {
    end();
  }
  await settle();
  expect(log).toEqual(['0/0', '50/1']);
});

it('nested scopes: the inner subtree waits for the outer too; a parked effect disposed before release does not run', async () => {
  const n = leaf(0);
  const outer = createHeavyAnimationScope();
  const inner = createHeavyAnimationScope(outer);
  const innerLog: number[] = [];
  const outerLog: number[] = [];
  inScope(outer, () => view(outerLog, () => n.get()));
  inScope(inner, () => view(innerLog, () => n.get()));
  const endInner = inner.begin(Infinity);
  n.set(1);
  await settle();
  expect(outerLog).toEqual([0, 1]);
  expect(innerLog).toEqual([0]);
  const endOuter = outer.begin(Infinity);
  n.set(2);
  await settle();
  endInner(); // released from inner, parks again on outer
  await settle();
  expect(innerLog).toEqual([0]);
  expect(outerLog).toEqual([0, 1]);
  endOuter();
  await settle();
  expect(innerLog).toEqual([0, 2]);
  expect(outerLog).toEqual([0, 1, 2]);

  const log: number[] = [];
  const dispose = createRoot((d) => {
    provideHeavyAnimationScope(outer);
    view(log, () => n.get());
    return d;
  });
  const end = outer.begin(Infinity);
  n.set(3);
  await settle();
  dispose();
  end();
  await settle();
  expect(log).toEqual([2]);
});

it('a write made before the animation started but run after it is parked (decided at run time)', async () => {
  const n = leaf(0);
  const scope = createHeavyAnimationScope();
  const log: number[] = [];
  inScope(scope, () => view(log, () => n.get()));
  n.set(1);
  const end = scope.begin(Infinity);
  try {
    await settle();
    expect(log).toEqual([0]);
  } finally {
    end();
  }
  await settle();
  expect(log).toEqual([0, 1]);
});
