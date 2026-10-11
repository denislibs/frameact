// Core perf pass, stage 3 (P3b): public createSignal nodes are unowned, like Solid. A signal is
// plain state: it is not a child of the current owner, disposing that owner does not dispose it;
// its readers unlink from it when THEY are disposed. Memos and effects stay owned.
import { createEffect, createMemo, createRoot, createSignal, getOwner } from '../../src/index';
import { STATE_DISPOSED } from '../../src/core/core';
import type { Computation } from '../../src/core/types';
import { childrenOf, depsOf, subsOf } from './helpers/graph';
import { flushMicrotasks } from '../helpers/micro';

it('createSignal does not register the signal as a child of the current owner (createMemo does)', () => {
  createRoot((dispose) => {
    const owner = getOwner()!;
    createSignal(1);
    createSignal(2, { equals: false, id: 'named' });
    expect(childrenOf(owner)).toEqual([]);
    createMemo(() => 1);
    expect(childrenOf(owner)).toHaveLength(1);
    dispose();
  });
});

it('a signal created under an owner outlives its dispose: a live reader elsewhere reads and gets writes', async () => {
  let get!: () => number, set!: (v: number) => number;
  createRoot((dispose) => {
    [get, set] = createSignal(1);
    dispose();
  });
  expect(get()).toBe(1);
  const seen: number[] = [];
  const disposeReader = createRoot((dispose) => {
    createEffect(() => get(), (v) => { seen.push(v); });
    return dispose;
  });
  const doubled = createMemo(() => get() * 2);
  expect(doubled()).toBe(2);
  await flushMicrotasks();
  set(5);
  expect(get()).toBe(5);
  expect(doubled()).toBe(10);
  await flushMicrotasks();
  expect(seen).toEqual([1, 5]);
  disposeReader();
});

it('a memo reading a long-lived signal is disposed with its owner and unlinks from the signal (no leak)', () => {
  const [get, set] = createSignal(1);
  let memoNode!: Computation;
  const spy = vi.fn(() => {
    memoNode = getOwner() as Computation; // inside a compute the owner is the memo itself
    return get() + 1;
  });
  let m!: () => number;
  const dispose = createRoot((d) => {
    m = createMemo(spy);
    return d;
  });
  expect(m()).toBe(2);
  const signalNode = depsOf(memoNode)[0];
  expect(subsOf(signalNode)).toEqual([memoNode]);
  dispose();
  expect(memoNode._state).toBe(STATE_DISPOSED);
  expect(subsOf(signalNode)).toEqual([]);
  expect(signalNode._state).not.toBe(STATE_DISPOSED);
  set(2);
  expect(get()).toBe(2);
  expect(m()).toBe(2); // the disposed memo keeps its last value
  expect(spy).toHaveBeenCalledTimes(1);
});

it('a signal created inside a memo compute survives the re-run that disposes the memo\'s children', () => {
  const [tick, setTick] = createSignal(0);
  const made: Array<[() => number, (v: number) => number]> = [];
  const m = createMemo(() => {
    tick();
    made.push(createSignal(made.length));
    return made.length;
  });
  expect(m()).toBe(1);
  setTick(1);
  expect(m()).toBe(2);
  const [first, setFirst] = made[0];
  const reader = createMemo(() => first() * 10);
  expect(reader()).toBe(0);
  setFirst(3);
  expect(reader()).toBe(30);
});
