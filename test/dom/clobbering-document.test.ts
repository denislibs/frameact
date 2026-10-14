// DOM clobbering at the `document` level (appsec M1 of plan 3): `Document` has [LegacyOverrideBuiltIns]
// too, so `<img name="createTextNode">` shadows `document.createTextNode` in a browser. jsdom does not
// implement named properties; the tests define the same own, non-writable shadow on `document` and
// check that the runtime goes through the prototype natives.
import { createRoot, createSignal } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { clearDelegatedEvents, delegateEvents } from '../../src/dom/events';
import { Dynamic, Portal } from '../../src/dom/flow';
import { insert } from '../../src/dom/insert';
import { For } from '../../src/dom/list';
import { render } from '../../src/dom/render';
import { template } from '../../src/dom/template';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();
const ForC = For as (props: any) => unknown;

const mk = (tag: string): HTMLElement => Document.prototype.createElement.call(document, tag) as HTMLElement; // (the test itself must not use the shadowed methods)
const shadowed: string[] = [];
function shadow(name: string, value: unknown = mk('img')): void {
  Object.defineProperty(document, name, { value, writable: false, enumerable: false, configurable: true });
  shadowed.push(name);
}
afterEach(() => {
  for (const name of shadowed.splice(0)) delete (document as any)[name];
});

describe('document shadows do not break the runtime', () => {
  it('createTextNode: new rows, text slots and render() bounds', async () => {
    const ul = container();
    shadow('createTextNode');
    const [list, setList] = createSignal([1]);
    createRoot(() =>
      insert(ul, createComponent(ForC, {
        get each() { return list(); },
        children: (n: number) => { const li = mk('li'); insert(li, () => `row ${n}`); return li; },
      })),
    );
    setList([1, 2]);
    await frame();
    expect(Array.from(ul.children).map((c) => c.textContent)).toEqual(['row 1', 'row 2']);
    const host = container();
    host.appendChild(mk('hr'));
    const dispose = render(() => 'bounded', host);
    expect(host.textContent).toBe('bounded');
    dispose();
  });
  it('createElement and importNode: templates (first render) and <Dynamic>', () => {
    const host = container();
    shadow('createElement');
    shadow('importNode');
    shadow('createElementNS');
    const t = template('<p>hi</p>', 1);
    const t2 = template('<b>x</b>');
    host.appendChild(t());
    host.appendChild(t2());
    expect(host.innerHTML).toBe('<p>hi</p><b>x</b>');
    const dispose = render(() => createComponent(Dynamic, { component: 'section', get children() { return 'dyn'; } }), host);
    expect(host.querySelector('section')).not.toBeNull();
    dispose();
  });
  it('body: a default <Portal> mounts into the real body, not into the shadowing element', () => {
    const logical = container();
    const img = mk('img');
    shadow('body', img);
    const dispose = render(() => createComponent(Portal, { get children() { const e = mk('em'); e.textContent = 'modal'; return e; } }), logical);
    expect(img.childNodes.length).toBe(0);
    expect(Object.getOwnPropertyDescriptor(Document.prototype, 'body')!.get!.call(document).querySelector('em')!.textContent).toBe('modal');
    dispose();
  });
  it('addEventListener / removeEventListener: delegation installs and clears', () => {
    shadow('addEventListener');
    shadow('removeEventListener');
    expect(() => delegateEvents(['click'])).not.toThrow();
    expect(() => clearDelegatedEvents()).not.toThrow();
  });
});
