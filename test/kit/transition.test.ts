import { createHeavyAnimationScope, createMutationEffect, createRoot, createSignal, onCleanup, type HeavyAnimationScope } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { Transition, type TransitionSlide } from '../../src/kit/transition';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

afterEach(() => {
  vi.useRealTimers();
});

const classes = (el: Element) => Array.from(el.classList).join(' ');
const slidesOf = (root: Element) => Array.from(root.querySelectorAll<HTMLElement>('.Transition_slide'));

function sized<T extends HTMLElement>(el: T, height: number): T {
  Object.defineProperty(el, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 300, configurable: true });
  return el;
}

function animationEnd(el: Element) {
  el.dispatchEvent(new Event('animationend', { bubbles: true }));
  vi.advanceTimersByTime(50); // waitForAnimationEnd's post-event delay → requestMutation
}

interface Setup {
  root: HTMLDivElement;
  scope: HeavyAnimationScope;
  setKey: (k: number) => void;
  dispose: () => void;
  log: string[];
}

function setup(extra: Record<string, unknown> = {}, initial = 0): Setup {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const root = container();
  const scope = createHeavyAnimationScope();
  const [key, setKey] = createSignal(initial);
  const log: string[] = [];
  const dispose = createRoot((d) => {
    insert(
      root,
      createComponent(Transition, {
        get activeKey() { return key(); },
        name: 'slide',
        scope,
        onStart: () => log.push('start'),
        onStop: () => log.push('stop'),
        children: (slide: TransitionSlide) => {
          const b = document.createElement('b');
          insert(b, () => `${slide.key}:${slide.isActive() ? 'active' : slide.isFrom() ? 'from' : '-'}`);
          return b;
        },
        ...extra,
      }),
    );
    return d;
  });
  return { root, scope, setKey, dispose, log };
}

it('mounts the active slide without animating; a key change animates from → to, keeps the previous slide, ends on animationend', async () => {
  const { root, scope, setKey, log } = setup();
  const t = root.firstElementChild as HTMLElement;
  expect(classes(t)).toBe('Transition');
  expect(slidesOf(t).map(classes)).toEqual(['Transition_slide Transition_slide-active']);
  expect(t.textContent).toBe('0:active');
  expect(scope.isAnimating.peek()).toBe(false);

  setKey(1);
  await frame();
  const [s0, s1] = slidesOf(t);
  expect(classes(t)).toBe('Transition Transition-slide'); // forwards
  expect(classes(s0)).toBe('Transition_slide Transition_slide-from');
  expect(classes(s1)).toBe('Transition_slide Transition_slide-to');
  expect(t.textContent).toBe('0:from1:active');
  expect(scope.isAnimating.peek()).toBe(true);
  expect(log).toEqual(['start']);

  animationEnd(s1); // the watched slide is `to`
  expect(scope.isAnimating.peek()).toBe(true); // the end is applied in the mutate phase, not in the event
  await frame();
  expect(classes(t)).toBe('Transition');
  expect(classes(s0)).toBe('Transition_slide Transition_slide-inactive'); // kept alive
  expect(classes(s1)).toBe('Transition_slide Transition_slide-active');
  expect(scope.isAnimating.peek()).toBe(false);
  expect(log).toEqual(['start', 'stop']);
  expect(slidesOf(t)).toEqual([s0, s1]);
});

it('going back reuses the kept slide (same element), animates Backwards; shouldCleanup drops the other slide after the animation', async () => {
  const { root, setKey } = setup({ shouldCleanup: true }, 0);
  const t = root.firstElementChild as HTMLElement;
  setKey(1);
  await frame();
  const [s0, s1] = slidesOf(t);
  animationEnd(s1);
  await frame(); // the end: classes, callbacks, the cleanup write
  await frame(); // the cleanup write lands in the next frame (it is made from a mutate task)
  expect(slidesOf(t)).toEqual([s1]); // cleanup: only the active one remains
  setKey(0);
  await frame();
  const [n0, n1] = slidesOf(t);
  expect(n1).toBe(s1);
  expect(n0).not.toBe(s0); // s0 was dropped by the cleanup: a new slide
  expect(classes(t)).toBe('Transition Transition-slideBackwards');
  expect(classes(n0)).toBe('Transition_slide Transition_slide-to');
  expect(classes(n1)).toBe('Transition_slide Transition_slide-from');
  animationEnd(n0);
  await frame();
  await frame();
  expect(slidesOf(t)).toEqual([n0]);
  expect(n0.textContent).toBe('0:active');
});

it('without cleanup the previous slide stays after the animation; a new step keeps only {previous, active} (tt keep-alive); renderCount keeps all', async () => {
  const { root, setKey } = setup();
  const t = root.firstElementChild as HTMLElement;
  setKey(2);
  await frame();
  const [s0, s2] = slidesOf(t);
  animationEnd(s2);
  await frame();
  expect(slidesOf(t)).toEqual([s0, s2]); // kept after the animation
  setKey(1);
  await frame();
  const now = slidesOf(t);
  expect(now.length).toBe(2); // 0 is gone: only the previous (2) and the active (1) are alive
  expect(now[1]).toBe(s2);
  expect(classes(now[0])).toBe('Transition_slide Transition_slide-to');
  expect(classes(s2)).toBe('Transition_slide Transition_slide-from');
  animationEnd(now[0]);
  await frame();
  expect(slidesOf(t)).toEqual([now[0], s2]);

  const all = setup({ renderCount: 3 });
  const t2 = all.root.firstElementChild as HTMLElement;
  all.setKey(2);
  await frame();
  animationEnd(slidesOf(t2)[1]);
  await frame();
  all.setKey(1);
  await frame();
  expect(slidesOf(t2).length).toBe(3); // every visited key stays, in key order
  expect(slidesOf(t2).map((s) => s.textContent)).toEqual(['0:-', '1:active', '2:from']);
});

it('name "none" or disableAnimation switches at once: no classes, no heavy animation, no callbacks', async () => {
  const { root, scope, setKey, log } = setup({ name: 'none' });
  const t = root.firstElementChild as HTMLElement;
  setKey(1);
  await frame();
  const [s0, s1] = slidesOf(t);
  expect(classes(t)).toBe('Transition');
  expect(classes(s0)).toBe('Transition_slide Transition_slide-inactive');
  expect(classes(s1)).toBe('Transition_slide Transition_slide-active');
  expect(scope.isAnimating.peek()).toBe(false);
  expect(log).toEqual([]);

  const off = setup({ disableAnimation: true });
  const t2 = off.root.firstElementChild as HTMLElement;
  off.setKey(1);
  await frame();
  expect(classes(t2)).toBe('Transition');
  expect(slidesOf(t2).map(classes)).toEqual(['Transition_slide Transition_slide-inactive', 'Transition_slide Transition_slide-active']);
  expect(off.scope.isAnimating.peek()).toBe(false);
  expect(off.log).toEqual([]);
});

it('a step started during an animation supersedes it: the first end only releases its heavy animation; the second finishes the classes', async () => {
  const { root, scope, setKey, log } = setup({ isBlockingAnimation: true });
  const t = root.firstElementChild as HTMLElement;
  setKey(1);
  await frame();
  const [, s1] = slidesOf(t);
  expect(scope.isBlockingAnimating.peek()).toBe(true);
  setKey(2);
  await frame();
  const [, s2] = slidesOf(t);
  expect(slidesOf(t).length).toBe(2); // slide 0 is dropped at the new step (not the previous key any more)
  expect(classes(s1)).toBe('Transition_slide Transition_slide-from');
  expect(classes(s2)).toBe('Transition_slide Transition_slide-to');
  animationEnd(s1); // the first step's end (its watched slide was s1)
  await frame();
  expect(classes(s2)).toBe('Transition_slide Transition_slide-to'); // untouched: superseded
  expect(scope.isBlockingAnimating.peek()).toBe(true); // the second step's animation
  expect(log).toEqual(['start', 'start']);
  animationEnd(s2);
  await frame();
  expect(classes(s2)).toBe('Transition_slide Transition_slide-active');
  expect(classes(s1)).toBe('Transition_slide Transition_slide-inactive');
  expect(scope.isBlockingAnimating.peek()).toBe(false);
  expect(log).toEqual(['start', 'start', 'stop']);
});

it('the scope is provided to the slides: a blocking animation parks their frame effects until the end; disposal ends a running animation', async () => {
  const [text, setText] = createSignal('a');
  const applied: string[] = [];
  const { scope, setKey, dispose } = setup({
    isBlockingAnimation: true,
    children: () => {
      const b = document.createElement('b');
      createMutationEffect(() => text(), (v) => { applied.push(v); });
      return b;
    },
  });
  setKey(1);
  await frame();
  expect(scope.isBlockingAnimating.peek()).toBe(true);
  setText('b');
  await frame();
  expect(applied).toEqual(['a', 'a']); // the two slides' first applies only: 'b' is parked
  dispose();
  expect(scope.isBlockingAnimating.peek()).toBe(false); // dispose ended the heavy animation
  await frame();
  expect(applied).toEqual(['a', 'a']); // disposed while parked: dropped at release
});

it('shouldRestoreHeight: measured in the forced-reflow phase when the step settles, the container height set in its mutate step; the old height stays during the animation', async () => {
  const { root, setKey } = setup({ shouldRestoreHeight: true });
  const t = root.firstElementChild as HTMLElement;
  const [s0] = slidesOf(t);
  sized(s0, 120);
  await frame(); // the first measure (forced reflow) and write
  expect(t.style.height).toBe('120px');
  expect(t.style.flexBasis).toBe('120px');
  expect(s0.style.height).toBe('auto');
  setKey(1);
  await frame();
  const [, s1] = slidesOf(t);
  sized(s1, 80);
  expect(t.style.height).toBe('120px'); // kept while animating
  animationEnd(s1);
  await frame();
  expect(t.style.height).toBe('80px'); // the end task settles the step: measured and applied in that frame
  expect(s1.style.height).toBe('auto');

  // without an animation the switch settles at once (the measure runs after the mutate phase that created the slide)
  const quick = setup({
    shouldRestoreHeight: true,
    disableAnimation: true,
    contentSelector: 'b',
    children: (slide: TransitionSlide) => sized(document.createElement('b'), slide.key === 0 ? 120 : 60),
  });
  const q = quick.root.firstElementChild as HTMLElement;
  await frame();
  expect(q.style.height).toBe('120px');
  quick.setKey(1);
  await frame();
  expect(q.style.height).toBe('60px');
});

it('disposal after the end event but before its mutate task: no onStop, no writes', async () => {
  const { root, setKey, dispose, log } = setup();
  const t = root.firstElementChild as HTMLElement;
  setKey(1);
  await frame();
  const [, s1] = slidesOf(t);
  s1.dispatchEvent(new Event('animationend', { bubbles: true }));
  dispose(); // inside waitForAnimationEnd's 50 ms delay
  vi.advanceTimersByTime(50);
  await frame();
  expect(log).toEqual(['start']);
  expect(classes(s1)).toBe('Transition_slide Transition_slide-to');
});

it('a throwing onStart / onStop is reported and leaves neither the step animating nor the scope begun (clean-room finding 2)', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { root, scope, setKey, log } = setup({
    onStart: () => { log.push('start'); throw new Error('onStart boom'); },
    onStop: () => { log.push('stop'); throw new Error('onStop boom'); },
  });
  const t = root.firstElementChild as HTMLElement;
  setKey(1);
  await frame();
  const [s0, s1] = slidesOf(t);
  expect(log).toEqual(['start']);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(scope.isAnimating.peek()).toBe(true); // the throw came after the step was set up
  expect(classes(s1)).toBe('Transition_slide Transition_slide-to');
  animationEnd(s1);
  await frame();
  expect(scope.isAnimating.peek()).toBe(false); // released before onStop ran
  expect(classes(t)).toBe('Transition');
  expect(classes(s0)).toBe('Transition_slide Transition_slide-inactive');
  expect(classes(s1)).toBe('Transition_slide Transition_slide-active');
  expect(log).toEqual(['start', 'stop']);
  expect(errors).toHaveBeenCalledTimes(2);
  setKey(2); // the next step is a normal one
  await frame();
  expect(scope.isAnimating.peek()).toBe(true);
  expect(log).toEqual(['start', 'stop', 'start']);
});

it('a non-animated switch during an animation stops it: waiter cancelled, scope released, onStop once, classes and isFrom settled (clean-room finding 2)', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const root = container();
  const scope = createHeavyAnimationScope();
  const [key, setKey] = createSignal(0);
  const [off, setOff] = createSignal(false);
  const log: string[] = [];
  createRoot(() => {
    insert(
      root,
      createComponent(Transition, {
        get activeKey() { return key(); },
        name: 'slide',
        scope,
        isBlockingAnimation: true,
        get disableAnimation() { return off(); },
        onStart: () => log.push('start'),
        onStop: () => log.push('stop'),
        children: (slide: TransitionSlide) => {
          const b = document.createElement('b');
          insert(b, () => `${slide.key}:${slide.isFrom() ? 'from' : slide.isActive() ? 'active' : '-'}`);
          return b;
        },
      }),
    );
  });
  const t = root.firstElementChild as HTMLElement;
  setKey(1);
  await frame();
  const [, s1] = slidesOf(t);
  expect(scope.isBlockingAnimating.peek()).toBe(true);
  expect(t.textContent).toBe('0:from1:active');
  setOff(true);
  setKey(2);
  await frame();
  const now = slidesOf(t);
  expect(now.length).toBe(2); // keep-alive: {1, 2}
  expect(now[0]).toBe(s1);
  expect(classes(t)).toBe('Transition');
  expect(classes(s1)).toBe('Transition_slide Transition_slide-inactive');
  expect(classes(now[1])).toBe('Transition_slide Transition_slide-active');
  expect(t.textContent).toBe('1:-2:active'); // isFrom cleared, the slides' effects not parked (the scope was released in the same step)
  expect(scope.isBlockingAnimating.peek()).toBe(false);
  expect(log).toEqual(['start', 'stop']);
  animationEnd(s1); // the cancelled waiter and the fallback: nothing happens
  vi.advanceTimersByTime(2000);
  await frame();
  expect(log).toEqual(['start', 'stop']);
  expect(classes(now[1])).toBe('Transition_slide Transition_slide-active');
});

it('disposal mid-animation: the fallback timer and a late end event do nothing, the slides are disposed, keep-alive disposes a dropped slide (clean-room finding 5)', async () => {
  const { root, scope, setKey, dispose, log } = setup({
    children: (slide: TransitionSlide) => {
      onCleanup(() => log.push(`gone ${slide.key}`));
      const b = document.createElement('b');
      b.textContent = String(slide.key);
      return b;
    },
  });
  const t = root.firstElementChild as HTMLElement;
  setKey(1);
  await frame();
  animationEnd(slidesOf(t)[1]);
  await frame();
  setKey(2); // keep-alive keeps {1, 2}: slide 0 is dropped and disposed at the step
  await frame();
  expect(log).toEqual(['start', 'stop', 'gone 0', 'start']);
  const [s1, s2] = slidesOf(t);
  dispose();
  expect(scope.isAnimating.peek()).toBe(false);
  expect(new Set(log.slice(4))).toEqual(new Set(['gone 1', 'gone 2']));
  vi.advanceTimersByTime(2000); // the 1 s end fallback would have settled the step
  s2.dispatchEvent(new Event('animationend', { bubbles: true }));
  vi.advanceTimersByTime(50);
  await frame();
  await frame();
  expect(log.length).toBe(6); // no onStop
  expect(classes(t)).toBe('Transition Transition-slide'); // no class write after dispose
  expect(classes(s1)).toBe('Transition_slide Transition_slide-from');
  expect(classes(s2)).toBe('Transition_slide Transition_slide-to');
});
