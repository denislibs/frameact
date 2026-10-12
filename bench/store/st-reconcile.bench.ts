// reconcile of 1000 tt-like messages (nested content.text.entities, reactions), 10 changed.
import { clearRaf } from './env';
import { createRoot, flushSync, createEffect } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { createStore, reconcile } from '../../src/store/index';
import { msOnce, report } from './util';

const N = 1000;
function flush() { flushSync(); clearRaf(); }
type Msg = { id: number; chatId: number; date: number; isOutgoing: boolean; content: { text: { text: string; entities: { type: string; offset: number; length: number }[] } }; reactions: { results: { emoji: string; count: number }[] }; views: number };
const msg = (i: number, v: number): Msg => ({ id: i, chatId: 7, date: 1700000000 + i, isOutgoing: i % 3 === 0, content: { text: { text: `message ${i} v${v}`, entities: [{ type: 'bold', offset: 0, length: 4 }] } }, reactions: { results: [{ emoji: '👍', count: 1 + (i % 5) }] }, views: 10 });
const chunk = (gen: number, changed: number) => Array.from({ length: N }, (_, i) => msg(i, i < changed ? gen : 0)); // first `changed` items carry gen
let bindingRuns = 0;

process.stdout.write('| reconcile 1000 messages | cost | notes |\n|---|---|---|\n');
{ // no subscribers: full deep diff
  const [, setState] = createStore({ list: chunk(0, 0) });
  let g = 1;
  report('reconcile, same content, all objects new, no subscribers (deep diff)', msOnce(() => chunk(0, 0), (c) => setState('list', reconcile(c)), { runs: 25 }), 'ms');
  report('reconcile, 10 changed, no subscribers', msOnce(() => chunk(g++, 10), (c) => setState('list', reconcile(c)), { runs: 25 }), 'ms');
}
{ // core only, 1000 rows with 3 leaf effects
  const [state, setState] = createStore({ list: chunk(0, 0) });
  createRoot(() => {
    const rows = createComponent(() => For({ get each() { return state.list; }, children: (m: Msg) => {
      createEffect(() => { bindingRuns++; return m.content.text.text; }, () => {});
      createEffect(() => { bindingRuns++; return m.reactions.results[0].count; }, () => {});
      createEffect(() => { bindingRuns++; return m.views; }, () => {});
      return m;
    } } as any), {}) as () => unknown[];
    createEffect(() => rows().length, () => {});
  });
  flush();
  let g = 1; let runsSeen = 0;
  const ms = msOnce(() => chunk(g++, 10), (c) => { bindingRuns = 0; setState('list', reconcile(c)); flush(); runsSeen = bindingRuns; }, { runs: 25 });
  report('reconcile 10 changed + flush, 1000 rows × 3 effects (core)', ms, 'ms', `${runsSeen} effect runs |`);
}
{ // jsdom, 3 text bindings per row
  const [state, setState] = createStore({ list: chunk(0, 0) });
  const ul = document.createElement('ul'); document.body.appendChild(ul);
  createRoot(() => insert(ul, createComponent(() => For({ get each() { return state.list; }, children: (m: Msg) => {
    const li = document.createElement('li'); const a = document.createElement('b'); const b = document.createElement('i'); const c = document.createElement('u');
    li.append(a, b, c);
    insert(a, () => { bindingRuns++; return m.content.text.text; });
    insert(b, () => { bindingRuns++; return m.reactions.results[0].count; });
    insert(c, () => { bindingRuns++; return m.views; });
    return li;
  } } as any), {})));
  flush();
  let g = 1; let runsSeen = 0;
  const ms = msOnce(() => chunk(g++, 10), (c) => { bindingRuns = 0; setState('list', reconcile(c)); flush(); runsSeen = bindingRuns; }, { runs: 25 });
  report('reconcile 10 changed + flush, 1000 rows × 3 text bindings (jsdom)', ms, 'ms', `${runsSeen} binding runs |`);
  // one message appended at the end + 10 changed (shape change → $TRACK rebuild + keyed map)
  const ms2 = msOnce(() => { const c = chunk(g++, 10); c.push(msg(N + g, 0)); return c; }, (c) => { bindingRuns = 0; setState('list', reconcile(c)); flush(); runsSeen = bindingRuns; }, { runs: 25 });
  report('reconcile 10 changed + 1 appended + flush (jsdom; length alternates)', ms2, 'ms', `${runsSeen} binding runs |`);
}
