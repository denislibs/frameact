import { createHeavyAnimationScope, createMutationEffect, createRoot, createSignal, currentHeavyAnimationScope, rootScope } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { HeavyAnimationScope } from '../../src/dom/scope';
import { useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

it('effects created inside wait for a blocking animation on the scope; siblings outside do not; the release lands next frame', async () => {
  const scope = createHeavyAnimationScope();
  const [n, setN] = createSignal(0);
  const inside: number[] = [];
  const outside: number[] = [];
  createRoot(() => {
    // children are resolved lazily, when the result is read (insert does that in the DOM)
    (createComponent(HeavyAnimationScope, {
      scope,
      get children() {
        createMutationEffect(() => n(), (v) => { inside.push(v); });
        return null;
      },
    }) as () => unknown)();
    createMutationEffect(() => n(), (v) => { outside.push(v); });
  });
  const end = scope.begin(Infinity, true);
  setN(1);
  await frame();
  expect(outside).toEqual([0, 1]);
  expect(inside).toEqual([0]);
  end();
  await frame();
  expect(inside).toEqual([0, 1]);
});

it('without a scope prop it creates a child scope of the enclosing one and returns its children', () => {
  let captured: ReturnType<typeof createHeavyAnimationScope> | undefined;
  const result = createRoot(() =>
    createComponent(HeavyAnimationScope, {
      get children() {
        captured = currentHeavyAnimationScope();
        return 'kids';
      },
    }),
  );
  expect((result as () => unknown)()).toBe('kids');
  expect(captured).not.toBe(rootScope);
  expect(captured!.parent).toBe(rootScope);
  expect(currentHeavyAnimationScope()).toBe(rootScope);
});

it('children are tracked: a ternary child switches branches', () => {
  const [flag, setFlag] = createSignal(true);
  createRoot(() => {
    const out = createComponent(HeavyAnimationScope, {
      get children() {
        return flag() ? 'A' : 'B';
      },
    }) as () => unknown;
    expect(out()).toBe('A');
    setFlag(false);
    expect(out()).toBe('B');
  });
});

it('a function child runs under the scope: its effects are gated by the scope animation', async () => {
  const scope = createHeavyAnimationScope();
  const [n, setN] = createSignal(0);
  const seen: number[] = [];
  createRoot(() => {
    const out = createComponent(HeavyAnimationScope, {
      scope,
      get children() {
        return () => {
          createMutationEffect(() => n(), (v) => { seen.push(v); });
          return null;
        };
      },
    }) as () => unknown;
    out();
  });
  const end = scope.begin(Infinity, true);
  setN(1);
  await frame();
  expect(seen).toEqual([0]);
  end();
  await frame();
  expect(seen).toEqual([0, 1]);
});

it('a nested <HeavyAnimationScope> without a prop waits on the outer blocking animation', async () => {
  const outer = createHeavyAnimationScope();
  const [n, setN] = createSignal(0);
  const seen: number[] = [];
  createRoot(() => {
    (createComponent(HeavyAnimationScope, {
      scope: outer,
      get children() {
        return createComponent(HeavyAnimationScope, {
          get children() {
            createMutationEffect(() => n(), (v) => { seen.push(v); });
            return null;
          },
        });
      },
    }) as () => unknown)();
  });
  const end = outer.begin(Infinity, true);
  setN(1);
  await frame();
  expect(seen).toEqual([0]);
  end();
  await frame();
  expect(seen).toEqual([0, 1]);
});

it('disposing the subtree during a blocking animation drops its parked run', async () => {
  const scope = createHeavyAnimationScope();
  const [n, setN] = createSignal(0);
  const seen: number[] = [];
  const dispose = createRoot((d) => {
    (createComponent(HeavyAnimationScope, {
      scope,
      get children() {
        createMutationEffect(() => n(), (v) => { seen.push(v); });
        return null;
      },
    }) as () => unknown)();
    return d;
  });
  const end = scope.begin(Infinity, true);
  setN(1);
  await frame();
  dispose();
  end();
  await frame();
  expect(seen).toEqual([0]);
});

it('warns in DEV when rendered without an owner', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    createComponent(HeavyAnimationScope, {});
    expect(warn.mock.calls.some((c) => String(c[0]).includes('HeavyAnimationScope'))).toBe(true);
  } finally {
    warn.mockRestore();
  }
});
