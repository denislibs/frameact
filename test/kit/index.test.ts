import * as kit from 'frameact/kit';
import pkg from '../../package.json';

it('frameact/kit exposes the client-readiness kit', () => {
  for (const name of [
    'waitForAnimationEnd', 'waitForTransitionEnd', 'createShowTransition', 'createMediaTransition', 'ShowTransition',
    'Transition', 'createScrollAnchor', 'InfiniteScroll',
  ]) {
    expect(typeof (kit as Record<string, unknown>)[name], name).toBe('function');
  }
  expect((pkg as { exports: Record<string, string> }).exports['./kit']).toBe('./src/kit/index.ts');
});
