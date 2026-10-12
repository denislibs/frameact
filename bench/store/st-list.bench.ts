// 1000-row list over a store array (For over state.messages → $TRACK), jsdom and core-only.
import { clearRaf } from './env';
import { createEffect, createRoot, flushSync, mapArray } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { createStore, produce } from '../../src/store/index';
import { msOnce, nsPerOp, report } from './util';

type Msg = { id: number; text: string };
const N = 1000;
function flush() { flushSync(); clearRaf(); }
const make = () => Array.from({ length: N }, (_, i) => ({ id: i, text: `t${i}` }));
let runs = 0;

function mountDom() {
  const [state, setState] = createStore({ messages: make() as Msg[] });
  const ul = document.createElement('ul');
  document.body.appendChild(ul);
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    insert(ul, createComponent(() => For({
      get each() { return state.messages; },
      children: (m: Msg) => { const li = document.createElement('li'); insert(li, () => { runs++; return m.text; }); return li; },
    } as any), {}));
  });
  flush();
  return { state, setState, dispose: () => { dispose(); ul.remove(); } };
}

process.stdout.write('| store list (For over a store array), jsdom | cost |\n|---|---|\n');
report('render 1000 rows (createStore + mount + flush)', msOnce(() => null, () => { (globalThis as any).__m = mountDom(); }, { teardown: () => (globalThis as any).__m.dispose() }), 'ms');
{
  const m = mountDom();
  report("update 1 of 1000: setState('messages', i, 'text', v) + flush", nsPerOp((k) => { m.setState('messages', k % N, 'text', `x${k}`); flush(); }, { ops: 2000, warm: 2000 }) / 1000, 'µs/op');
  runs = 0; m.setState('messages', 5, 'text', 'probe'); flush();
  process.stdout.write(`|  → text bindings run for 1 edit | ${runs} |\n`);
  report('append 1 + remove it + flush (2 ops)', nsPerOp((k) => {
    m.setState('messages', produce((a: Msg[]) => { a.push({ id: N + k, text: 'n' }); })); flush();
    m.setState('messages', produce((a: Msg[]) => { a.pop(); })); flush();
  }, { ops: 200, warm: 200 }) / 1000, 'µs/op');
  const extra = () => Array.from({ length: 50 }, (_, i) => ({ id: -1 - i, text: 'p' }));
  report('prepend 50 + remove them + flush (2 ops)', nsPerOp(() => {
    m.setState('messages', produce((a: Msg[]) => { a.unshift(...extra()); })); flush();
    m.setState('messages', produce((a: Msg[]) => { a.splice(0, 50); })); flush();
  }, { ops: 100, warm: 100 }) / 1000, 'µs/op');
  m.dispose();
}
process.stdout.write('\n| store list, core only (mapArray + effect per row) | cost |\n|---|---|\n');
{
  const [state, setState] = createStore({ messages: make() as Msg[] });
  createRoot(() => {
    const rows = mapArray(() => state.messages as Msg[], (m: Msg) => { createEffect(() => m.text, () => {}); return m; });
    createEffect(() => rows().length, () => {});
  });
  flush();
  report('update 1 of 1000 + flush (core)', nsPerOp((k) => { setState('messages', k % N, 'text', `x${k}`); flush(); }, { ops: 5000, warm: 5000 }) / 1000, 'µs/op');
  report('append 1 + pop + flush (core, 2 ops)', nsPerOp((k) => {
    setState('messages', produce((a: Msg[]) => { a.push({ id: N + k, text: 'n' }); })); flush();
    setState('messages', produce((a: Msg[]) => { a.pop(); })); flush();
  }, { ops: 300, warm: 300 }) / 1000, 'µs/op');
}
