import { waitForAnimationEnd, waitForTransitionEnd } from '../../src/kit/animationEnd';

afterEach(() => {
  vi.useRealTimers();
});

function animationEnd(name = 'slide-in') {
  const e = new Event('animationend', { bubbles: true }) as AnimationEvent;
  Object.defineProperty(e, 'animationName', { value: name });
  return e;
}

it('fires once, 50 ms after the node\'s own animationend (not a descendant\'s); a second event is ignored', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const el = document.createElement('div');
  const child = document.createElement('i');
  el.appendChild(child);
  const handler = vi.fn();
  waitForAnimationEnd(el, handler);
  child.dispatchEvent(animationEnd()); // bubbles from the child: not ours
  vi.advanceTimersByTime(50);
  expect(handler).not.toHaveBeenCalled();
  el.dispatchEvent(animationEnd());
  expect(handler).not.toHaveBeenCalled();
  vi.advanceTimersByTime(50);
  expect(handler).toHaveBeenCalledTimes(1);
  el.dispatchEvent(animationEnd());
  vi.advanceTimersByTime(50);
  expect(handler).toHaveBeenCalledTimes(1);
});

it('delayMs: 0 calls the handler inside the event; name filters by animationName; cancel stops everything', () => {
  const el = document.createElement('div');
  const handler = vi.fn();
  waitForAnimationEnd(el, handler, { delayMs: 0, name: 'fade' });
  el.dispatchEvent(animationEnd('slide-in'));
  expect(handler).not.toHaveBeenCalled();
  el.dispatchEvent(animationEnd('fade'));
  expect(handler).toHaveBeenCalledTimes(1);

  const cancelled = vi.fn();
  const cancel = waitForAnimationEnd(el, cancelled, { delayMs: 0 });
  cancel();
  el.dispatchEvent(animationEnd());
  expect(cancelled).not.toHaveBeenCalled();
});

it('fallbackMs calls the handler when no end event arrives, once; an event after the fallback is ignored', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const el = document.createElement('div');
  const handler = vi.fn();
  waitForTransitionEnd(el, handler, { fallbackMs: 1000, delayMs: 0 });
  vi.advanceTimersByTime(999);
  expect(handler).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(handler).toHaveBeenCalledTimes(1);
  el.dispatchEvent(new Event('transitionend'));
  expect(handler).toHaveBeenCalledTimes(1);
});

it('cancel during the post-event delay stops the handler', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const el = document.createElement('div');
  const handler = vi.fn();
  const cancel = waitForAnimationEnd(el, handler);
  el.dispatchEvent(animationEnd());
  cancel();
  vi.advanceTimersByTime(50);
  expect(handler).not.toHaveBeenCalled();
});
