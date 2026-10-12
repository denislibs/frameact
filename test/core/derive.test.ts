import { createEffect, createRoot, createSignal, currentOrPrev, flushSync, frozenWhile, previous } from '../../src/index';

/** Read `get` from an effect so every change is observed; returns the log. */
function observe<T>(get: () => T): T[] {
  const log: T[] = [];
  createRoot(() => createEffect(() => get(), (v) => { log.push(v); }));
  flushSync();
  return log;
}

describe('previous', () => {
  it('is undefined until the first change, then the value before the current one; same value is not a step', () => {
    const [n, setN] = createSignal(1);
    const log = observe(previous(n));
    expect(log).toEqual([undefined]);
    setN(2);
    flushSync();
    setN(2);
    flushSync();
    setN(3);
    flushSync();
    expect(log).toEqual([undefined, 1, 2]);
  });

  it('skipUndefined: a gap keeps the previous value and the last defined one', () => {
    const [v, setV] = createSignal<string | undefined>('a');
    const log = observe(previous(v, { skipUndefined: true }));
    setV('b');
    flushSync();
    setV(undefined);
    flushSync();
    setV('c');
    flushSync();
    expect(log).toEqual([undefined, 'a', 'b']);
  });
});

describe('currentOrPrev', () => {
  it('returns the current value while present, else the last present one; forceCurrent overrides', () => {
    const [v, setV] = createSignal<{ id: number } | null>({ id: 1 });
    const [force, setForce] = createSignal(false);
    const log = observe(currentOrPrev(v, { forceCurrent: force }));
    setV(null);
    flushSync();
    expect(log).toEqual([{ id: 1 }]); // still { id: 1 } (memo: no change, no re-run)
    setV({ id: 2 });
    flushSync();
    setV(null);
    flushSync();
    setForce(true);
    flushSync();
    expect(log).toEqual([{ id: 1 }, { id: 2 }, null]);
  });
});

describe('currentOrPrev — the last present value', () => {
  it('A -> B -> undefined shows B (the value before the last present one is never shown)', () => {
    const [v, setV] = createSignal<string | undefined>('A');
    const log = observe(currentOrPrev(v));
    setV('B');
    flushSync();
    setV(undefined);
    flushSync();
    expect(log).toEqual(['A', 'B']); // undefined is a gap: B stays (memo output unchanged, no extra entry)
    setV('C');
    flushSync();
    setV(undefined);
    flushSync();
    expect(log).toEqual(['A', 'B', 'C']);
  });

  it('null counts as empty too; skipUndefined: false shows the value just before an undefined', () => {
    const [v, setV] = createSignal<string | null>('A');
    const log = observe(currentOrPrev(v));
    setV('B');
    flushSync();
    setV(null);
    flushSync();
    expect(log).toEqual(['A', 'B']);

    const [w, setW] = createSignal<string | undefined>('A');
    const stepLog = observe(currentOrPrev(w, { skipUndefined: false }));
    setW('B');
    flushSync();
    setW(undefined);
    flushSync();
    expect(stepLog).toEqual(['A', 'B']);
  });
});

describe('frozenWhile', () => {
  it('follows the source while not frozen; holds the value seen at the freeze; alwaysFresh keys keep updating', () => {
    const [p, setP] = createSignal({ title: 'a', unread: 0 });
    const [frozen, setFrozen] = createSignal(false);
    const log = observe(frozenWhile(p, frozen, ['unread']));
    setP({ title: 'b', unread: 1 });
    flushSync();
    setFrozen(true);
    flushSync();
    setP({ title: 'c', unread: 2 });
    flushSync();
    expect(log.at(-1)).toEqual({ title: 'b', unread: 2 }); // title held, unread fresh
    setFrozen(false);
    flushSync();
    expect(log.at(-1)).toEqual({ title: 'c', unread: 2 });

    const [s, setS] = createSignal(1);
    const [f2, setF2] = createSignal(false);
    const plain = observe(frozenWhile(s, f2));
    setF2(true);
    flushSync();
    setS(2);
    flushSync();
    expect(plain).toEqual([1]);
    setF2(false);
    flushSync();
    expect(plain).toEqual([1, 2]);
  });
});
