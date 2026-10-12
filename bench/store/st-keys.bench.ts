import { clearRaf } from './env';
import { createMemo, createRoot, createSignal, untrack } from '../../src/index';
import { createStore, entries, keys, values } from '../../src/store/index';
import { nsPerOp, report } from './util';

const byId: Record<string, { id: number; title: string }> = {};
for (let i = 0; i < 1000; i++) byId[`c${i}`] = { id: i, title: `t${i}` };
const [state] = createStore({ byId });
const p = untrack(() => state.byId);
process.stdout.write('| 1000-key byId | µs |\n|---|---|\n');
report('Object.keys(plain)', nsPerOp(() => { if (Object.keys(byId).length < 0) throw 0; }, { ops: 2000, warm: 500 }) / 1000, 'µs');
report('Object.keys(storeProxy), untracked', nsPerOp(() => { untrack(() => { if (Object.keys(p).length < 0) throw 0; }); }, { ops: 200, warm: 100 }) / 1000, 'µs');
report('Object.values(storeProxy), untracked', nsPerOp(() => { untrack(() => { if (Object.values(p).length < 0) throw 0; }); }, { ops: 200, warm: 100 }) / 1000, 'µs');
report('keys(storeProxy), untracked', nsPerOp(() => { untrack(() => { if (keys(p).length < 0) throw 0; }); }, { ops: 2000, warm: 500 }) / 1000, 'µs');
report('values(storeProxy), untracked', nsPerOp(() => { untrack(() => { if (values(p).length < 0) throw 0; }); }, { ops: 2000, warm: 500 }) / 1000, 'µs');
report('entries(storeProxy), untracked', nsPerOp(() => { untrack(() => { if (entries(p).length < 0) throw 0; }); }, { ops: 2000, warm: 500 }) / 1000, 'µs');
report('for (k in storeProxy), untracked', nsPerOp(() => { untrack(() => { let n = 0; for (const k in p) n++; if (n < 0) throw 0; }); }, { ops: 200, warm: 100 }) / 1000, 'µs');
const [t, setT] = createSignal(0);
let m!: () => number;
createRoot(() => { m = createMemo(() => { t(); return Object.values(state.byId).length; }); });
m();
report('Object.values(state.byId) in a memo (tracked, links reused)', nsPerOp((k) => { setT(k); m(); }, { ops: 200, warm: 100 }) / 1000, 'µs');
// alternative descriptor shape (what a fix would cost): data descriptor literal, no closure, no deletes
const handler: ProxyHandler<any> = {
  get: (t, k) => t[k],
  getOwnPropertyDescriptor(t, k) { const d = Reflect.getOwnPropertyDescriptor(t, k); if (!d || !d.configurable) return d; return { value: d.value, writable: true, enumerable: d.enumerable, configurable: true }; },
};
const alt = new Proxy(byId, handler);
report('(fix sketch) Object.values over a Proxy with a literal data descriptor', nsPerOp(() => { if (Object.values(alt).length < 0) throw 0; }, { ops: 200, warm: 100 }) / 1000, 'µs');
const handler2: ProxyHandler<any> = { get: (t, k) => t[k] };
const alt2 = new Proxy(byId, handler2);
report('(fix sketch) Object.values over a Proxy without a gOPD trap', nsPerOp(() => { if (Object.values(alt2).length < 0) throw 0; }, { ops: 200, warm: 100 }) / 1000, 'µs');
clearRaf();
