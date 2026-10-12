// History prepend (load 50 older messages) and append over a store array: write forms compared, core only.
import { clearRaf } from './env';
import { createEffect, createRoot, createSignal, flushSync, mapArray } from '../../src/index';
import { createStore, produce, reconcile } from '../../src/store/index';
import { nsPerOp, report } from './util';

type Msg = { id: number; text: string };
const N = 1000;
function flush() { flushSync(); clearRaf(); }
const make = () => Array.from({ length: N }, (_, i) => ({ id: i, text: `t${i}` }));
const extra = () => Array.from({ length: 50 }, (_, i) => ({ id: -1 - i, text: 'p' }));
process.stdout.write('| prepend 50 / append 1 to a 1000-row list, core (mapArray + effect per row) | µs per op pair |\n|---|---|\n');
function storeRig() {
  const [state, setState] = createStore({ messages: make() as Msg[] });
  createRoot(() => {
    const rows = mapArray(() => state.messages as Msg[], (m: Msg) => { createEffect(() => m.text, () => {}); return m; });
    createEffect(() => rows().length, () => {});
  });
  flush();
  return { state, setState };
}
{
  const { setState } = storeRig();
  report('store: produce(a => a.unshift(...50)) then produce(a => a.splice(0, 50))', nsPerOp(() => {
    setState('messages', produce((a: Msg[]) => { a.unshift(...extra()); })); flush();
    setState('messages', produce((a: Msg[]) => { a.splice(0, 50); })); flush();
  }, { ops: 200, warm: 200 }) / 1000, 'µs');
}
{
  const { state, setState } = storeRig();
  const base = make();
  setState('messages', base);
  flush();
  report("store: setState('messages', [...50, ...cur]) then setState('messages', cur) (replace)", nsPerOp(() => {
    const cur = state.messages as unknown as Msg[];
    setState('messages', [...extra(), ...base]); flush();
    setState('messages', base); flush();
  }, { ops: 200, warm: 200 }) / 1000, 'µs');
}
{
  const { setState } = storeRig();
  const base = make();
  report("store: reconcile([...50, ...base]) then reconcile(base) (fresh objects)", nsPerOp(() => {
    setState('messages', reconcile([...extra(), ...make()])); flush();
    setState('messages', reconcile(make())); flush();
  }, { ops: 100, warm: 100 }) / 1000, 'µs');
}
{
  const { setState } = storeRig();
  report('store: produce push 1 / pop', nsPerOp((k) => {
    setState('messages', produce((a: Msg[]) => { a.push({ id: N + k, text: 'n' }); })); flush();
    setState('messages', produce((a: Msg[]) => { a.pop(); })); flush();
  }, { ops: 300, warm: 300 }) / 1000, 'µs');
}
{
  const [list, setList] = createSignal<Msg[]>(make());
  createRoot(() => {
    const rows = mapArray(list, (item: () => Msg) => { createEffect(() => item().text, () => {}); return item; }, { keyed: (r: Msg) => r.id });
    createEffect(() => rows().length, () => {});
  });
  flush();
  const base = list();
  report('plan 2: setList([...50, ...base]) then setList(base)', nsPerOp(() => { setList([...extra(), ...base]); flush(); setList(base); flush(); }, { ops: 200, warm: 200 }) / 1000, 'µs');
  report('plan 2: append 1 / remove', nsPerOp((k) => { setList([...base, { id: N + k, text: 'n' }]); flush(); setList(base); flush(); }, { ops: 300, warm: 300 }) / 1000, 'µs');
}
