import * as api from '../src/index';
import { installFakeRaf } from './helpers/raf';

it('exports the public surface', () => {
  for (const name of [
    'createSignal', 'createMemo', 'createRoot', 'onCleanup', 'untrack', 'peek', 'getOwner', 'runWithOwner', 'onError',
    'createSelector', 'mapArray', 'createContext', 'provideContext', 'useContext',
    'createEffect', 'createMeasureEffect', 'createMutationEffect', 'createRenderEffect', 'createIdleEffect',
    'tickEnd', 'frameMeasure', 'frameMutation', 'frameForcedReflow', 'idle', 'gateOnHeavyAnimation', 'deferUntilIdle',
    'requestMeasure', 'requestMutation', 'requestNextMutation', 'requestForcedReflow', 'getPhase', 'onTickEnd', 'onIdle',
    'beginHeavyAnimation', 'getIsHeavyAnimating', 'getIsBlockingAnimating', 'createHeavyAnimationScope', 'rootScope',
    'provideHeavyAnimationScope', 'currentHeavyAnimationScope', 'onHeavyAnimation', 'onFullyIdle', 'flushSync',
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
