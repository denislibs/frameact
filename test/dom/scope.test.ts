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
    createComponent(HeavyAnimationScope, {
      scope,
      get children() {
        createMutationEffect(() => n(), (v) => { inside.push(v); });
        return null;
      },
    });
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
  expect(result).toBe('kids');
  expect(captured).not.toBe(rootScope);
  expect(captured!.parent).toBe(rootScope);
  expect(currentHeavyAnimationScope()).toBe(rootScope);
});
