import { clearRaf } from './env';
import { createEffect, createRoot, createSignal, flushSync, mapArray } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { createStore, reconcile } from '../../src/store/index';
import { heap, report } from './util';

function flush() { flushSync(); clearRaf(); }
type Msg = { id: number; text: string; reactions: { n: number } };
const data = (c: number) => Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `m${c}-${i}`, reactions: { n: i % 3 } }));
const ul = document.createElement('ul'); document.body.appendChild(ul);
function measure(name: string, cycle: (c: number) => void) {
  for (let c = 0; c < 20; c++) cycle(c);
  const h0 = heap();
  for (let c = 20; c < 220; c++) cycle(c);
  const h1 = heap();
  for (let c = 220; c < 420; c++) cycle(c);
  const h2 = heap();
  report(name, (h1 - h0) / 1024, 'KB / 200 cycles', `next 200: ${((h2 - h1) / 1024).toFixed(0)} KB |`);
}
process.stdout.write('| leak hunt | growth | |\n|---|---|---|\n');
{
  const [, setState] = createStore<{ byChat: Record<string, Msg[]> }>({ byChat: {} });
  measure('A store: reconcile load + evict, no render', (c) => { setState('byChat', `c${c}`, reconcile(data(c))); setState('byChat', `c${c}`, undefined as any); });
}
{
  measure('B plan-2: signal list, For mount/unmount (jsdom)', (c) => {
    const [list] = createSignal(data(c));
    let dispose!: () => void;
    createRoot((d) => { dispose = d; insert(ul, createComponent(() => For({ get each() { return list(); }, keyed: (m: Msg) => m.id, children: (m: () => Msg) => { const li = document.createElement('li'); insert(li, () => m().text); return li; } } as any), {})); });
    flush(); dispose(); ul.textContent = '';
  });
}
{
  measure('B2 plan-2 core: mapArray + effects, mount/dispose', (c) => {
    const [list] = createSignal(data(c));
    createRoot((d) => { const rows = mapArray(list, (m: () => Msg) => { createEffect(() => m().text, () => {}); return m; }, { keyed: (m: Msg) => m.id }); createEffect(() => rows().length, () => {}); flush(); d(); });
  });
}
{
  const [state, setState] = createStore<{ byChat: Record<string, Msg[]> }>({ byChat: {} });
  measure('C store core: load, mapArray rows, dispose, evict', (c) => {
    const id = `c${c}`;
    setState('byChat', id, reconcile(data(c)));
    createRoot((d) => { const rows = mapArray(() => state.byChat[id] as Msg[], (m: Msg) => { createEffect(() => m.text, () => {}); return m; }); createEffect(() => rows().length, () => {}); flush(); d(); });
    setState('byChat', id, undefined as any);
  });
}
{
  const [state, setState] = createStore<{ byChat: Record<string, Msg[]> }>({ byChat: {} });
  measure('D store core: same chat id reused (load, rows, dispose, evict)', (c) => {
    setState('byChat', 'x', reconcile(data(c)));
    createRoot((d) => { const rows = mapArray(() => state.byChat.x as Msg[], (m: Msg) => { createEffect(() => m.text, () => {}); return m; }); createEffect(() => rows().length, () => {}); flush(); d(); });
    setState('byChat', 'x', undefined as any);
  });
}
{
  const [state, setState] = createStore<{ byChat: Record<string, Msg[]> }>({ byChat: {} });
  measure('E store: tracked read of byChat[id] only, dispose, evict', (c) => {
    const id = `c${c}`;
    setState('byChat', id, reconcile(data(c)));
    createRoot((d) => { createEffect(() => state.byChat[id], () => {}); flush(); d(); });
    setState('byChat', id, undefined as any);
  });
}
{
  const [state, setState] = createStore<{ byChat: Record<string, number> }>({ byChat: {} });
  measure('F store: tracked read of a fresh key, dispose, delete key (tiny values)', (c) => {
    const id = `c${c}`;
    setState('byChat', id, c);
    createRoot((d) => { createEffect(() => state.byChat[id], () => {}); flush(); d(); });
    setState('byChat', id, undefined as any);
  });
}
