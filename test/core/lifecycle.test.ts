import {
  beginHeavyAnimation, createEffect, createHeavyAnimationScope, getOwner, createMemo, createMutationEffect, createRoot, createSignal, getPhase,
  onCleanup, onDestroy, onHeavyAnimation, onMount, provideHeavyAnimationScope, watchHeavyAnimation,
} from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

describe('onMount', () => {
  it('runs once, after attach, in the measure phase; it sees real layout and does not re-run on signal changes', async () => {
    const root = container();
    const [n, setN] = createSignal(0);
    const log: string[] = [];
    const Comp = () => {
      const el = document.createElement('div');
      onMount(() => {
        log.push(`${getPhase()}:${el.isConnected}:${n()}`);
      });
      insert(el, () => String(n()));
      return el;
    };
    createRoot(() => insert(root, createComponent(Comp, {})));
    expect(log).toEqual([]); // not synchronous: the nodes are detached at creation
    await frame();
    expect(log).toEqual(['measure:true:0']);
    setN(1);
    await frame();
    expect(log).toEqual(['measure:true:0']); // untracked: the read of n() inside did not subscribe
  });

  it('a returned cleanup runs on dispose, in owner cleanup order with onCleanup; it never runs if the owner dies before mount', async () => {
    const log: string[] = [];
    const dispose = createRoot((d) => {
      onCleanup(() => log.push('cleanup-1'));
      onMount(() => () => log.push('mount-cleanup'));
      onCleanup(() => log.push('cleanup-2'));
      return d;
    });
    await frame();
    expect(log).toEqual([]);
    dispose();
    // the mount cleanup was registered at mount time (after both onCleanup calls), so it runs after them (LIFO)
    expect(log).toEqual(['mount-cleanup', 'cleanup-2', 'cleanup-1']);

    const early: string[] = [];
    const disposeEarly = createRoot((d) => {
      onMount(() => {
        early.push('mounted');
        return () => early.push('cleanup');
      });
      return d;
    });
    disposeEarly(); // before the first frame: the measure effect is disposed with its owner
    await frame();
    expect(early).toEqual([]);
  });
});

describe('onMount — owner and node lifetime', () => {
  it('fn runs under the owner: onCleanup and createEffect inside it belong to the component (no DEV error), and die with it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const [n, setN] = createSignal(0);
    const log: string[] = [];
    const dispose = createRoot((d) => {
      onMount(() => {
        onCleanup(() => log.push('cleanup'));
        createEffect(() => n(), (v) => { log.push(`effect:${v}`); });
      });
      return d;
    });
    await frame();
    setN(1);
    await flushMicrotasks();
    expect(log).toEqual(['effect:0', 'effect:1']);
    dispose();
    expect(log).toEqual(['effect:0', 'effect:1', 'cleanup']);
    setN(2);
    await flushMicrotasks();
    expect(log).toHaveLength(3); // the effect died with the owner
    expect(error).not.toHaveBeenCalled();
  });

  it('releases its measure-effect node after the first run: the owner holds no child for it any more', async () => {
    const owner = createRoot(() => {
      onMount(() => {});
      return getOwner() as unknown as { _lastChild: unknown };
    });
    expect(owner._lastChild).not.toBeNull(); // waiting for the first frame
    await frame();
    expect(owner._lastChild).toBeNull();
  });

  it('still waits for a blocking heavy animation of the owner\'s scope', async () => {
    const scope = createHeavyAnimationScope();
    const log: string[] = [];
    createRoot(() => {
      provideHeavyAnimationScope(scope);
      onMount(() => { log.push('mounted'); });
    });
    const end = scope.begin(Infinity, true);
    await frame();
    expect(log).toEqual([]);
    end();
    await frame();
    expect(log).toEqual(['mounted']);
  });
});

describe('onDestroy', () => {
  it('runs once when the component is disposed (not on signal changes); DEV warns inside an effect or memo compute', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [n, setN] = createSignal(0);
    const log: string[] = [];
    const Comp = () => {
      onDestroy(() => log.push('destroy'));
      createEffect(() => n(), () => {});
      return null;
    };
    const dispose = createRoot((d) => {
      createComponent(Comp, {});
      return d;
    });
    setN(1);
    await flushMicrotasks();
    expect(log).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    dispose();
    expect(log).toEqual(['destroy']);

    createRoot(() => {
      createMemo(() => {
        onDestroy(() => {});
        return 1;
      })();
      createMutationEffect(() => {
        onDestroy(() => {});
        return 1;
      }, () => {});
    });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('onCleanup');
    warn.mockClear();
    onDestroy(() => {}); // no owner
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('no owner');
  });
});

describe('watchHeavyAnimation', () => {
  it('listens on the owner\'s scope by default, fires onStart at once if animating, and unsubscribes on dispose', () => {
    const scope = createHeavyAnimationScope();
    const log: string[] = [];
    const end1 = scope.begin(Infinity);
    const dispose = createRoot((d) => {
      provideHeavyAnimationScope(scope);
      watchHeavyAnimation(() => log.push('start'), () => log.push('end'));
      return d;
    });
    expect(log).toEqual(['start']); // already animating
    end1();
    expect(log).toEqual(['start', 'end']);
    const end2 = scope.begin(Infinity);
    expect(log).toEqual(['start', 'end', 'start']);
    dispose();
    end2();
    expect(log).toEqual(['start', 'end', 'start']); // unsubscribed with the owner
  });
});

describe('watchHeavyAnimation under a nested scope (client I3: a sticker under a Transition while a Modal animates on the root)', () => {
  it('hears a blocking animation begun on the root scope', () => {
    const scope = createHeavyAnimationScope(); // parent: the root scope
    const log: string[] = [];
    const end = beginHeavyAnimation(Infinity, true);
    try {
      const dispose = createRoot((d) => {
        provideHeavyAnimationScope(scope);
        watchHeavyAnimation(() => log.push('start'), () => log.push('end'));
        return d;
      });
      expect(log).toEqual(['start']);
      end();
      expect(log).toEqual(['start', 'end']);
      dispose();
    } finally {
      end();
    }
  });
});

it('the documented disable flag: an effect that subscribes with onHeavyAnimation while enabled and returns the unsubscribe', async () => {
  const scope = createHeavyAnimationScope(null);
  const [disabled, setDisabled] = createSignal(false);
  const log: string[] = [];
  const dispose = createRoot((d) => {
    createEffect(
      () => disabled(),
      (off) => (off ? undefined : onHeavyAnimation(() => log.push('start'), () => log.push('end'), scope)),
    );
    return d;
  });
  await flushMicrotasks(); // tickEnd: first apply subscribes
  scope.begin(Infinity)();
  expect(log).toEqual(['start', 'end']);
  setDisabled(true);
  await flushMicrotasks(); // cleanup unsubscribed
  scope.begin(Infinity)();
  expect(log).toEqual(['start', 'end']);
  setDisabled(false);
  await flushMicrotasks();
  const end = scope.begin(Infinity);
  expect(log).toEqual(['start', 'end', 'start']);
  dispose();
  end();
  expect(log).toEqual(['start', 'end', 'start']); // gone with the owner
});
