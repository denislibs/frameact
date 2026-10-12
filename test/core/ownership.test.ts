// Core perf pass, stage 3 (P3a: owner children as an intrusive doubly-linked list — O(1) append,
// O(1) removal, no arrays). Dispose order (children before self, reverse creation order), no
// recursion-depth limit on deep owner chains, removal while a dispose is iterating.
import { computed } from '../../src/core/signals';
import { createScope, dispose, getScope, onDispose, root, scoped } from '../../src/core/core';
import { STATE_DISPOSED } from '../../src/core/core';
import type { Scope } from '../../src/core/types';
import { SCOPE } from '../../src/core/symbols';
import { childrenOf } from './helpers/graph';

/** A child scope of `parent` whose dispose logs `name`. */
function child(parent: Scope, log: string[], name: string, onClean?: () => void): Scope {
  return scoped(() => {
    const s = createScope();
    scoped(() => onDispose(() => { log.push(name); onClean?.(); }), s);
    return s;
  }, parent)!;
}

describe('deep owner chains', () => {
  it('disposing a 10 000-deep owner chain does not overflow the stack; deepest first', () => {
    const order: number[] = [];
    const top = createScope();
    const nodes: Scope[] = [];
    let s = top;
    for (let i = 0; i < 10_000; i++) {
      const parent = s;
      s = scoped(() => createScope(), parent)!;
      const k = i;
      scoped(() => onDispose(() => order.push(k)), s);
      nodes.push(s);
    }
    expect(() => dispose.call(top)).not.toThrow();
    expect(order).toHaveLength(10_000);
    expect(order[0]).toBe(9_999);
    expect(order[9_999]).toBe(0);
    for (const n of nodes) expect(n._state).toBe(STATE_DISPOSED);
    expect(childrenOf(top)).toEqual([]);
  });

  it('a memo re-run disposes the 10 000-deep chain its last run created', () => {
    let runs = 0;
    let cleaned = 0;
    const $m = computed(() => {
      runs++;
      let s = getScope()!;
      for (let i = 0; i < 10_000; i++) {
        s = scoped(() => createScope(), s)!;
        scoped(() => onDispose(() => cleaned++), s);
      }
      return runs;
    });
    root(() => $m());
    const node = $m.node!;
    node._state = 2; // STATE_DIRTY: force a re-run (cleanup disposes the old chain)
    expect(() => $m()).not.toThrow();
    expect(cleaned).toBe(10_000);
    expect(childrenOf(node)).toHaveLength(1);
  });
});

describe('children list', () => {
  it('append after removals keeps creation order (first, middle, last removed)', () => {
    const log: string[] = [];
    const p = createScope();
    const [a, b, c] = ['a', 'b', 'c'].map((n) => child(p, log, n));
    dispose.call(b);
    expect(childrenOf(p)).toEqual([a, c]);
    const d = child(p, log, 'd');
    expect(childrenOf(p)).toEqual([a, c, d]);
    dispose.call(a);
    expect(childrenOf(p)).toEqual([c, d]);
    dispose.call(d);
    expect(childrenOf(p)).toEqual([c]);
    const e = child(p, log, 'e');
    expect(childrenOf(p)).toEqual([c, e]);
    dispose.call(p);
    expect(log).toEqual(['b', 'a', 'd', 'e', 'c']);
    for (const n of [a, b, c, d, e]) expect(n[SCOPE]).toBeNull();
  });

  it('removing children one by one from the middle is linear (4N ≤ 8× N)', () => {
    const N = 10_000;
    removeOneByOne(N); // warm-up (JIT)
    removeOneByOne(4 * N);
    let tN = Infinity,
      t4N = Infinity;
    for (let r = 0; r < 5; r++) {
      tN = Math.min(tN, removeOneByOne(N));
      t4N = Math.min(t4N, removeOneByOne(4 * N));
    }
    expect(t4N).toBeLessThanOrEqual(8 * tN);
  });
});

/**
 * Time to dispose `n` children of one owner one by one: every odd child (front to back), then the
 * rest from the back — middle removals at both ends of the list, with sequential memory access (a
 * random order measures cache misses more than the list). An array with indexOf/splice: O(n²).
 */
function removeOneByOne(n: number) {
  const p = createScope();
  const kids: Scope[] = [];
  for (let i = 0; i < n; i++) kids.push(scoped(() => createScope(), p)!);
  const t0 = performance.now();
  for (let i = 1; i < n; i += 2) dispose.call(kids[i]);
  for (let i = n - 2 + (n % 2); i >= 0; i -= 2) dispose.call(kids[i]);
  const ms = performance.now() - t0;
  expect(childrenOf(p)).toEqual([]);
  return ms;
}

describe('removal while a dispose is iterating', () => {
  it('a child cleanup disposing a sibling not yet visited: each disposed once, in order', () => {
    const log: string[] = [];
    const p = createScope();
    const kids: Scope[] = [];
    kids.push(child(p, log, 'c0'));
    kids.push(child(p, log, 'c1'));
    kids.push(child(p, log, 'c2', () => dispose.call(kids[0])));
    kids.push(child(p, log, 'c3'));
    scoped(() => onDispose(() => log.push('p')), p);
    dispose.call(p);
    expect(log).toEqual(['c3', 'c2', 'c0', 'c1', 'p']);
    for (const k of kids) expect(k._state).toBe(STATE_DISPOSED);
    expect(childrenOf(p)).toEqual([]);
  });

  it('a child cleanup disposing an already disposed sibling, or the next one to visit', () => {
    const log: string[] = [];
    const p = createScope();
    const kids: Scope[] = [];
    kids.push(child(p, log, 'c0'));
    kids.push(child(p, log, 'c1'));
    kids.push(child(p, log, 'c2', () => { dispose.call(kids[3]); dispose.call(kids[1]); }));
    kids.push(child(p, log, 'c3'));
    dispose.call(p);
    expect(log).toEqual(['c3', 'c2', 'c1', 'c0']);
    expect(childrenOf(p)).toEqual([]);
  });

  it('a cleanup deep in the subtree disposing the subtree root or a middle ancestor: each disposed once', () => {
    for (const target of ['top', 'middle'] as const) {
      const log: string[] = [];
      const top = createScope();
      scoped(() => onDispose(() => log.push('top')), top);
      const mid = child(top, log, 'mid');
      const sib = child(top, log, 'sib');
      const a = child(mid, log, 'a');
      child(a, log, 'leaf', () => dispose.call(target === 'top' ? top : mid));
      child(mid, log, 'b');
      void sib;
      dispose.call(top);
      // every node once; children before their owner
      expect(log).toHaveLength(6);
      expect(new Set(log)).toEqual(new Set(['a', 'b', 'leaf', 'mid', 'sib', 'top']));
      expect(log.indexOf('leaf')).toBeLessThan(log.indexOf('a'));
      expect(log.indexOf('a')).toBeLessThan(log.indexOf('mid'));
      expect(log.indexOf('b')).toBeLessThan(log.indexOf('mid'));
      expect(log.indexOf('mid')).toBeLessThan(log.indexOf('top'));
      expect(log.indexOf('sib')).toBeLessThan(log.indexOf('top'));
      expect(top._state).toBe(STATE_DISPOSED);
    }
  });

  it('a cleanup that disposes its owner from a memo re-run (cleanup path) leaves the node disposed', () => {
    const log: string[] = [];
    let n = 0;
    const $m = computed(() => {
      const me = getScope()!;
      if (n++ === 0) child(me, log, 'kid', () => dispose.call(me));
      return n;
    });
    root(() => $m());
    $m.node!._state = 2;
    $m();
    expect(log).toEqual(['kid']);
    expect($m.node!._state).toBe(STATE_DISPOSED);
  });
});

describe('stage-3 review, Minor 7: owners created or cleanups registered during a dispose', () => {
  it('D2: a child created by a cleanup under an ancestor that is on the dispose stack is disposed too', () => {
    const log: string[] = [];
    const top = createScope();
    const mid = child(top, log, 'mid');
    let late!: Scope;
    child(mid, log, 'leaf', () => {
      late = child(top, log, 'late'); // created under `top`, which is still being disposed
    });
    dispose.call(top);
    expect(log).toEqual(['leaf', 'mid', 'late']);
    expect(late._state).toBe(STATE_DISPOSED);
    expect(childrenOf(top)).toEqual([]);
  });

  it('D1: a child created by a cleanup of the node being disposed is disposed too (no orphan)', () => {
    const log: string[] = [];
    const p = createScope();
    let late!: Scope;
    scoped(() => onDispose(() => {
      log.push('p');
      late = child(p, log, 'late');
    }), p);
    dispose.call(p);
    expect(log).toEqual(['p', 'late']);
    expect(late._state).toBe(STATE_DISPOSED);
    expect(late[SCOPE]).toBeNull();
  });

  it('D3: a cleanup registered by a cleanup of the node being disposed runs', () => {
    const log: string[] = [];
    const p = createScope();
    scoped(() => onDispose(() => {
      log.push('first');
      scoped(() => onDispose(() => log.push('second')), p);
    }), p);
    dispose.call(p);
    expect(log).toEqual(['first', 'second']);
    expect(p._disposal).toBeNull();
  });

  it('a cleanup that keeps registering cleanups on its own node is cut off (no endless dispose)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = createScope();
    let n = 0;
    const again = () => {
      n++;
      scoped(() => onDispose(again), p);
    };
    scoped(() => onDispose(again), p);
    dispose.call(p);
    expect(n).toBeLessThan(1000);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('D4: a cleanup that disposes its owner during a memo re-run stops that run (no compute on a disposed node)', () => {
    const log: string[] = [];
    let runs = 0;
    const $m = computed(() => {
      runs++;
      const me = getScope()!;
      if (runs === 1) child(me, log, 'kid', () => dispose.call(me));
      return runs;
    });
    root(() => $m());
    $m.node!._state = 2;
    $m();
    expect(log).toEqual(['kid']);
    expect($m.node!._state).toBe(STATE_DISPOSED);
    expect(runs).toBe(1);
  });
});
