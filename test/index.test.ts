import * as api from '../src/index';
import { installFakeRaf } from './helpers/raf';
import { flushMicrotasks } from './helpers/micro';
import { createHeavyAnimationScope, provideHeavyAnimationScope, rootScope } from '../src/scheduler/heavyAnimation';

it('exports the public surface', () => {
  for (const name of [
    'createSignal', 'createMemo', 'createRoot', 'onCleanup', 'untrack', 'getOwner', 'runWithOwner', 'onError',
    'createSelector', 'mapArray', 'createContext', 'provideContext', 'useContext',
    'createEffect', 'createMeasureEffect', 'createMutationEffect', 'createRenderEffect', 'createIdleEffect',
    'tickEnd', 'frameMeasure', 'frameMutation', 'frameForcedReflow', 'idle', 'gateOnHeavyAnimation', 'deferUntilIdle',
    'requestMeasure', 'requestMutation', 'requestNextMutation', 'requestForcedReflow', 'getPhase', 'onTickEnd', 'onIdle',
    'beginHeavyAnimation', 'getIsHeavyAnimating', 'getIsBlockingAnimating', 'createHeavyAnimationScope', 'rootScope',
    'provideHeavyAnimationScope', 'currentHeavyAnimationScope', 'onHeavyAnimation', 'onFullyIdle', 'flushSync',
    'onMount', 'onDestroy', 'watchHeavyAnimation', 'previous', 'currentOrPrev', 'frozenWhile',
  ]) {
    expect(typeof (api as any)[name], name).not.toBe('undefined');
  }
});

it('createSignal returns a tuple with equals support; flushSync drains tickEnd and frame effects', () => {
  const raf = installFakeRaf();
  const [n, setN] = api.createSignal(1, { equals: (a, b) => Math.abs(a - b) < 0.5 });
  const tick: number[] = [];
  const frame: number[] = [];
  api.createRoot(() => {
    api.createEffect(() => n(), (v) => { tick.push(v); });
    api.createMutationEffect(() => n(), (v) => { frame.push(v); });
  });
  setN(1.2); // within equals tolerance → no change
  setN(3);
  api.flushSync();
  expect(tick).toEqual([3]);
  expect(frame).toEqual([1, 3]);
  raf.uninstall();
});

// I6 (final review)
it('I6: internal and scheduler-level names are not part of the main entry', () => {
  for (const name of [
    'getRawContext', 'setRawContext', 'computedKeyedMap', 'computedMap', 'computedKeyedMapBy', 'NOT_APPLIED',
    'peek', 'throttle', 'onPhaseChange', 'debounce', 'fastRaf', 'throttleWithTickEnd',
  ]) {
    expect((api as any)[name], name).toBeUndefined();
  }
});

// I3 (final review)
it('I3: untrack keeps the owner (context, onCleanup) and only drops tracking', () => {
  const ctx = api.createContext('default');
  const cleanup = vi.fn();
  let outer: unknown;
  let seenOwner: unknown;
  let seenCtx: string | undefined;
  const dispose = api.createRoot((d) => {
    outer = api.getOwner();
    api.provideContext(ctx, 'provided');
    api.untrack(() => {
      seenOwner = api.getOwner();
      seenCtx = api.useContext(ctx);
      api.onCleanup(cleanup);
    });
    return d;
  });
  expect(seenOwner).toBe(outer);
  expect(seenCtx).toBe('provided');
  expect(cleanup).not.toHaveBeenCalled();
  dispose();
  expect(cleanup).toHaveBeenCalledTimes(1);

  const [n, setN] = api.createSignal(0);
  const runs = vi.fn();
  const m = api.createRoot(() => api.createMemo(() => { runs(); return api.untrack(() => n()); }));
  expect(m()).toBe(0);
  setN(1);
  expect(m()).toBe(0);
  expect(runs).toHaveBeenCalledTimes(1);
});

it('I6: createRoot is detached from the enclosing owner but inherits its context and error handlers', async () => {
  const ctx = api.createContext('default');
  const innerCleanup = vi.fn();
  const handler = vi.fn();
  const [n, setN] = api.createSignal(0);
  const applied: number[] = [];
  let seen: string | undefined;
  const disposeOuter = api.createRoot((d) => {
    api.provideContext(ctx, 'outer');
    api.onError(handler);
    api.createRoot(() => {
      seen = api.useContext(ctx);
      api.onCleanup(innerCleanup);
      api.createEffect(() => n(), (v) => { applied.push(v); });
      api.createEffect(() => { if (n() === 2) throw new Error('inner'); return 0; }, () => {});
    });
    return d;
  });
  expect(seen).toBe('outer');
  disposeOuter();
  expect(innerCleanup).not.toHaveBeenCalled();
  setN(1);
  await flushMicrotasks();
  expect(applied.at(-1)).toBe(1);
  setN(2);
  await flushMicrotasks();
  expect(handler).toHaveBeenCalledTimes(1);
});

it('I6: createHeavyAnimationScope() defaults its parent to the current scope from context', () => {
  expect(api.createHeavyAnimationScope().parent).toBe(rootScope);
  const outer = createHeavyAnimationScope();
  api.createRoot(() => {
    provideHeavyAnimationScope(outer);
    expect(api.createHeavyAnimationScope().parent).toBe(outer);
  });
  expect(api.createHeavyAnimationScope(null).parent).toBeNull();
});

// Minor (final review): core flushSync settles cascades between tickEnd and frame work.
it('flushSync settles tickEnd → mutate → tickEnd → mutate cascades in one call', () => {
  const raf = installFakeRaf();
  const [a, setA] = api.createSignal(0);
  const [b, setB] = api.createSignal(0);
  const [c, setC] = api.createSignal(0);
  const [d, setD] = api.createSignal(0);
  const log: number[] = [];
  const dispose = api.createRoot((stop) => {
    api.createEffect(() => a(), (v) => { setB(v); });
    api.createMutationEffect(() => b(), (v) => { setC(v); });
    api.createEffect(() => c(), (v) => { setD(v); });
    api.createMutationEffect(() => d(), (v) => { log.push(v); });
    return stop;
  });
  api.flushSync();
  setA(1);
  api.flushSync();
  expect(log.at(-1)).toBe(1);
  dispose();
  raf.uninstall();
});

it('flushSync stops after 100 rounds of a never-settling cascade and reports it', () => {
  const raf = installFakeRaf();
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  // A single chain rotating over three tickEnd effects through mutation effects: every round's
  // tickEnd work is a new flushTickEnd drain (each effect runs once per drain), so the per-drain
  // tickEnd loop guard never trips — only flushSync's own round cap can stop this cascade.
  const xs = [api.createSignal(1), api.createSignal(0), api.createSignal(0)];
  const ys = [api.createSignal(0), api.createSignal(0), api.createSignal(0)];
  const dispose = api.createRoot((stop) => {
    for (let i = 0; i < 3; i++) {
      const [x] = xs[i], [y, setY] = ys[i], [, setNextX] = xs[(i + 1) % 3];
      api.createEffect(() => x(), (v) => { if (v) setY(v + 1); });
      api.createMutationEffect(() => y(), (v) => { if (v) setNextX(v + 1); });
    }
    return stop;
  });
  api.flushSync();
  expect(err.mock.calls.some((call) => String(call[0]).includes('flushSync'))).toBe(true);
  dispose();
  err.mockRestore();
  raf.uninstall();
});
