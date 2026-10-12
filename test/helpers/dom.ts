import { installFakeRaf } from './raf';
import { frame as fireFrame } from './frame';
import { flushMicrotasks } from './micro';
import { clearDelegatedEvents } from '../../src/dom/events';
import { getNatives } from '../../src/dom/natives';

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
    clearDelegatedEvents();
    document.body.textContent = '';
    vi.restoreAllMocks(); // spies on the shared natives object (spyNodeOps) and console spies must not outlive a test
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

type NodeOp = 'insertBefore' | 'appendChild' | 'replaceChild' | 'removeChild';

/**
 * Spies on the DOM writes the runtime makes on `parent`. The runtime calls the prototype natives
 * (`Node.prototype.insertBefore.call(parent, …)`, see `src/dom/natives.ts`), so an instance spy
 * (`vi.spyOn(parent, 'insertBefore')`) never fires; this wraps the cached natives and records only
 * the calls whose receiver is `parent`. Restored by `vi.restoreAllMocks()`.
 */
export function spyNodeOps<M extends NodeOp>(parent: Node, ...methods: M[]): Record<M, ReturnType<typeof vi.fn>> {
  const natives = getNatives() as unknown as Record<string, (...args: unknown[]) => unknown>;
  const out = {} as Record<M, ReturnType<typeof vi.fn>>;
  for (const method of methods) {
    const recorder = vi.fn();
    const original = natives[method];
    vi.spyOn(natives, method).mockImplementation(function (this: Node, ...args: unknown[]) {
      if (this === parent) recorder(...args);
      return original.apply(this, args);
    });
    out[method] = recorder;
  }
  return out;
}
