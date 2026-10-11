import { DEV } from '../src/env';
import { installFakeRaf } from './helpers/raf';

it('dev flag is on under vitest', () => {
  expect(DEV).toBe(true);
});

it('fake raf fires queued callbacks once per frame', () => {
  const raf = installFakeRaf();
  const calls: number[] = [];
  requestAnimationFrame(() => {
    calls.push(1);
    requestAnimationFrame(() => calls.push(2));
  });
  raf.frame();
  expect(calls).toEqual([1]);
  raf.frame();
  expect(calls).toEqual([1, 2]);
  raf.uninstall();
});
