import {
  createHeavyAnimationScope, createMutationEffect, createRoot, createSignal, getPhase, provideHeavyAnimationScope, requestMutation,
} from '../../src/index';
import { createStore, produce, reconcile } from 'frameact/store';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { For } from '../../src/dom/list';
import { createScrollAnchor } from '../../src/kit/scrollAnchor';
import { TRACK } from '../../src/core/symbols';
import { InfiniteScroll } from '../../src/kit/infiniteScroll';
import { container, useDomHarness } from '../helpers/dom';
import { fakeLayout, resetLayout } from '../helpers/layout';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

afterEach(() => {
  resetLayout();
  vi.useRealTimers();
});

const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

function row(id: number) {
  const el = document.createElement('div');
  el.className = 'ListItem';
  el.textContent = String(id);
  return el;
}

const ForC = For as (props: any) => unknown;

async function settle() {
  await flushMicrotasks();
  await frame();
}

describe('createScrollAnchor', () => {
  it('prepend: the anchor (first visible item) keeps its position — snapshot in measure, DOM in mutate, restore in forced reflow, one frame', async () => {
    const root = container();
    const log: string[] = [];
    fakeLayout(root, root, 40, 200, (top) => log.push(`write:${getPhase()}:${top}`));
    const [items, setItems] = createSignal(ids(100, 120));
    createRoot(() => {
      insert(root, createComponent(ForC, { get each() { return items(); }, children: row }));
      createScrollAnchor({ container: () => root, items });
      // an observer of the list's mutate phase, to see the order of the phases
      createMutationEffect(() => items(), (v, prev) => { if (prev) log.push(`list:${getPhase()}`); });
    });
    await frame(); // the snapshot effect's first run
    root.scrollTop = 120; // item 103 at the top of the viewport
    log.length = 0;
    setItems([...ids(80, 100), ...ids(100, 120)]); // 20 rows (800 px) prepended
    await frame();
    expect(root.scrollTop).toBe(920);
    // the list's mutate apply, then the restore in the forced-reflow mutate phase (fasterdom reports it as 'measure'
    // until the mutations run: the write is in the mutation closure, phase 'mutate')
    expect(log).toEqual(['list:mutate', 'write:mutate:920']);
    expect(root.querySelectorAll('.ListItem').length).toBe(40);
    // append: the anchor does not move, nothing is written
    setItems([...ids(80, 120), ...ids(120, 130)]);
    await frame();
    expect(root.scrollTop).toBe(920);
    expect(log.length).toBe(3);
    expect(log[2]).toBe('list:mutate');
  });

  it('noScrollRestore skips the write; noScrollRestoreOnTop skips it only at scrollTop 0; a removed anchor is replaced by the first item', async () => {
    const root = container();
    fakeLayout(root);
    const [items, setItems] = createSignal(ids(0, 10));
    const [onTop, setOnTop] = createSignal(false);
    const [never, setNever] = createSignal(false);
    createRoot(() => {
      insert(root, createComponent(ForC, { get each() { return items(); }, children: row }));
      createScrollAnchor({ container: () => root, items, noScrollRestore: never, noScrollRestoreOnTop: onTop });
    });
    await frame();
    setOnTop(true);
    setItems([-1, ...ids(0, 10)]); // at the top: a prepend pushes content down, by design
    await frame();
    expect(root.scrollTop).toBe(0);
    root.scrollTop = 80;
    setItems([-2, -1, ...ids(0, 10)]); // not at the top any more: restored
    await frame();
    expect(root.scrollTop).toBe(120);
    setNever(true);
    setItems([-3, -2, -1, ...ids(0, 10)]);
    await frame();
    expect(root.scrollTop).toBe(120); // not restored
    setNever(false);
    setItems(ids(5, 10)); // the anchor (-3, the first item) is gone: the new first item becomes the anchor, no write
    await frame();
    expect(root.scrollTop).toBe(120);
    setItems([4, ...ids(5, 10)]);
    await frame();
    expect(root.scrollTop).toBe(160); // anchored on 5 again
  });

  it('store list under a non-blocking animation: the parked snapshot, update and restore are released into ONE frame in phase order, even when the animation ends from a mutate task (R1)', async () => {
    const root = container();
    const log: string[] = [];
    fakeLayout(root, root, 40, 200, (top) => log.push(`restore:${getPhase()}:${top}`));
    const [state, setState] = createStore({ items: ids(100, 120) });
    const scope = createHeavyAnimationScope();
    createRoot(() => {
      provideHeavyAnimationScope(scope);
      insert(root, createComponent(ForC, { get each() { return state.items; }, children: row }));
      createScrollAnchor({ container: () => root, items: () => state.items });
      createMutationEffect(() => state.items, (v, prev) => { if (prev) log.push(`list:${getPhase()}`); });
    });
    await settle();
    root.scrollTop = 120;
    log.length = 0;
    const end = scope.begin(Infinity);
    setState('items', [...ids(80, 100), ...ids(100, 120)]);
    await settle();
    expect(root.querySelectorAll('.ListItem').length).toBe(20); // parked: the DOM did not change
    expect(log).toEqual([]);
    requestMutation(() => end()); // a Transition's onAnimationEnd ends the animation from the mutate phase
    const [other, setOther] = createSignal(0);
    createRoot(() => createMutationEffect(() => other(), () => {})); // a mutate drain of that frame runs after end()
    setOther(1);
    await settle(); // the frame in which end() runs: nothing of ours must apply in it
    expect(log).toEqual([]);
    await settle(); // the release frame
    expect(log).toEqual(['list:mutate', 'restore:mutate:920']); // measure (snapshot, silent) → mutate → forced-reflow mutate
    expect(root.scrollTop).toBe(920);
  });
  it('a store array written in place (produce, keyed reconcile) is anchored by its shape', async () => {
    const root = container();
    fakeLayout(root);
    const [state, setState] = createStore({ items: ids(100, 120).map((id) => ({ id })) });
    createRoot(() => {
      insert(root, createComponent(ForC, { get each() { return state.items; }, children: (m: { id: number }) => row(m.id) }));
      createScrollAnchor({ container: () => root, items: () => state.items });
    });
    await settle();
    root.scrollTop = 120;
    setState('items', produce((list: { id: number }[]) => { list.unshift(...ids(80, 100).map((id) => ({ id }))); }));
    await settle();
    expect(root.querySelectorAll('.ListItem').length).toBe(40);
    expect(root.scrollTop).toBe(920);
    setState('items', reconcile(ids(60, 120).map((id) => ({ id })))); // 20 more on top, rows matched by id
    await settle();
    expect(root.querySelectorAll('.ListItem').length).toBe(60);
    expect(root.scrollTop).toBe(1720);
  });
});

function mount(extra: Record<string, unknown>, initial: number[]) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const root = container();
  const [items, setItems] = createSignal(initial);
  const loads: unknown[] = [];
  let el!: HTMLDivElement;
  createRoot(() => {
    insert(
      root,
      createComponent(InfiniteScroll, {
        get items() { return items(); },
        ref: (e: HTMLDivElement) => { el = e; },
        onLoadMore: (args: unknown) => loads.push(args),
        class: 'list',
        get children() { return createComponent(ForC, { get each() { return items(); }, children: row }); },
        ...extra,
      }),
    );
  });
  fakeLayout(el);
  return { el, items, setItems, loads };
}

describe('<InfiniteScroll>', () => {
  it('preloads backwards when the list is shorter than preloadBackwards; otherwise when it does not fill the viewport; not when it does', async () => {
    const short = mount({}, ids(0, 5));
    await frame();
    expect(short.loads).toEqual([{ direction: 'backwards', noScroll: true }]);
    expect(short.el.className).toBe('list');

    const notFilling = mount({ preloadBackwards: 0 }, ids(0, 3)); // 120 px < 200 px viewport
    await frame();
    expect(notFilling.loads).toEqual([{ direction: 'backwards', noScroll: false }]);

    const full = mount({}, ids(0, 50));
    await frame();
    expect(full.loads).toEqual([]);
  });

  it('scrolling near the bottom (moving down) asks backwards, near the top (moving up) forwards; quiet for 1 s; the restore\'s own scroll event is ignored', async () => {
    const { el, setItems, loads } = mount({ sensitiveArea: 100 }, ids(0, 50)); // 2000 px, viewport 200
    await frame();
    el.dispatchEvent(new Event('scroll')); // first event: the anchor is tracked, no load
    expect(loads).toEqual([]);
    el.scrollTop = 1750; // 50 px from the bottom
    el.dispatchEvent(new Event('scroll'));
    expect(loads).toEqual([{ direction: 'backwards', noScroll: false }]);
    el.scrollTop = 1800;
    el.dispatchEvent(new Event('scroll'));
    expect(loads.length).toBe(1); // debounced: quiet for a second
    setItems(ids(0, 70)); // the chunk arrives: appended, no restore
    await frame();
    el.scrollTop = 2750;
    el.dispatchEvent(new Event('scroll'));
    expect(loads.length).toBe(2); // a new chunk re-arms the loader
    // back to the top
    el.scrollTop = 500;
    el.dispatchEvent(new Event('scroll'));
    el.scrollTop = 50;
    el.dispatchEvent(new Event('scroll'));
    expect(loads[2]).toEqual({ direction: 'forwards' });
    setItems([...ids(-20, 0), ...ids(0, 70)]); // 20 rows prepended → restored to 850
    await frame();
    expect(el.scrollTop).toBe(850);
    el.dispatchEvent(new Event('scroll')); // the browser's scroll event from the restore: not a user scroll
    expect(loads.length).toBe(3);
  });
});

describe('<InfiniteScroll> tracked reads', () => {
  it('reads the list\'s shape once per update — one tracked read beyond createScrollAnchor\'s own (clean-room finding 7)', async () => {
    // A list whose shape read is observable: a Proxy over a plain array that answers [TRACK] like a store array does.
    let shapeReads = 0;
    const shaped = (arr: number[]) =>
      new Proxy(arr, {
        get(target, key, receiver) {
          if (key === TRACK) {
            shapeReads++;
            return target;
          }
          return Reflect.get(target, key, receiver);
        },
      });
    // Reference: the anchor alone.
    const box = container();
    fakeLayout(box);
    const [a, setA] = createSignal(shaped(ids(0, 5)));
    createRoot(() => createScrollAnchor({ container: () => box, items: a }));
    await settle();
    shapeReads = 0;
    setA(shaped(ids(0, 6)));
    await settle();
    const anchorReads = shapeReads;
    expect(anchorReads).toBeGreaterThan(0);
    // The component (no <For>: a list component reads the shape too, and that is its own read).
    const { setItems } = mount({ children: undefined }, shaped(ids(0, 50)));
    await settle();
    shapeReads = 0;
    setItems(shaped(ids(0, 60)));
    await settle();
    expect(shapeReads).toBe(anchorReads + 1);
  });
});
