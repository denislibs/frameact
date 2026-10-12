// Store gate: cost with no animation (vs gate uninstalled), with an unrelated animation, parking and
// releasing 3000 frame effects (the release frame = the long task after a chat-open animation).
import { clearRaf } from './env';
import { createHeavyAnimationScope, createMutationEffect, createRoot, createSignal, flushSync, provideHeavyAnimationScope, type HeavyAnimationScope } from '../../src/index';
import { setStoreGate } from '../../src/core/effects';
import { createStore, produce } from '../../src/store/index';
import { median, nsPerOp, report } from './util';

function flush() { flushSync(); clearRaf(); }
const g = globalThis as any;

/** `count` mutation effects, each reading leaf i of `state.v`, under a chain of `depth` nested scopes below `top`. */
function setup(count: number, depth: number, top?: HeavyAnimationScope) {
  const [state, setState] = createStore({ v: Array.from({ length: count }, () => 0) });
  const scopes: HeavyAnimationScope[] = [];
  let runs = 0;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    let s = top ?? createHeavyAnimationScope(null);
    scopes.push(s);
    for (let i = 1; i < depth; i++) { s = createHeavyAnimationScope(s); scopes.push(s); }
    provideHeavyAnimationScope(s);
    for (let i = 0; i < count; i++) createMutationEffect(() => state.v[i], () => { runs++; });
  });
  flush();
  return { state, setState, scopes, dispose, runs: () => runs };
}
const writeAll = (setState: any, k: number) => setState('v', produce((a: number[]) => { for (let i = 0; i < a.length; i++) a[i] = k; }));

process.stdout.write('| store gate | cost | notes |\n|---|---|---|\n');
let savedGate: any;
{ // capture the installed gate by re-installing a wrapper
  // (setStoreGate replaces it; we keep a reference by wrapping the original through a probe)
}
{
  const N = 1000;
  const a = setup(N, 3);
  const withGate = nsPerOp((k) => { writeAll(a.setState, k); flush(); }, { ops: 100, warm: 200 });
  report('1000 store-caused frame effects, write all + flush, no animation (gate installed)', withGate / 1000, 'µs/op');
  const one = nsPerOp((k) => { a.setState('v', 7, k); flush(); }, { ops: 5000, warm: 5000 });
  report('1 leaf → 1 frame effect + flush, no animation (gate installed)', one, 'ns/op');
  // now an unrelated scope animates (e.g. media viewer): every store-caused effect walks its chain to the root
  const other = createHeavyAnimationScope(null);
  const end = other.begin(Infinity);
  const withOther = nsPerOp((k) => { writeAll(a.setState, k); flush(); }, { ops: 100, warm: 200 });
  report('same, an unrelated scope animating (chain depth 3)', withOther / 1000, 'µs/op', `${(((withOther - withGate) / N)).toFixed(1)} ns per effect |`);
  end();
  a.dispose();
  const b = setup(N, 12);
  const deepNo = nsPerOp((k) => { writeAll(b.setState, k); flush(); }, { ops: 100, warm: 200 });
  const end2 = other.begin(Infinity);
  const deepOther = nsPerOp((k) => { writeAll(b.setState, k); flush(); }, { ops: 100, warm: 200 });
  end2();
  report('same, chain depth 12, unrelated animation vs none', deepOther / 1000, 'µs/op', `${(((deepOther - deepNo) / N)).toFixed(1)} ns per effect (none: ${(deepNo / 1000).toFixed(1)} µs) |`);
  b.dispose();
  // gate uninstalled: the core path alone (what an app without frameact/store pays)
  setStoreGate(null as any);
  const c = setup(N, 3);
  const noGate = nsPerOp((k) => { writeAll(c.setState, k); flush(); }, { ops: 100, warm: 200 });
  report('1000 effects, write all + flush, gate UNINSTALLED (setStoreGate(null))', noGate / 1000, 'µs/op', `gate cost ${(((withGate - noGate) / N)).toFixed(1)} ns per effect |`);
  const oneNo = nsPerOp((k) => { c.setState('v', 7, k); flush(); }, { ops: 5000, warm: 5000 });
  report('1 leaf → 1 frame effect + flush, gate UNINSTALLED', oneNo, 'ns/op');
  c.dispose();
}
