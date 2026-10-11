// Core perf pass, stage 2 (P4: the dependency graph as doubly-linked Link lists). Differential fuzz,
// written against the array implementation (`_sources`/`_observers`) BEFORE the port and kept green
// after it. Random DAGs of signals / memos / effects (fan-in, fan-out, diamonds, jagged depths,
// conditional reads that switch deps, reads in varying order, repeated reads), random write
// sequences (batched, interleaved with partial reads, writes inside computes under the latch
// rules). Oracle: each node's pure function re-evaluated from the current signal values.
// Deterministic (seeded PRNG); a failure names its seed and mode — rerun one with FUZZ_SEED.
import { computed, signal } from '../../src/core/signals';
import { getScope, root, untrack } from '../../src/core/core';
import { createEffect, type Schedule } from '../../src/core/effects';
import type { Computation, ReadSignal, WriteSignal } from '../../src/core/types';
import { depsOf, subsOf } from './helpers/graph';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Spec {
  kind: 'memo' | 'effect';
  /** node read first; its parity picks the read list (-1: always list a) */
  cond: number;
  a: number[];
  b: number[];
  k: number;
  /**
   * writer: reads `inputs` unconditionally, then writes W signal `target` = g(inputs). `viaDirty`
   * (memos): after its first run the write is made by the memo's `dirty` (equals) callback.
   */
  writer: { target: number; inputs: number[]; before: boolean; viaDirty: boolean } | null;
  /** 1 / 2: the compute creates an owned memo / signal and reads it first (re-linked every run) */
  owned: number;
}

/** FUZZ_BIG=1: larger graphs than the default runs use (manual sweeps; old seeds change graphs). */
const BIG = typeof process !== 'undefined' && process.env.FUZZ_BIG === '1';
/** Termination check for synchronous runs: runs of all nodes in one step. */
const SYNC_HANG_GUARD = 1_000_000;

const MOD = 5; // small value domain: equal results are common (equality cut-offs are exercised)

function evalSpec(spec: Spec, rd: (j: number) => number, write: ((w: number, v: number) => void) | null) {
  let wv = 0;
  if (spec.writer) {
    for (const j of spec.writer.inputs) wv += rd(j);
    wv = (wv + 1) % 3;
    if (spec.writer.before && write) write(spec.writer.target, wv);
  }
  const list = spec.cond >= 0 && rd(spec.cond) % 2 === 1 ? spec.b : spec.a;
  let v = spec.k;
  for (let i = 0; i < list.length; i++) v += (i + 1) * rd(list[i]);
  if (spec.writer && !spec.writer.before && write) write(spec.writer.target, wv);
  return v % MOD;
}

/** `sync`: effects run synchronously from inside notify() (a custom `(run) => run()` schedule). */
function runFuzz(seed: number, withWriters: boolean, sync = false) {
  const rand = mulberry32(seed);
  // Features added later draw from their own stream, so older seeds keep their graphs.
  const rand2 = mulberry32(seed ^ 0x9e3779b9);
  const int = (n: number) => Math.floor(rand() * n);
  const shuffle = <T>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  // A failure detected inside a compute is thrown there too (the framework may catch and log it:
  // effects do), so it is also kept and re-thrown after the step.
  let firstFailure: Error | null = null;
  const fail = (msg: string): never => {
    firstFailure ??= new Error(`[deps fuzz] seed ${seed} (${withWriters ? 'writers' : 'pure'}${sync ? ', sync' : ''}): ${msg}`);
    throw firstFailure;
  };

  const nBase = 2 + int(5);
  const nW = withWriters ? 1 + int(3) : 0;
  const nMemo = 4 + int(BIG ? 36 : 16);
  const nEff = 1 + int(BIG ? 10 : 6);
  const firstW = nBase,
    firstMemo = nBase + nW,
    firstEff = firstMemo + nMemo,
    total = firstEff + nEff;

  // --- graph spec --------------------------------------------------------------------------
  const specs: (Spec | null)[] = Array.from({ length: total }, () => null);
  // mask: which W signals a node's value may depend on (W_k ⊆ bits 0..k, conservative)
  const mask = new Array<number>(total).fill(0);
  for (let k = 0; k < nW; k++) mask[firstW + k] = (1 << (k + 1)) - 1;
  let nextWriter = 0;
  // node i may read any id < i that is not an effect (signals, W signals, earlier memos)
  const pick = (limit: number) => int(Math.min(limit, firstEff));
  const pickList = (limit: number) => {
    const len = 1 + int(BIG ? 6 : 4);
    const out: number[] = [];
    for (let t = 0; t < len; t++) {
      if (out.length && rand() < 0.15) out.push(out[int(out.length)]); // repeated read
      else out.push(pick(limit));
    }
    return out;
  };
  for (let i = firstMemo; i < total; i++) {
    const a = pickList(i);
    const cond = rand() < 0.5 ? pick(i) : -1;
    const b = rand() < 0.5 ? shuffle([...a]) : pickList(i);
    let writer: Spec['writer'] = null;
    if (nextWriter < nW && rand() < 0.35) {
      const k = nextWriter++;
      const allowed: number[] = [];
      for (let j = 0; j < Math.min(i, firstEff); j++) if (mask[j] < 1 << k) allowed.push(j);
      const inputs = Array.from({ length: 1 + int(2) }, () => allowed[int(allowed.length)]);
      writer = { target: firstW + k, inputs, before: rand() < 0.4, viaDirty: false };
    }
    const spec: Spec = { kind: i < firstEff ? 'memo' : 'effect', cond, a, b, k: int(MOD), writer, owned: 0 };
    if (writer && spec.kind === 'memo') writer.viaDirty = rand2() < 0.4;
    if (rand2() < 0.15) spec.owned = rand2() < 0.5 ? 1 : 2;
    specs[i] = spec;
    let m = 0;
    for (const j of [...a, ...b, ...(cond >= 0 ? [cond] : []), ...(writer ? writer.inputs : [])]) m |= mask[j];
    mask[i] = m;
  }
  // W signals whose writer was never assigned keep their initial value (plain signals).
  const writerOf = new Map<number, number>();
  for (let i = firstMemo; i < total; i++) {
    const w = specs[i]!.writer;
    if (w) writerOf.set(w.target, i);
  }

  // Upper bound on the number of signal→node paths (every read entry of both lists, the
  // condition and the writer's inputs; a signal is one path). Clamped: only a run bound uses it.
  const pathsTo = new Array<number>(total).fill(1);
  for (let i = firstMemo; i < total; i++) {
    const spec = specs[i]!;
    let n = 0;
    for (const j of [...spec.a, ...spec.b, ...(spec.cond >= 0 ? [spec.cond] : []), ...(spec.writer ? spec.writer.inputs : [])]) n += pathsTo[j];
    pathsTo[i] = Math.min(n, 1e9);
  }

  // --- tracking state --------------------------------------------------------------------------
  const changeCount = new Array<number>(total).fill(0);
  const runs = new Array<number>(total).fill(0);
  const runsInFlush = new Array<number>(total).fill(0);
  const runsInStep = new Array<number>(total).fill(0);
  let stepWrites = 1;
  let stepSerial = 0;
  // With synchronous effects, a node may run again whenever a walk reaches it after it ran
  // mid-walk: per write (the step's writes and the changing W writes made in computes) roughly
  // once per path from a signal to it (stage-2 re-review: up to ~170 runs on a 38-node graph).
  // `syncRunBound` grows with the graph's path counts and has ×4 headroom, so a correct run does
  // not trip it when the harness sizes grow (FUZZ_BIG); a walk chasing a link forever does. The
  // separate `SYNC_HANG_GUARD` (runs of all nodes in one step) only asserts termination.
  const syncRunBound = (i: number) =>
    4 * (stepWrites + (writeSerial - stepSerial) + 1) * (pathsTo[i] + nMemo + nEff);
  let stepRuns = 0;
  const logs: number[][] = Array.from({ length: total }, () => []);
  const allowance = new Array<boolean>(total).fill(false);
  const lastValue = new Array<number>(total).fill(NaN);
  const applied = new Array<number>(total).fill(NaN);
  const disposed = new Array<boolean>(total).fill(false);
  let writeSerial = 0;
  let totalRuns = 0;

  const queue: (() => void)[] = [];
  const schedule: Schedule = sync
    ? (run) => run()
    : (run) => {
        queue.push(run);
      };
  const flush = () => {
    runsInFlush.fill(0);
    for (let i = 0; i < queue.length; i++) {
      if (i > 100_000) fail('effect queue does not drain');
      queue[i]();
    }
    queue.length = 0;
    if (!withWriters && !sync) {
      for (let i = firstEff; i < total; i++) {
        if (runsInFlush[i] > 1) fail(`effect ${i} ran ${runsInFlush[i]} times in one flush`);
      }
    }
  };

  const sigs: WriteSignal<number>[] = [];
  const acc: ReadSignal<number>[] = [];
  const nodes: Computation[] = [];
  const idOf = new Map<Computation, number>();
  const register = (i: number, node: Computation) => {
    nodes[i] = node;
    idOf.set(node, i);
  };
  for (let i = 0; i < firstMemo; i++) {
    const s = signal(0);
    sigs[i] = s;
    acc[i] = s;
    register(i, s.node!);
  }
  const writeSig = (j: number, v: number) => {
    if (untrack(sigs[j]) !== v) {
      changeCount[j]++;
      if (j >= firstW) writeSerial++;
    }
    sigs[j].set(v);
  };

  const pendingW = new Array<number>(total).fill(-1);
  const runNode = (i: number) => {
    const spec = specs[i]!;
    if (sync) {
      if (runsInStep[i] >= syncRunBound(i)) fail(`node ${i} ran ${runsInStep[i]} times in one step`);
      if (++stepRuns > SYNC_HANG_GUARD) fail(`step does not terminate (${stepRuns} runs)`);
    }
    const prevLog = logs[i];
    const startSerial = writeSerial;
    const log: number[] = [];
    const rd = (j: number) => {
      const v = acc[j]();
      log.push(j, changeCount[j]);
      return v;
    };
    // An owned node created and read first: the node re-links its later deps on every run.
    if (spec.owned === 1) computed(() => 1)();
    else if (spec.owned === 2) signal(1)();
    const deferred = spec.writer !== null && spec.writer.viaDirty && runs[i] > 0;
    const value = evalSpec(spec, rd, deferred ? (_w, v) => { pendingW[i] = v; } : writeSig);
    // Glitch-free / no over-execution: a re-run must be explained by an input that changed since
    // the previous run (checked after this run pulled its memo inputs), unless the previous run
    // overlapped a value-changing write (the latch is conservative: "wrote, then read" re-runs).
    // (Not with synchronous effects: one that runs in the middle of a notify() walk may read a
    // memo the walk has not marked yet; the walk then reaches it and correctly runs it again — a
    // re-run that can repeat inputs another path already showed it. Values are still checked.)
    if (runs[i] > 0 && !allowance[i] && !sync) {
      let explained = false;
      for (let t = 0; t < prevLog.length; t += 2) {
        if (changeCount[prevLog[t]] !== prevLog[t + 1]) {
          explained = true;
          break;
        }
      }
      if (!explained) fail(`node ${i} (${spec.kind}) re-ran with no changed input`);
    }
    runs[i]++;
    runsInFlush[i]++;
    totalRuns++;
    logs[i] = log;
    allowance[i] = writeSerial !== startSerial;
    if (runs[i] > 1 && value !== lastValue[i]) changeCount[i]++;
    lastValue[i] = value;
    runsInStep[i]++;
    return value;
  };
  /** A writing `dirty` (equals): makes the deferred write of a `viaDirty` writer memo. */
  const dirtyOf = (i: number) => (prev: number, next: number) => {
    const w = specs[i]!.writer!;
    if (pendingW[i] >= 0) {
      const before = writeSerial;
      writeSig(w.target, pendingW[i]);
      pendingW[i] = -1;
      if (writeSerial !== before) allowance[i] = true; // it wrote while still computing
    }
    return prev !== next;
  };

  const effectDisposers: (() => void)[] = [];
  const disposeAll = root((dispose) => {
    for (let i = firstMemo; i < firstEff; i++) {
      const w = specs[i]!.writer;
      // `initial: 0`: a synchronous effect can read a memo while its first run is still going
      // (re-entry); it gets 0 rather than undefined (NaN would never compare equal: a write loop).
      const c = computed(() => runNode(i), w && w.viaDirty ? { initial: 0, dirty: dirtyOf(i) } : { initial: 0 });
      acc[i] = c;
      register(i, c.node!);
    }
    for (let i = firstEff; i < total; i++) {
      root((d) => {
        effectDisposers[i] = d;
        createEffect(
          () => {
            if (!nodes[i]) register(i, getScope() as Computation);
            return runNode(i);
          },
          (v) => {
            applied[i] = v;
          },
          schedule,
        );
      });
    }
    return dispose;
  });

  // --- oracle ---------------------------------------------------------------------------------
  const oracle = () => {
    const cache = new Map<number, number>();
    const ov = (j: number): number => {
      const hit = cache.get(j);
      if (hit !== undefined) return hit;
      let v: number;
      if (j < firstW) v = sigs[j]();
      else if (j < firstMemo) {
        const w = writerOf.get(j);
        if (w === undefined) v = sigs[j]();
        else {
          let s = 0;
          for (const x of specs[w]!.writer!.inputs) s += ov(x);
          v = (s + 1) % 3;
        }
      } else v = evalSpec(specs[j]!, ov, null);
      cache.set(j, v);
      return v;
    };
    return ov;
  };

  const order = Array.from({ length: nMemo }, (_, t) => firstMemo + t);
  const settle = (step: number) => {
    let pass = 0;
    for (; pass < 30; pass++) {
      const before = totalRuns;
      flush();
      shuffle(order);
      for (const i of order) acc[i]();
      flush();
      if (totalRuns === before) break;
      if (!withWriters && !sync && pass >= 1) fail(`step ${step}: a pure graph needed a second settle pass`);
    }
    if (pass === 30) fail(`step ${step}: did not settle`);
    const ov = oracle();
    const runsBefore = totalRuns;
    for (let i = firstMemo; i < firstEff; i++) {
      const got = acc[i]();
      if (got !== ov(i)) fail(`step ${step}: memo ${i} = ${got}, oracle ${ov(i)}`);
    }
    if (totalRuns !== runsBefore) fail(`step ${step}: reading settled memos recomputed something`);
    for (let j = firstW; j < firstMemo; j++) {
      if (sigs[j]() !== ov(j)) fail(`step ${step}: W signal ${j} = ${sigs[j]()}, oracle ${ov(j)}`);
    }
    for (let i = firstEff; i < total; i++) {
      if (!disposed[i] && applied[i] !== ov(i)) fail(`step ${step}: effect ${i} applied ${applied[i]}, oracle ${ov(i)}`);
    }
    checkStructure(step);
  };

  // Both directions agree, and a node is subscribed to exactly what its last run read.
  const checkStructure = (step: number) => {
    for (let i = firstMemo; i < total; i++) {
      const node = nodes[i];
      if (disposed[i]) {
        if (depsOf(node).length) fail(`step ${step}: disposed effect ${i} still has deps`);
        continue;
      }
      const deps = depsOf(node).filter((d) => idOf.has(d)); // (owned nodes are not tracked)
      const read = new Set<number>();
      for (let t = 0; t < logs[i].length; t += 2) read.add(logs[i][t]);
      const linked = new Set(deps.map((d) => idOf.get(d)!));
      if (read.size !== linked.size || [...read].some((j) => !linked.has(j))) {
        fail(`step ${step}: node ${i} deps {${[...linked]}} but its last run read {${[...read]}}`);
      }
      for (const d of deps) {
        if (!subsOf(d).includes(node)) fail(`step ${step}: node ${i} lists dep ${idOf.get(d)} that does not list it`);
      }
    }
    for (let j = 0; j < firstEff; j++) {
      for (const s of subsOf(nodes[j])) {
        const sid = idOf.get(s);
        if (sid === undefined) fail(`step ${step}: node ${j} has an unknown subscriber`);
        if (disposed[sid!]) fail(`step ${step}: node ${j} still lists disposed effect ${sid}`);
        if (!depsOf(s).includes(nodes[j])) fail(`step ${step}: subscriber ${sid} of ${j} does not list it`);
      }
    }
  };

  const settleChecked = (step: number) => {
    try {
      settle(step);
    } catch (error) {
      throw firstFailure ?? error;
    }
    if (firstFailure) throw firstFailure;
  };
  settleChecked(-1);
  const steps = BIG ? 40 : 25;
  for (let step = 0; step < steps; step++) {
    runsInStep.fill(0);
    stepRuns = 0;
    const writes = 1 + int(4);
    stepWrites = writes;
    stepSerial = writeSerial;
    for (let w = 0; w < writes; w++) {
      writeSig(int(nBase), int(MOD));
      if (rand() < 0.3) acc[firstMemo + int(nMemo)](); // a partial read mid-batch
    }
    if (rand() < 0.08) {
      const e = firstEff + int(nEff);
      // (a disposed writer would freeze its W signal: the oracle assumes writers keep running)
      if (!disposed[e] && !specs[e]!.writer) {
        effectDisposers[e]();
        disposed[e] = true;
      }
    }
    settleChecked(step);
  }

  disposeAll();
  for (let j = 0; j < firstMemo; j++) {
    if (subsOf(nodes[j]).length) fail('after disposing the root a signal still has subscribers');
  }
  for (let i = firstMemo; i < total; i++) {
    if (depsOf(nodes[i]).length) fail(`after disposing the root node ${i} still has deps`);
  }
  return totalRuns;
}

const only = typeof process !== 'undefined' ? process.env.FUZZ_SEED : undefined;
/** FUZZ_COUNT=k: k× the seeds per test (manual sweeps). */
const scale = typeof process !== 'undefined' ? Number(process.env.FUZZ_COUNT ?? 1) : 1;
const seeds = (n: number, base: number) =>
  only ? [Number(only)] : Array.from({ length: n * scale }, (_, i) => base + i * 7919);

describe('dependency graph: differential fuzz', () => {
  it('pure graphs (no writes in computes): oracle values, ≤ 1 effect run per flush, no over-execution', () => {
    for (const seed of seeds(600, 1)) runFuzz(seed, false);
  });

  // On the array implementation 50 of these 600 seeds (all stale values) hit the missed-wake hole
  // pinned in deps-stress.test.ts ("a dep bound for the first time, invalidated and re-pulled in
  // the same pass"), closed by P4's read-time subscription; one more seed (559305) hit "a dep that
  // re-dirties itself (latched) inside an updateCheck walk".
  it('graphs with writes inside memo/effect computes (latch rules): oracle values after settling, no unexplained re-runs', () => {
    for (const seed of seeds(600, 100_003)) runFuzz(seed, true);
  });

  it('synchronous effects (run from inside notify), with and without writes in computes: oracle values, structure, bounded runs per write', () => {
    for (const seed of seeds(300, 200_003)) runFuzz(seed, false, true);
    for (const seed of seeds(300, 300_007)) runFuzz(seed, true, true);
  });
});
