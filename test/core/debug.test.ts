import { createMemo, createMutationEffect, createRoot, createSignal, flushSync } from '../../src/index';
import { createComponent, effect } from '../../src/dom/component';
import { createStore } from '../../src/store/index';
import { notifyDep, notifyRoot } from '../../src/core/core';
import { describeNode, effectPath, ownerPath } from '../../src/core/debug';
import { getEffectDebugInfo, getRunningEffect, setRunObserver, type EffectNode } from '../../src/core/effects';
import { installFakeRaf } from '../helpers/raf';

let raf: ReturnType<typeof installFakeRaf>;
const disposers: (() => void)[] = [];
beforeEach(() => {
  raf = installFakeRaf();
});
afterEach(() => {
  setRunObserver(null);
  for (const d of disposers.splice(0)) d();
  flushSync(); // deferred apply-cleanups of disposed effects; nothing leaks into the next test
  raf.uninstall();
});

/** A root that is disposed after the test. */
function testRoot(fn: () => void) {
  createRoot((dispose) => {
    disposers.push(dispose);
    fn();
  });
}

/** The effect node of the binding running right now (captured from inside its compute or apply). */
function captureEffect(): EffectNode {
  const node = getRunningEffect();
  if (node === null) throw new Error('no running effect');
  return node;
}

it('effectPath walks the component names down to the binding label and skips generic ids', () => {
  let node!: EffectNode;
  testRoot(() => {
    createComponent(
      () =>
        createComponent(
          () => {
            createMemo(() => 1)(); // a generic "computed" between the owners
            effect(() => 1, () => { node = captureEffect(); }, { name: 'span.style:color' });
            return null;
          },
          {},
          'MessageMeta',
        ),
      {},
      'Message',
    );
  });
  expect(ownerPath(node)).toEqual(['Message', 'MessageMeta', 'span.style:color']);
  expect(effectPath(node)).toBe('Message > MessageMeta > span.style:color');
});

it('consecutive duplicate labels collapse (insert nests a second effect under the same label); a facade name stands alone', () => {
  let inner!: EffectNode;
  let bare!: EffectNode;
  testRoot(() => {
    createComponent(
      () => {
        // insert's shape: the nested effect is created inside the outer COMPUTE (owned by it)
        effect(
          () => {
            effect(() => 1, () => { inner = captureEffect(); }, { name: 'span.children' });
            return 1;
          },
          () => {},
          { name: 'span.children' },
        );
        return null;
      },
      {},
      'Message',
    );
    createMutationEffect(() => 1, () => { bare = captureEffect(); });
  });
  expect(effectPath(inner)).toBe('Message > span.children');
  expect(effectPath(bare)).toBe('mutation');
  expect(describeNode(null)).toBe('an unknown source');
});

it('records which signal dirtied an effect (the walk root) and the memo it came through (the dep); counts runs', () => {
  const [count, setCount] = createSignal(0, { id: 'count' });
  let node!: EffectNode;
  testRoot(() => {
    createComponent(
      () => {
        const doubled = createMemo(() => count() * 2, { id: 'doubled' });
        createMutationEffect(() => doubled(), () => { node = captureEffect(); }, { name: 'div.children' });
        return null;
      },
      {},
      'Counter',
    );
  });
  expect(getEffectDebugInfo(node)).toEqual({ dep: null, root: null, runs: 1 });
  setCount(1);
  const info = getEffectDebugInfo(node)!;
  expect(describeNode(info.root)).toBe('signal "count"');
  expect(describeNode(info.dep)).toBe('memo "doubled" in Counter');
  flushSync();
  // cleared once the run is done (a store leaf released meanwhile is not kept alive by the effect)
  expect(getEffectDebugInfo(node)).toEqual({ dep: null, root: null, runs: 2 });
});

it('a store leaf names its key', () => {
  const [state, setState] = createStore({ title: 'a' });
  let node!: EffectNode;
  testRoot(() => {
    createMutationEffect(() => state.title, () => { node = captureEffect(); });
  });
  setState('title', 'b');
  const info = getEffectDebugInfo(node)!;
  expect(describeNode(info.root)).toBe('signal "store.title"');
  expect(info.dep).toBe(info.root);
});

it('the run observer sees every scheduled run with a duration (not the creation run)', () => {
  const [n, setN] = createSignal(0);
  const seen: string[] = [];
  setRunObserver((node, ms) => { seen.push(`${effectPath(node)}:${typeof ms}`); });
  testRoot(() => {
    createMutationEffect(() => n(), () => {}, { name: 'div.title' });
  });
  expect(seen).toEqual([]);
  setN(1);
  flushSync();
  expect(seen).toEqual(['div.title:number']);
});

it('the notify walk does not keep the last written node (a store leaf, its subtree) reachable once it is done', () => {
  const [state, setState] = createStore({ title: 'a', list: [1, 2, 3] });
  testRoot(() => {
    createMutationEffect(() => state.title, () => {});
  });
  setState('title', 'b');
  flushSync();
  expect(notifyDep).toBeNull();
  expect(notifyRoot).toBeNull();
});
