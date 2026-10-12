import { createRoot, createSignal, requestMutation } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { For } from '../../src/dom/list';
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
  el.className = 'ListItem';
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
