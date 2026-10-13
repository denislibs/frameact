import { createRoot, createSignal, requestMutation } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { For } from '../../src/dom/list';
import { createStore, produce } from 'frameact/store';
import { createScrollAnchor } from '../../src/kit/scrollAnchor';
import { container, useDomHarness } from '../helpers/dom';
import { fakeLayout, resetLayout } from '../helpers/layout';

const { frame } = useDomHarness();

afterEach(() => {
  resetLayout();
});

const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

function row(id: number) {
  const el = document.createElement('div');
  el.className = 'ListItem Row';
  el.textContent = String(id);
  return el;
}

const ForC = For as (props: any) => unknown;

function mountList(initial: number[], extra: Record<string, unknown> = {}) {
  const root = container();
  fakeLayout(root);
  const [items, setItems] = createSignal(initial);
  const anchor = createRoot(() => {
    insert(root, createComponent(ForC, { get each() { return items(); }, children: row }));
    return createScrollAnchor({ container: () => root, items, ...extra });
  });
  return { root, items, setItems, anchor };
}

describe('items written in the mutate phase', () => {
  it('the snapshot of that change is not taken in time: nothing is restored from a stale base (no jump), the next change anchors normally', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // DEV: "dirtied during the mutate phase"
    const { root, items, setItems } = mountList(ids(0, 20));
    await frame();
    root.scrollTop = 120; // the user scrolled; nobody told the anchor (no `track`)
    requestMutation(() => setItems([...items(), ...ids(20, 30)])); // e.g. a Transition's onStop, a store write from a mutation apply
    await frame();
    await frame(); // the late snapshot runs here
    expect(root.querySelectorAll('.ListItem').length).toBe(30);
    expect(root.scrollTop).toBe(120);

    root.scrollTop = 200; // scrolled again; the late snapshot above is older than this
    requestMutation(() => setItems([...items(), ...ids(30, 40)]));
    await frame();
    await frame();
    expect(root.scrollTop).toBe(200);

    setItems([...ids(-10, 0), ...items()]); // an ordinary change, from outside the frame: snapshot in time, restored
    await frame();
    expect(root.scrollTop).toBe(600);
  });
});

describe('a store array is followed by its shape version, not by copies of its items', () => {
  it('a list change reads no item of the array (one O(1) subscription instead of O(n) copies per effect)', async () => {
    const root = container();
    fakeLayout(root);
    for (const id of ids(0, 50)) root.append(row(id));
    const raw = ids(0, 50).map((id) => ({ id }));
    let reads = 0;
    raw.forEach((item, i) => {
      Object.defineProperty(raw, i, { configurable: true, enumerable: true, get: () => { reads++; return item; }, set: () => {} });
    });
    const [state, setState] = createStore({ items: raw });
    createRoot(() => createScrollAnchor({ container: () => root, items: () => state.items }));
    await frame();
    reads = 0;
    setState('items', produce((list: { id: number }[]) => { list.push({ id: 50 }); }));
    root.append(row(50));
    await frame();
    root.scrollTop = 80;
    setState('items', produce((list: { id: number }[]) => { list.push({ id: 51 }); }));
    await frame();
    expect(reads).toBe(0);
  });
});

// The fake layout lists `.ListItem` rows itself, so the anchor under test uses its own selector.
const listings = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([selector]) => selector === '.Row').length;
const mountRows = (initial: number[]) => mountList(initial, { itemSelector: '.Row' });

describe('the list of item elements', () => {

  it('a change lists nothing; items() builds the list once per change, on demand (scroll handlers), and it is current', async () => {
    const { root, setItems, anchor, items } = mountRows(ids(0, 20));
    const all = vi.spyOn(root, 'querySelectorAll');
    await frame();
    root.scrollTop = 80;
    setItems([...ids(-5, 0), ...items()]); // prepend: restored without listing the rows
    await frame();
    expect(root.scrollTop).toBe(280);
    expect(listings(all)).toBe(0);
    expect(anchor.items().map((el) => el.textContent)).toEqual(ids(-5, 20).map(String));
    expect(anchor.items()).toBe(anchor.items());
    expect(listings(all)).toBe(1);
    setItems([...items(), 99]);
    await frame();
    expect(listings(all)).toBe(1);
    expect(anchor.items().at(-1)?.textContent).toBe('99');
    expect(listings(all)).toBe(2);
  });

  it('a removed anchor is replaced by the first item without listing the rows', async () => {
    const { root, setItems, anchor } = mountRows(ids(0, 10));
    const all = vi.spyOn(root, 'querySelectorAll');
    await frame();
    expect(anchor.anchor()?.textContent).toBe('0');
    setItems(ids(5, 10));
    await frame();
    await frame();
    expect(anchor.anchor()?.textContent).toBe('5');
    expect(root.contains(anchor.anchor() ?? null)).toBe(true);
    expect(listings(all)).toBe(0);
  });
});

describe('the restore flag', () => {
  it('is true right after a restore wrote scrollTop, and gone one frame later even if no scroll event consumed it (a clamped write fires none)', async () => {
    const { root, items, setItems, anchor } = mountList(ids(0, 20));
    await frame();
    root.scrollTop = 80;
    setItems([...ids(-5, 0), ...items()]);
    await frame();
    expect(root.scrollTop).toBe(280);
    expect(anchor.consumeRestored()).toBe(true); // the scroll event of that write would be ignored
    expect(anchor.consumeRestored()).toBe(false); // once

    setItems([...ids(-10, -5), ...items()]);
    await frame();
    expect(root.scrollTop).toBe(480);
    await frame(); // no scroll event came: the next user scroll must not be swallowed
    expect(anchor.consumeRestored()).toBe(false);
  });
});
