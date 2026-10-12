// Reconciler hot paths on 1000 rows (`For keyed={fn}`): structural edits that go through
// reconcileArrays, plus the "1 of 1000 changed" fast path that never reaches it. Run before and
// after a change to the reconciler/insert (plan 3 Task 1: prototype natives). Cost per op = signal
// write + flushSync (jsdom DOM, no layout).
import { createRoot, createSignal, flushSync, untrack } from '../../src/index';
import { insert } from '../../src/dom/insert';
import { createComponent } from '../../src/dom/component';
import { For } from '../../src/dom/list';

type Row = { id: number; text: string };
const N = 1000;

function median(xs: number[]) {
  return [...xs].sort((a, b) => a - b)[xs.length >> 1];
}

function mount() {
  const ul = document.createElement('ul');
  document.body.appendChild(ul);
  const [list, setList] = createSignal<Row[]>(Array.from({ length: N }, (_, i) => ({ id: i, text: `t${i}` })));
  createRoot(() =>
    insert(
      ul,
      createComponent(() =>
        For({
          get each() { return list(); },
          keyed: (r: Row) => r.id,
          children: (item: () => Row) => {
            const li = document.createElement('li');
            insert(li, () => item().text);
            return li;
          },
        }), {}),
    ),
  );
  flushSync();
  return { list, setList };
}

let nextId = N;

const scenarios: Record<string, (list: () => Row[], setList: (v: Row[]) => void, k: number) => void> = {
  'edit-1': (list, setList, k) => {
    const next = untrack(list).slice();
    next[(k * 37) % N] = { id: (k * 37) % N, text: `e${k}` };
    setList(next);
  },
  'remove-1-add-1': (list, setList) => {
    const next = untrack(list).slice(1);
    next.push({ id: nextId++, text: 'new' });
    setList(next);
  },
  'swap-2': (list, setList, k) => {
    const next = untrack(list).slice();
    const i = (k * 37) % (N - 1);
    [next[i], next[i + 1]] = [next[i + 1], next[i]];
    setList(next);
  },
  'prepend-5-drop-5': (list, setList) => {
    const prev = untrack(list);
    const fresh = Array.from({ length: 5 }, () => ({ id: nextId++, text: 'p' }));
    setList([...fresh, ...prev.slice(0, N - 5)]);
  },
};

it('reconcile: structural edits on 1000 keyed rows', () => {
  for (const [name, step] of Object.entries(scenarios)) {
    const { list, setList } = mount();
    const run = (k: number) => {
      step(list, setList, k);
      flushSync();
    };
    for (let k = 0; k < 200; k++) run(k); // warm up
    const batches: number[] = [];
    let k = 200;
    for (let b = 0; b < 7; b++) {
      const t0 = performance.now();
      for (let i = 0; i < 300; i++) run(k++);
      batches.push(((performance.now() - t0) * 1000) / 300); // us per op
    }
    process.stdout.write(`BENCH reconcile[${name}] ${median(batches).toFixed(1)} us/op (median of 7 x 300 ops, ${N} rows)\n`);
    document.body.textContent = '';
  }
});
