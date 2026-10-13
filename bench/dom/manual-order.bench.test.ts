// ChatList scenario: 1000 rows, `ManualFor`, edit ONE item's non-order field (the order
// does not change). Cost per edit = signal write + flushSync (jsdom DOM, no layout).
import { createRoot, createSignal, flushSync, untrack } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';
import { ManualFor } from '../../src/dom/manualFor';

type Chat = { id: number; text: string };
const N = 1000;

function median(xs: number[]) {
  return [...xs].sort((a, b) => a - b)[xs.length >> 1];
}

it('manual order: edit one row (order unchanged)', () => {
  for (const mode of ['manual', 'manual-no-orderKey', 'keyed-fn'] as const) {
    const ul = document.createElement('ul');
    document.body.appendChild(ul);
    const [list, setList] = createSignal<Chat[]>(Array.from({ length: N }, (_, i) => ({ id: i, text: `t${i}` })));
    createRoot(() =>
      insert(
        ul,
        createComponent(
          () =>
            (mode === 'keyed-fn' ? For : ManualFor)({
              get each() { return list(); },
              keyed: (c: Chat) => c.id,
              orderKey: mode === 'manual' ? (c: Chat) => c.id : undefined,
              children: (item: () => Chat) => {
                const li = document.createElement('li');
                insert(li, () => item().text);
                return li;
              },
            }),
          {},
        ),
      ),
    );
    flushSync();
    const step = (k: number) => {
      const next = untrack(list).slice();
      next[(k * 37) % N] = { id: (k * 37) % N, text: `e${k}` };
      setList(next);
      flushSync();
    };
    for (let k = 0; k < 300; k++) step(k); // warm up
    const batches: number[] = [];
    let k = 300;
    for (let b = 0; b < 7; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 1000; i++) step(k++);
      batches.push(((performance.now() - t0) * 1000) / 1000); // us per op
    }
    process.stdout.write(`BENCH manual-order[${mode}] ${median(batches).toFixed(1)} us/op (median of 7 x 1000 ops, ${N} rows)\n`);
  }
});
