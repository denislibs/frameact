import { createEffect, createMemo, createMutationEffect, createRoot, createSignal, flushSync } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { setRunObserver } from '../../src/core/effects';
import { disableStrict, enableStrict, setHandler } from '../../src/stricterdom/stricterdom';
import { disableRunLog, enableRunLog, getRunStats, resetRunStats, SLOW_RUN_MS } from '../../src/stricterdom/runlog';
import { useDomHarness } from '../helpers/dom';

useDomHarness();

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  flushSync();
  disableRunLog();
  disableStrict();
  setHandler();
  resetRunStats();
});

/** A clock the test advances by hand: `performance.now()` is read twice per run and twice per drain. */
function fakeClock() {
  const clock = { now: 0 };
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  return clock;
}

/** A Counter component with a memo between the signal and the binding effect. */
function counter(count: () => number, apply: (v: number) => void) {
  createRoot((dispose) => {
    disposers.push(dispose);
    createComponent(
      () => {
        const doubled = createMemo(() => count() * 2, { id: 'doubled' });
        createMutationEffect(() => doubled(), apply, { name: 'div.children' });
        return null;
      },
      {},
      'Counter',
    );
  });
}

it('enableStrict counts scheduled runs per path with totals; resetRunStats clears; disableStrict stops counting', () => {
  const clock = fakeClock();
  const [count, setCount] = createSignal(0, { id: 'count' });
  enableStrict();
  counter(count, () => { clock.now += 2; });
  expect(getRunStats()).toEqual([]); // the creation run is not observed
  setCount(1);
  flushSync();
  setCount(2);
  flushSync();
  expect(getRunStats()).toEqual([{ path: 'Counter > div.children', runs: 2, totalMs: 4, maxMs: 2 }]);
  resetRunStats();
  expect(getRunStats()).toEqual([]);
  disableStrict();
  setCount(3);
  flushSync();
  expect(getRunStats()).toEqual([]);
});

it('getRunStats orders by runs, most first', () => {
  enableRunLog({ filter: 'nothing-matches' });
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0);
  createRoot((dispose) => {
    disposers.push(dispose);
    createMutationEffect(() => a(), () => {}, { name: 'rare' });
    createMutationEffect(() => b(), () => {}, { name: 'busy' });
  });
  setA(1);
  flushSync();
  for (let i = 1; i <= 3; i++) {
    setB(i);
    flushSync();
  }
  expect(getRunStats().map((s) => `${s.path}:${s.runs}`)).toEqual(['busy:3', 'rare:1']);
});

it('enableRunLog logs each run with its number, path, phase and the write that scheduled it; filter narrows it', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const [count, setCount] = createSignal(0, { id: 'count' });
  counter(count, () => {});
  enableRunLog();
  setCount(1);
  flushSync();
  expect(log).toHaveBeenCalledWith('[frameact] run #2 Counter > div.children [mutate] ← signal "count" via memo "doubled" in Counter');
  log.mockClear();
  enableRunLog({ filter: 'Other' });
  setCount(2);
  flushSync();
  expect(log).not.toHaveBeenCalled();
  enableRunLog({ filter: /Counter > div\.\w+/ });
  setCount(3);
  flushSync();
  expect(log).toHaveBeenCalledTimes(1);
  disableRunLog();
  setCount(4);
  flushSync();
  expect(log).toHaveBeenCalledTimes(1);
});

it('a run slower than SLOW_RUN_MS warns with the path and the phase; so does a drain, naming its slowest effect', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const clock = fakeClock();
  const [count, setCount] = createSignal(0);
  enableStrict();
  counter(count, (v) => { clock.now += v === 4 ? 1 : SLOW_RUN_MS + 3; }); // v is the doubled count
  expect(SLOW_RUN_MS).toBe(7);
  setCount(1);
  flushSync();
  expect(warn.mock.calls.map((c) => c[0])).toEqual([
    '[frameact] Slow effect run: 10.0 ms in Counter > div.children [mutate]',
    '[frameact] Slow mutate drain: 10.0 ms, 1 effect run; slowest: Counter > div.children (10.0 ms)',
  ]);
  warn.mockClear();
  setCount(2); // doubled → 4: 1 ms, quiet
  flushSync();
  expect(warn).not.toHaveBeenCalled();
});

it('the slowest effect a drain warning names ran in that drain (a slow tickEnd run just before it is not)', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const clock = fakeClock();
  const [count, setCount] = createSignal(0);
  enableStrict();
  createRoot((dispose) => {
    disposers.push(dispose);
    createEffect(() => count(), (v) => { if (v) clock.now += 12; }, undefined, { name: 'logic' });
    createMutationEffect(() => count(), (v) => { if (v) clock.now += 8; }, { name: 'div.title' });
  });
  flushSync(); // the first (scheduled) tickEnd apply
  warn.mockClear();
  setCount(1);
  flushSync(); // the tickEnd run (12 ms, outside any drain), then the mutate drain (8 ms)
  expect(warn.mock.calls.map((c) => c[0])).toEqual([
    '[frameact] Slow effect run: 12.0 ms in logic [measure]',
    '[frameact] Slow effect run: 8.0 ms in div.title [mutate]',
    '[frameact] Slow mutate drain: 8.0 ms, 1 effect run; slowest: div.title (8.0 ms)',
  ]);
});

it('an effect that re-dirties itself from its own apply keeps the "why" of the run that write caused', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const [n, setN] = createSignal(0, { id: 'n' });
  createRoot((dispose) => {
    disposers.push(dispose);
    createEffect(() => n(), (v) => { if (v === 1) setN(2); }, undefined, { name: 'loop' });
  });
  enableRunLog();
  setN(1);
  flushSync();
  const lines = log.mock.calls.map((c) => c[0] as string).filter((l) => l.includes(' loop '));
  expect(lines).toEqual([
    '[frameact] run #2 loop [measure] ← signal "n"',
    '[frameact] run #3 loop [measure] ← signal "n"', // caused by setN(2) in run #2's apply
  ]); // (the third booking finds the effect clean: nothing ran, nothing is logged or counted)
  expect(getRunStats().map((s) => `${s.path}:${s.runs}`)).toEqual(['loop:2']);
});

it('the first apply of a scheduled (tickEnd) effect is the end of its creation run: logged as such, not counted as a scheduled run', () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const [n] = createSignal(0);
  enableRunLog();
  createRoot((dispose) => {
    disposers.push(dispose);
    createEffect(() => n(), () => {}, undefined, { name: 'first' });
  });
  flushSync();
  expect(log.mock.calls.map((c) => c[0])).toEqual(['[frameact] first apply first [measure]']);
  expect(getRunStats()).toEqual([]);
});

it('a throwing run observer neither replaces the run nor skips it (reported once, the hook fails alone)', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const [n, setN] = createSignal(0);
  let applied = 0;
  createRoot((dispose) => {
    disposers.push(dispose);
    createEffect(() => n(), () => { applied++; }, undefined, { name: 'fx' });
  });
  flushSync();
  setRunObserver(() => { throw new Error('observer boom'); });
  try {
    setN(1);
    expect(() => flushSync()).not.toThrow();
  } finally {
    setRunObserver(null);
  }
  expect(applied).toBe(2);
  expect(error.mock.calls.some((c) => String(c[0]).includes('run observer failed'))).toBe(true);
});
