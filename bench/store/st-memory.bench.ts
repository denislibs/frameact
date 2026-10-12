// Memory: per leaf, per row, long sessions (chat switches, deletes, missing-key reads).
import { clearRaf } from './env';
import { createEffect, createMemo, createRoot, createSignal, flushSync, mapArray, untrack } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { createStore, produce, reconcile, $TRACK } from '../../src/store/index';
import { heap, nsPerOp, report } from './util';

function flush() { flushSync(); clearRaf(); }
const keep: any[] = [];
process.stdout.write('| memory | bytes | notes |\n|---|---|---|\n');
const M = 20000;
{ // wrap cost: StoreNode + Proxy + WeakMap entry, per object
  const [state] = createStore({ items: Array.from({ length: M }, (_, i) => ({ n: i })) });
  const h0 = heap();
  const ps = untrack(() => state.items[$TRACK]); keep.push(ps);
  const h1 = heap();
  report('wrapped object (StoreNode + Proxy + WeakMap entry), + the $TRACK array slot', (h1 - h0) / M, 'B', '|');
  // subscribed leaf: SigTable + slim node + link, one memo reading all
  let m!: () => number;
  const h2 = heap();
  createRoot(() => { m = createMemo(() => { let s = 0; for (let i = 0; i < M; i++) s += (ps as any)[i].n; return s; }); m(); });
  keep.push(m);
  const h3 = heap();
  report('subscribed leaf (SigTable + slim signal node + link)', (h3 - h2) / M, 'B', '|');
  // second leaf on the same objects (table already exists)
  const [state2] = createStore({ items: Array.from({ length: M }, (_, i) => ({ n: i, t: 'x' })) });
  const ps2 = untrack(() => state2.items[$TRACK]) as any[]; keep.push(ps2);
  createRoot(() => { const mm = createMemo(() => { let s = 0; for (let i = 0; i < M; i++) s += ps2[i].n; return s; }); mm(); keep.push(mm); });
  const h4 = heap();
  createRoot(() => { const mm = createMemo(() => { let s = 0; for (let i = 0; i < M; i++) s += ps2[i].t.length; return s; }); mm(); keep.push(mm); });
  const h5 = heap();
  report('2nd leaf on an object (slot + node + link)', (h5 - h4) / M, 'B', '|');
  const h6 = heap();
  const sigs = Array.from({ length: M }, (_, i) => createSignal(i)); keep.push(sigs);
  createRoot(() => { const mm = createMemo(() => { let s = 0; for (let i = 0; i < M; i++) s += sigs[i][0](); return s; }); mm(); keep.push(mm); });
  const h7 = heap();
  report('createSignal + link (comparison)', (h7 - h6) / M, 'B', '|');
}
{ // per row, core only: store row vs plan-2 row (mapArray + 1 effect per row)
  const R = 5000;
  const h0 = heap();
  const [state] = createStore({ list: Array.from({ length: R }, (_, i) => ({ id: i, text: `t${i}` })) });
  const hS = heap();
  createRoot(() => { const rows = mapArray(() => state.list as any[], (m: any) => { createEffect(() => m.text, () => {}); return m; }); createEffect(() => rows().length, () => {}); keep.push(rows); });
  flush();
  const h1 = heap();
  report(`store row, core (node+Proxy+table+leaf+link+row scope+effect), ${R} rows`, (h1 - hS) / R, 'B', '|');
  const data = Array.from({ length: R }, (_, i) => ({ id: i, text: `t${i}` }));
  const [list] = createSignal(data);
  const h2 = heap();
  createRoot(() => { const rows = mapArray(list, (item: () => any) => { createEffect(() => item().text, () => {}); return item; }, { keyed: (r: any) => r.id }); createEffect(() => rows().length, () => {}); keep.push(rows); });
  flush();
  const h3 = heap();
  report(`plan-2 row, core (keyed fn + item signal + effect), ${R} rows`, (h3 - h2) / R, 'B', '|');
}
{ // long session: 200 chat switches, each loads a new chat via reconcile, renders 1000 rows (jsdom), unmounts, evicts the chat
  type Msg = { id: number; text: string; reactions: { n: number } };
  const [state, setState] = createStore<{ byChat: Record<string, Msg[]> }>({ byChat: {} });
  const ul = document.createElement('ul'); document.body.appendChild(ul);
  const cycle = (c: number, evict: boolean) => {
    const id = `c${c}`;
    setState('byChat', id, reconcile(Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `m${c}-${i}`, reactions: { n: i % 3 } }))));
    let dispose!: () => void;
    createRoot((d) => { dispose = d; insert(ul, createComponent(() => For({ get each() { return state.byChat[id]; }, children: (m: Msg) => { const li = document.createElement('li'); insert(li, () => m.text); insert(li, () => m.reactions.n, null); return li; } } as any), {})); });
    flush();
    setState('byChat', id, '5', 'text', 'edited'); flush();
    dispose(); ul.textContent = '';
    if (evict) setState('byChat', id, undefined as any);
  };
  for (let c = 0; c < 10; c++) cycle(c, true);
  const h0 = heap();
  for (let c = 10; c < 210; c++) cycle(c, true);
  const h1 = heap();
  report('200 chat switches (load 1000 via reconcile, render, edit, unmount, evict): heap growth', (h1 - h0) / 1024, 'KB', 'should be ~0 |');
  const h2 = heap();
  for (let c = 300; c < 350; c++) cycle(c, false);
  const h3 = heap();
  report('50 chat switches WITHOUT eviction (data kept, rows unmounted): per chat', (h3 - h2) / 50 / 1024, 'KB/chat', '1000 msgs: raw + nodes + leaves that outlive their readers |');
  // the same raw data without the store, for scale
  const h4 = heap();
  const raw: any[] = [];
  for (let c = 0; c < 50; c++) raw.push(Array.from({ length: 1000 }, (_, i) => ({ id: i, text: `m${c}-${i}`, reactions: { n: i % 3 } })));
  keep.push(raw);
  const h5 = heap();
  report('  (raw data alone, same 1000 msgs: per chat)', (h5 - h4) / 50 / 1024, 'KB/chat', '|');
}
{ // leaf table after deletes
  const K = 10000;
  const init: Record<string, { t: number }> = {};
  for (let i = 0; i < K; i++) init[`m${i}`] = { t: i };
  const [state, setState] = createStore({ byId: init });
  const h0 = heap();
  let dispose!: () => void;
  createRoot((d) => { dispose = d; const m = createMemo(() => { let s = 0; for (let i = 0; i < K; i++) s += state.byId[`m${i}`] ? 1 : 0; return s; }); m(); });
  const h1 = heap();
  report(`byId table: ${K} tracked keys (leaf per key on byId)`, (h1 - h0) / K, 'B/key', '|');
  dispose();
  const h2 = heap();
  report('  after the reader is disposed: leaves retained', (h2 - h0) / K, 'B/key', 'leaves outlive readers |');
  setState('byId', produce((d: any) => { for (let i = 0; i < K - 10; i++) delete d[`m${i}`]; }));
  const h3 = heap();
  report('  after deleting 9990 keys', (h3 - h0) / 1024, 'KB total vs before reads', '|');
  // missing-key reads: rows looking up users that are not loaded
  const [st2] = createStore<{ users: Record<string, { name: string }> }>({ users: {} });
  const h4 = heap();
  createRoot((d) => { const m = createMemo(() => { let s = 0; for (let i = 0; i < K; i++) s += st2.users[`u${i}`] ? 1 : 0; return s; }); m(); d(); });
  const h5 = heap();
  report(`missing-key tracked reads (${K} ids), reader disposed: retained`, (h5 - h4) / K, 'B/key', 'never freed |');
}
