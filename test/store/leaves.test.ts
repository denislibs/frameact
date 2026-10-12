// Leaves follow their readers (perf review 3): a leaf (and the shape / values signals) with no
// subscriber left is dropped from its node's table; the next tracked read creates a fresh one.
import { createEffect, createRoot, createSignal, flushSync } from '../../src/index';
import { createStore, keys, values } from 'frameact/store';
import { hasShapeSignals, leafKeys } from '../../src/store/store';

function mount<T>(fn: () => T, log?: T[]): () => void {
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createEffect(fn, (v) => { log?.push(v); });
  });
  flushSync();
  return dispose;
}

it('a leaf disappears when its only reader is disposed', () => {
  const [state] = createStore({ chat: { title: 'a', unread: 1 } });
  const d = mount(() => state.chat.title + state.chat.unread);
  expect(new Set(leafKeys(state.chat))).toEqual(new Set(['title', 'unread']));
  expect(leafKeys(state)).toEqual(['chat']);
  d();
  expect(leafKeys(state.chat)).toEqual([]);
  expect(leafKeys(state)).toEqual([]);
});

it('a tracked read of a missing key leaves nothing once its reader is gone', () => {
  const [state, setState] = createStore<{ users: Record<string, { n: number }> }>({ users: {} });
  const disposers = [];
  for (let i = 0; i < 50; i++) disposers.push(mount(() => state.users[`u${i}`]?.n));
  expect(leafKeys(state.users).length).toBe(50);
  for (const d of disposers) d();
  expect(leafKeys(state.users)).toEqual([]);
  // ... and a later read still works and is live
  const log: unknown[] = [];
  mount(() => state.users.u1?.n, log);
  setState('users', 'u1', { n: 7 });
  flushSync();
  expect(log).toEqual([undefined, 7]);
});

it('with two readers the leaf stays until the second one goes', () => {
  const [state, setState] = createStore({ n: 1 });
  const logA: number[] = [];
  const dA = mount(() => state.n, logA);
  const logB: number[] = [];
  const dB = mount(() => state.n, logB);
  dA();
  expect(leafKeys(state)).toEqual(['n']);
  setState('n', 2);
  flushSync();
  expect(logB).toEqual([1, 2]);
  expect(logA).toEqual([1]);
  dB();
  expect(leafKeys(state)).toEqual([]);
});

it('a reader that stops reading a key (conditional) releases its leaf on that run; one that keeps reading keeps it', () => {
  const [state, setState] = createStore({ on: true, a: 1, b: 2 });
  mount(() => (state.on ? state.a : state.b));
  expect(new Set(leafKeys(state))).toEqual(new Set(['a', 'on']));
  setState('on', false);
  flushSync();
  expect(new Set(leafKeys(state))).toEqual(new Set(['b', 'on']));
  const keep = leafKeys(state).length;
  setState('b', 5);
  flushSync();
  expect(leafKeys(state).length).toBe(keep);
});

it('the same reader re-running keeps its leaf (no churn)', () => {
  const [state, setState] = createStore({ n: 1 });
  let leaves = 0;
  mount(() => { leaves++; return state.n; });
  const before = leafKeys(state);
  setState('n', 2);
  flushSync();
  expect(leaves).toBe(2);
  expect(leafKeys(state)).toEqual(before);
});

it('writes after the leaf was dropped do not throw and later readers see the current value', () => {
  const [state, setState] = createStore({ n: 1 });
  const d = mount(() => state.n);
  d();
  setState('n', 5);
  const log: number[] = [];
  mount(() => state.n, log);
  expect(log).toEqual([5]);
});

it('the shape and values signals are dropped with their readers', () => {
  const [state] = createStore({ d: { a: 1 } as Record<string, number>, l: [1, 2] });
  const dk = mount(() => keys(state.d).length);
  const dv = mount(() => values(state.d).length);
  const dl = mount(() => keys(state.l).length);
  expect(hasShapeSignals(state.d)).toEqual({ self: true, vals: true });
  dk();
  expect(hasShapeSignals(state.d)).toEqual({ self: false, vals: true });
  dv();
  expect(hasShapeSignals(state.d)).toEqual({ self: false, vals: false });
  expect(hasShapeSignals(state.l).self).toBe(true);
  dl();
  expect(hasShapeSignals(state.l).self).toBe(false);
});

it('a key deleted while read: the reader re-links a fresh leaf and the old one does not clobber it', () => {
  const [state, setState] = createStore<{ m: Record<string, number> }>({ m: { k: 1 } });
  const log: unknown[] = [];
  mount(() => state.m.k, log);
  setState('m', 'k', undefined);
  flushSync();
  setState('m', 'k', 3);
  flushSync();
  expect(log).toEqual([1, undefined, 3]);
  expect(leafKeys(state.m)).toEqual(['k']);
});

it('a local-signal reader next to a store leaf is unaffected', () => {
  const [state] = createStore({ n: 1 });
  const [s, setS] = createSignal(0);
  const log: number[] = [];
  const d = mount(() => state.n + s(), log);
  setS(1);
  flushSync();
  expect(log).toEqual([1, 2]);
  d();
  expect(leafKeys(state)).toEqual([]);
});
