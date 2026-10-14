// isTracking(): true while a tracked computation runs (a memo or effect compute, where store reads
// subscribe), false everywhere else — for DEV warnings such as "a snapshot getter inside a computation".
import { createEffect, createMemo, createRoot, createSignal, flushSync, isTracking, onError, untrack } from '../../src/index';
import { createStore } from 'frameact/store';
import { leafKeys } from '../../src/store/store';

it('is false outside computations and inside untrack(); true in a memo and an effect compute; false in an effect apply', () => {
  expect(isTracking()).toBe(false);
  const [n, setN] = createSignal(0);
  const seen: string[] = [];
  createRoot(() => {
    expect(isTracking()).toBe(false); // (a root owns, it does not track)
    const m = createMemo(() => {
      seen.push(`memo:${isTracking()}`);
      untrack(() => seen.push(`untrack:${isTracking()}`));
      return n();
    });
    createEffect(
      () => { seen.push(`compute:${isTracking()}`); return m(); },
      () => { seen.push(`apply:${isTracking()}`); },
    );
  });
  flushSync();
  setN(1);
  flushSync();
  // (on the update the dirty memo recomputes on the push, before the effect's compute pulls it)
  expect(seen).toEqual(['compute:true', 'memo:true', 'untrack:false', 'apply:false', 'memo:true', 'untrack:false', 'compute:true', 'apply:false']);
  expect(isTracking()).toBe(false);
});

it('agrees with the store: a read made while isTracking() is false subscribes to nothing', () => {
  const [state] = createStore({ chat: { title: 't' } });
  let inside = false;
  createRoot(() => {
    createMemo(() => {
      inside = isTracking();
      untrack(() => state.chat.title);
      return 0;
    })();
  });
  expect(inside).toBe(true);
  expect(leafKeys(state.chat)).toEqual([]);
  createRoot(() => { createMemo(() => state.chat.title)(); });
  expect(leafKeys(state.chat)).toEqual(['title']);
});

it('is restored after a compute throws', () => {
  const [n, setN] = createSignal(0);
  const errors: unknown[] = [];
  createRoot(() => {
    onError((e) => errors.push(e));
    createEffect(() => { if (n() > 0) throw new Error('boom'); return n(); }, () => {});
  });
  flushSync();
  setN(1);
  flushSync();
  expect(errors).toHaveLength(1);
  expect(isTracking()).toBe(false);
});
