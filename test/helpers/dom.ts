import { installFakeRaf } from './raf';
import { frame as fireFrame } from './frame';
import { flushMicrotasks } from './micro';

/**
 * Per-file DOM harness: fake rAF (frames fire only through `frame()`), pending frames drained in
 * afterEach (fasterdom/fastRaf throttle state is module-global), body cleared.
 */
export function useDomHarness() {
  let raf: ReturnType<typeof installFakeRaf>;
  beforeEach(() => {
    raf = installFakeRaf();
  });
  afterEach(async () => {
    for (let i = 0; i < 10 && raf.pending(); i++) {
      raf.frame();
      await flushMicrotasks();
    }
    raf.uninstall();
    document.body.textContent = '';
  });
  return {
    frame: () => fireFrame(raf),
    pending: () => raf.pending(),
  };
}

/** An attached, empty container. */
export function container(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}
