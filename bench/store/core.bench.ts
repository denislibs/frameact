// The cost of the cause-tag patch (notify/update/write branches, the run-time gate check) on PLAIN
// signals: run this file in the patched tree and in a worktree of `main` (copy bench/store there).
// Public API only.
import { clearRaf } from './env';
import { createEffect, createMemo, createRoot, createSignal, flushSync, mapArray } from '../../src/index';
import { nsPerOp, report } from './util';

function flush() {
  flushSync();
  clearRaf();
}

process.stdout.write('| plain-signal propagation (write + flushSync) | cost |\n|---|---|\n');
{ // deep: signal → 100 chained memos → effect
  const [s, set] = createSignal(0);
  createRoot(() => {
    let prev: () => number = s;
    for (let i = 0; i < 100; i++) { const p = prev; prev = createMemo(() => p() + 1); }
    const last = prev;
    createEffect(() => last(), () => {});
  });
  flush();
  report('deep: 100 chained memos → 1 effect', nsPerOp((k) => { set(k); flush(); }, { ops: 2000 }) / 1000, 'µs/op');
}
{ // broad: signal → 1000 memos → 1000 effects
  const [s, set] = createSignal(0);
  createRoot(() => {
    for (let i = 0; i < 1000; i++) { const m = createMemo(() => s() + i); createEffect(() => m(), () => {}); }
  });
  flush();
  report('broad: 1 signal → 1000 memos → 1000 effects', nsPerOp((k) => { set(k); flush(); }, { ops: 300, warm: 300 }) / 1000, 'µs/op');
}
{ // diamond: 1 → 4 → 1 memo → effect, x 250
  const [s, set] = createSignal(0);
  createRoot(() => {
    for (let j = 0; j < 250; j++) {
      const a = createMemo(() => s() + 1), b = createMemo(() => s() * 2), c = createMemo(() => s() - 1), d = createMemo(() => s() ^ 1);
      const e = createMemo(() => a() + b() + c() + d());
      createEffect(() => e(), () => {});
    }
  });
  flush();
  report('diamond x250: 1 → 4 → 1 → effect', nsPerOp((k) => { set(k); flush(); }, { ops: 500, warm: 300 }) / 1000, 'µs/op');
}
{ // one signal, one effect: the fixed per-write cost
  const [s, set] = createSignal(0);
  createRoot(() => createEffect(() => s(), () => {}));
  flush();
  report('1 signal → 1 effect', nsPerOp((k) => { set(k); flush(); }, { ops: 20000, warm: 5000 }), 'ns/op');
}
{ // rows: 1000 mapArray rows, each with an effect on a shared signal — the zombie-rows rule's cost per row run
  const [s, set] = createSignal(0);
  const [list] = createSignal(Array.from({ length: 1000 }, (_, i) => i));
  createRoot(() => {
    const rows = mapArray(list, (i: number) => { createEffect(() => s() + i, () => {}); return i; });
    createEffect(() => rows().length, () => {});
  });
  flush();
  report('rows: 1 signal → 1000 row effects (mapArray)', nsPerOp((k) => { set(k); flush(); }, { ops: 300, warm: 300 }) / 1000, 'µs/op');
}
