// P3a (perf review): monomorphic node shapes. V8 hidden classes can't be inspected without
// --allow-natives-syntax, so this compares own-key lists (order + length): nodes built through the
// same constructor path with the same field set end up with the same hidden class.
import { createScope, getScope, onError, root } from '../../src/core/core';
import { computed, signal } from '../../src/core/signals';
import { createEffect, type EffectNode } from '../../src/core/effects';
import { createMeasureEffect, createMutationEffect, frameForcedReflow } from '../../src/core/frame';
import { selector } from '../../src/core/selector';
import type { Computation, Scope } from '../../src/core/types';
import { SCOPE } from '../../src/core/symbols';
import { installFakeRaf } from '../helpers/raf';
import { frame } from '../helpers/frame';
import { flushMicrotasks } from '../helpers/micro';
import { createMemo, createSignal } from '../../src/index';
import { depsOf } from './helpers/graph';

const keysOf = (node: object) => Reflect.ownKeys(node).map(String);

let raf: ReturnType<typeof installFakeRaf>;
beforeEach(() => { raf = installFakeRaf(); });
afterEach(async () => {
  for (let i = 0; i < 10 && raf.pending(); i++) { raf.frame(); await flushMicrotasks(); }
  raf.uninstall();
});

it('signals, signals with `dirty`, computeds (before and after their first read) share one key list', () => {
  const plain = signal(0).node!;
  const withDirty = signal(0, { dirty: (a, b) => a !== b }).node!;
  const $c = computed(() => 1);
  const memo = $c.node!;
  const before = keysOf(memo);
  $c();
  const owned = root(() => computed(() => plain._value).node!); // appended to an owner
  const list = keysOf(plain);
  expect(keysOf(withDirty)).toEqual(list);
  expect(before).toEqual(list);
  expect(keysOf(memo)).toEqual(list);
  expect(keysOf(owned)).toEqual(list);
});

it('a scope initialises the shared scope fields: its key list is the prefix of a computation\'s', () => {
  const scope = createScope();
  const nested = root(() => { onError(() => {}); return createScope(); });
  // Object.keys: string keys in creation order (Reflect.ownKeys would list the SCOPE symbol last)
  const comp = Object.keys(signal(0).node!);
  // (`_mapMemo` is the one suffix field: set to undefined in the constructor so that a list's scope,
  // which gets it assigned by linkMap, shares the hidden class of every other scope.)
  const scopeKeys = Object.keys(scope);
  expect(scopeKeys[scopeKeys.length - 1]).toBe('_mapMemo');
  expect(scopeKeys.slice(0, -1)).toEqual(comp.slice(0, scopeKeys.length - 1));
  expect(keysOf(nested)).toEqual(keysOf(scope));
  expect(Reflect.ownKeys(scope)).toContain(SCOPE);
  for (const k of ['_context', '_handlers', '_disposal', '_compute', '_state', '_lastChild', '_prevSibling', '_nextSibling']) {
    expect(keysOf(scope)).toContain(k);
  }
});

it('every effect node has the same key list, whatever its scheduler, options, owner or history', async () => {
  const nodes: EffectNode[] = [];
  const grab = () => { nodes.push(getScope() as EffectNode); };
  const $a = signal(0);
  root(() => {
    createEffect(() => { grab(); return $a(); }, () => () => {});
    createEffect(() => { grab(); return $a(); }, () => {}, undefined, { name: 'named' });
    createMutationEffect(() => { grab(); return $a(); }, () => {});
    createMeasureEffect(() => { grab(); return $a(); }, () => {});
    createEffect(() => { grab(); return $a(); }, () => {}, frameForcedReflow);
    root(() => {
      onError(() => {});
      createEffect(() => { grab(); return $a(); }, () => {});
    });
    // a parent effect with a child that bails onto it
    createEffect(() => {
      grab();
      $a();
      createEffect(() => { grab(); return $a(); }, () => {});
    }, () => {});
  });
  const first = keysOf(nodes[0]);
  const atCreation = nodes.map(keysOf);
  await flushMicrotasks();
  await frame(raf);
  $a.set(1);
  await flushMicrotasks();
  await frame(raf);
  for (const node of nodes) expect(keysOf(node)).toEqual(first);
  for (const keys of atCreation) expect(keys).toEqual(first);
  // an effect is a computation with extra fields: it starts with the computation key list
  const comp = Object.keys(signal(0).node!);
  expect(Object.keys(nodes[0]).slice(0, comp.length)).toEqual(comp);
});

it('a selector node has the full computation field set (then its own fields)', () => {
  const $key = signal(1);
  let node!: Computation;
  root(() => {
    const isSelected = selector($key);
    isSelected(1);
    const owner = getScope() as Scope;
    node = owner._disposal as unknown as Computation; // the selector node registers itself as a disposal
  });
  const comp = Object.keys(signal(0).node!);
  expect(Object.keys(node).slice(0, comp.length)).toEqual(comp);
  expect(Reflect.ownKeys(node)).toContain(SCOPE);
});

/** The node behind a createSignal accessor: the first dep of a memo that read it. */
function nodeOfAccessor(get: () => unknown): Computation {
  let owner!: Computation;
  const m = createMemo(() => {
    owner = getScope() as Computation;
    return get();
  });
  m();
  return depsOf(owner)[0];
}

describe('P5: public createSignal nodes are slim', () => {
  it('every createSignal node has the same small key list (plain, equals: false, custom equals, id)', () => {
    const nodes = [
      createSignal(0),
      createSignal('x', { equals: false }),
      createSignal({ a: 1 }, { equals: (a, b) => a.a === b.a }),
      createSignal(0, { id: 'named' }),
    ].map(([get]) => nodeOfAccessor(get));
    const first = keysOf(nodes[0]);
    for (const n of nodes) expect(keysOf(n)).toEqual(first);
    // only what a dependency needs (+ the DEV id): no owner, children, deps or compute fields
    expect(first).toHaveLength(7);
    expect(new Set(first)).toEqual(new Set(['_changed', '_state', '_subs', '_subsTail', '_value', '_writtenAt', 'id']));
  });

  it('DEV id: the given id, or "signal"', () => {
    expect(nodeOfAccessor(createSignal(0, { id: 'count' })[0]).id).toBe('count');
    expect(nodeOfAccessor(createSignal(0)[0]).id).toBe('signal');
  });

  it('a slim node keeps its key list after writes, subscriptions and unsubscriptions', () => {
    const [get, set] = createSignal(1);
    const node = nodeOfAccessor(get);
    const before = keysOf(node);
    const dispose = root((d) => {
      createEffect(() => get(), () => {});
      return d;
    });
    set(2);
    set((p) => p + 1);
    dispose();
    expect(keysOf(node)).toEqual(before);
  });
});
