import * as scheduler from '../../src/scheduler/index';
import { flushSync as rawFlushSync } from '../../src/scheduler/fasterdom';
import pkg from '../../package.json';

it('frameact/scheduler exposes the fasterdom and scheduler utilities', () => {
  for (const name of [
    'requestMeasure', 'requestMutation', 'requestNextMutation', 'requestForcedReflow', 'getPhase', 'onPhaseChange',
    'flushFrameSync', 'onTickEnd', 'onIdle', 'throttleWith', 'throttle', 'throttleWithTickEnd', 'debounce', 'fastRaf',
  ]) {
    expect(typeof (scheduler as any)[name], name).toBe('function');
  }
  expect(scheduler.flushFrameSync).toBe(rawFlushSync);
  expect((pkg as any).exports['./scheduler']).toBe('./src/scheduler/index.ts');
});
