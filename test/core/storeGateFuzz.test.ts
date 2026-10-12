// Cause-tagged parking fuzz (spec §5 "фазз гейта"): random graphs of store leaves, local signals, memos
// (global and scoped) and frame effects in nested scopes; random writes, animations and flushes.
// Every effect owns a child effect on a local signal (the ancestor rule is exercised). Invariants:
//  1. no lost update: once every animation ended and everything flushed, every effect's last value
//     equals its function evaluated on the current state;
//  2. gate: an effect never runs inside an animating scope unless one of its (transitive) local
//     signals — its child's included — changed since its previous run, or an ungated write happened since;
//  3. local updates are never gated: an effect whose local dep changed, and every child whose local
//     signal changed, is current after the next flush;
//  4. liveness: an effect whose scope chain is not animating is current after every flush.
// FUZZ_SEED=<n> runs one seed; FUZZ_N=<n> the first n seeds (default 300; 20 000 take about 5 s — more than
// the 5 s default test timeout from ~25 000 seeds on, so run bigger ones with `--testTimeout=0`).
import {
  createHeavyAnimationScope, createMemo, createMutationEffect, createRoot, createSignal, flushSync,
  provideHeavyAnimationScope, untrack, type HeavyAnimationScope,
} from '../../src/index';
import { leaf } from './helpers/storeLeaf';
import { useDomHarness } from '../helpers/dom';

useDomHarness();

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Dep = { kind: 'store' | 'local' | 'memo'; i: number };

function isAnimating(scope: HeavyAnimationScope | null): boolean {
  for (let s = scope; s; s = s.parent) if (s.isAnimating.peek()) return true;
  return false;
}

/** Exact (no hash collisions): a changed input always changes the value. */
function evalDeps(deps: Dep[], read: (d: Dep) => number | string) {
  return `(${deps.map(read).join(',')})`;
}

function runSeed(seed: number): string[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const S = 5, L = 3, M = 5, E = 8;
  const leaves = Array.from({ length: S }, () => leaf(0));
  const locals = Array.from({ length: L }, () => createSignal(0));
  const localVersion = Array.from({ length: L }, () => 0);
  const outer = createHeavyAnimationScope();
  const scopes: (HeavyAnimationScope | null)[] = [null, outer, createHeavyAnimationScope(outer), createHeavyAnimationScope()];

  // memos: deps among leaves / locals / earlier memos; created globally or in a scope
  const memoLocals: Set<number>[] = [];
  const memos: (() => string)[] = [];
  const readDep = (d: Dep): number | string => (d.kind === 'store' ? leaves[d.i].get() : d.kind === 'local' ? locals[d.i][0]() : memos[d.i]());
  for (let m = 0; m < M; m++) {
    const deps: Dep[] = [];
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const roll = r();
      if (roll < 0.45) deps.push({ kind: 'store', i: Math.floor(r() * S) });
      else if (roll < 0.75 || m === 0) deps.push({ kind: 'local', i: Math.floor(r() * L) });
      else deps.push({ kind: 'memo', i: Math.floor(r() * m) });
    }
    const ls = new Set<number>();
    for (const d of deps) {
      if (d.kind === 'local') ls.add(d.i);
      if (d.kind === 'memo') for (const x of memoLocals[d.i]) ls.add(x);
    }
    memoLocals.push(ls);
    const scope = pick(scopes);
    memos.push(createRoot(() => {
      if (scope) provideHeavyAnimationScope(scope);
      return createMemo(() => evalDeps(deps, readDep));
    }));
  }

  type Eff = { deps: Dep[]; scope: HeavyAnimationScope | null; locals: Set<number>; seen: number[]; seenVals: number[]; ungatedSeen: number; last: string | undefined; runs: number; fn: () => string };
  const ungatedWrites = { n: 0 };
  const effects: Eff[] = [];
  const childVals: number[] = []; // childVals[e]: the last value effect e's child saw of locals[e % L]
  const violations: string[] = [];
  const trace: string[] = [];
  for (let e = 0; e < E; e++) {
    const deps: Dep[] = [];
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const roll = r();
      if (roll < 0.4) deps.push({ kind: 'store', i: Math.floor(r() * S) });
      else if (roll < 0.65) deps.push({ kind: 'local', i: Math.floor(r() * L) });
      else deps.push({ kind: 'memo', i: Math.floor(r() * M) });
    }
    const ls = new Set<number>();
    for (const d of deps) {
      if (d.kind === 'local') ls.add(d.i);
      if (d.kind === 'memo') for (const x of memoLocals[d.i]) ls.add(x);
    }
    const eff: Eff = { deps, scope: pick(scopes), locals: ls, seen: [], seenVals: [], ungatedSeen: 0, last: undefined, runs: 0, fn: () => evalDeps(deps, readDep) };
    effects.push(eff);
    const ci = e % L; // the child's local signal
    createRoot(() => {
      if (eff.scope) provideHeavyAnimationScope(eff.scope);
      createMutationEffect(() => {
        const v = eff.fn();
        // the child: a plain-dirty descendant whose run bails onto this effect (ancestor rule)
        createMutationEffect(() => { const cv = locals[ci][0](); childVals[e] = cv; return cv; }, () => {});
        if (eff.runs > 0 && isAnimating(eff.scope)) {
          const localChanged = [...eff.locals, ci].some((i) => localVersion[i] !== eff.seen[i]) || ungatedWrites.n !== eff.ungatedSeen;
          if (!localChanged) violations.push(`seed ${seed}: effect ${e} ran in an animating scope without a local change [${trace.join(' | ')}]`);
        }
        for (let i = 0; i < L; i++) {
          eff.seen[i] = localVersion[i];
          eff.seenVals[i] = untrack(locals[i][0]);
        }
        eff.ungatedSeen = ungatedWrites.n;
        eff.runs++;
        eff.last = v;
        return v;
      }, () => {});
    });
  }
  flushSync();

  const ends: (() => void)[] = [];
  for (let op = 0; op < 120; op++) {
    const roll = r();
    if (roll < 0.35) {
      const k = Math.floor(r() * S), v = Math.floor(r() * 4);
      trace.push(`s${k}=${v}`);
      leaves[k].set(v);
    } else if (roll < 0.55) {
      const i = Math.floor(r() * L);
      const v = Math.floor(r() * 4);
      if (untrack(locals[i][0]) !== v) localVersion[i]++;
      trace.push(`l${i}=${v}`);
      locals[i][1](v);
    } else if (roll < 0.62) {
      const s = pick(scopes.filter(Boolean) as HeavyAnimationScope[]);
      trace.push(`begin ${scopes.indexOf(s)}`);
      ends.push(s.begin(Infinity));
    } else if (roll < 0.72 && ends.length) {
      trace.push('end');
      ends.splice(Math.floor(r() * ends.length), 1)[0]();
    } else if (roll < 0.74) {
      ungatedWrites.n++; // may legitimately run gated effects (invariant 2 allows a run after it)
      trace.push('ungated');
      leaves[Math.floor(r() * S)].setPlain(Math.floor(r() * 4));
    } else {
      // invariant 3 is checked per flush: effects with a changed local dep must be current afterwards
      trace.push('flush');
      flushSync();
      for (let e = 0; e < E; e++) {
        const eff = effects[e];
        if ([...eff.locals].some((i) => untrack(locals[i][0]) !== eff.seenVals[i])) {
          violations.push(`seed ${seed}: effect ${e} did not run after a local change [${trace.join(' | ')}]`);
        }
        if (childVals[e] !== untrack(locals[e % L][0])) {
          violations.push(`seed ${seed}: the child of effect ${e} did not run after a local change [${trace.join(' | ')}]`);
        }
        if (!isAnimating(eff.scope) && eff.last !== untrack(eff.fn)) {
          violations.push(`seed ${seed}: effect ${e} is stale outside an animation [${trace.join(' | ')}]`);
        }
      }
    }
  }
  while (ends.length) ends.pop()!();
  flushSync();
  flushSync();
  for (const eff of effects) {
    const expected = untrack(eff.fn);
    if (eff.last !== expected) violations.push(`seed ${seed}: effect ${effects.indexOf(eff)} stale: ${eff.last} !== ${expected} [${trace.join(' | ')}]`);
  }
  return violations;
}

it('cause-tagged parking holds its invariants on 300 random graphs', () => {
  const from = Number(process.env.FUZZ_SEED ?? 1);
  const to = Number(process.env.FUZZ_SEED ?? process.env.FUZZ_N ?? 300);
  const all: string[] = [];
  for (let seed = from; seed <= to; seed++) all.push(...runSeed(seed));
  expect(all.slice(0, 10)).toEqual([]);
});
