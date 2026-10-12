// DOM clobbering outside event delegation (appsec review M2/L3 of plan 2): a <form> row or container
// whose descendant is named like a built-in must not break the reconciler, insert, render, Portal,
// spread, attributes or the delegated-handler expandos. jsdom does not implement form named
// properties; `clobber` defines the same descriptor a browser presents (see test/helpers/clobber.ts).
// Console spies are restored by the harness (vi.restoreAllMocks in afterEach).
import { createRoot, createSignal } from '../../src/index';
import { setAttribute, setAttributeNS, setBoolAttribute } from '../../src/dom/attributes';
import { createComponent } from '../../src/dom/component';
import { addEvent, delegateEvents, EVENT_KEY } from '../../src/dom/events';
import { Portal } from '../../src/dom/flow';
import { insert } from '../../src/dom/insert';
import { For } from '../../src/dom/list';
import { assign, spread } from '../../src/dom/props';
import { render } from '../../src/dom/render';
import { clobber, clobberedForm } from '../helpers/clobber';
import { container, useDomHarness } from '../helpers/dom';

const { frame } = useDomHarness();

// Hand-built props: the `For` overloads are typed for JSX; here the row type is given by the children function.
const ForC = For as (props: any) => unknown;

const STRUCTURE = ['remove', 'parentNode', 'nextSibling', 'firstChild', 'nodeType', 'insertBefore', 'appendChild', 'replaceChild', 'removeChild', 'textContent', 'append'];

/** A row that is a <form> with every structural built-in shadowed (`<form><img id="remove"/></form>` and friends). */
function formRow(id: number): HTMLFormElement {
  const form = clobberedForm(...STRUCTURE);
  form.dataset.id = String(id);
  return form;
}

const ids = (parent: Element) => Array.from(parent.children).map((e) => (e as HTMLElement).dataset.id);

describe('reconciler and insert', () => {
  it('<For> rows that are clobbered forms: removals, moves, replacements and appends keep working', async () => {
    const ul = container();
    const [list, setList] = createSignal([1, 2, 3]);
    createRoot(() => insert(ul, createComponent(ForC, { get each() { return list(); }, children: formRow })));
    expect(ids(ul)).toEqual(['1', '2', '3']);
    setList([3, 1]); // remove 2, move 3 before 1 (udomdiff: replaceChild + remove)
    await frame();
    expect(ids(ul)).toEqual(['3', '1']);
    setList([4]); // everything replaced
    await frame();
    expect(ids(ul)).toEqual(['4']);
    setList([5, 6, 4]); // prepend
    await frame();
    expect(ids(ul)).toEqual(['5', '6', '4']);
    setList([6, 5, 4]); // swap
    await frame();
    expect(ids(ul)).toEqual(['6', '5', '4']);
    setList([]);
    await frame();
    expect(ids(ul)).toEqual([]);
  });

  it('<For order="manual"> with clobbered form rows: insert-only reconcile removes and inserts', async () => {
    const ul = container();
    type Chat = { id: number; rank: number };
    const [list, setList] = createSignal<Chat[]>([{ id: 1, rank: 1 }, { id: 2, rank: 2 }]);
    createRoot(() =>
      insert(
        ul,
        createComponent(ForC, {
          get each() { return list(); },
          keyed: (c: Chat) => c.id,
          order: 'manual',
          orderKey: (c: Chat) => c.rank,
          children: (item: () => Chat) => formRow(item().id),
        }),
      ),
    );
    setList([{ id: 3, rank: 0 }, { id: 2, rank: 2 }]); // remove 1, prepend 3
    await frame();
    expect(ids(ul)).toEqual(['3', '2']);
    setList([{ id: 2, rank: 5 }, { id: 3, rank: 0 }]); // orderKey of 2 changed: it moves
    await frame();
    expect(ids(ul)).toEqual(['2', '3']);
  });

  it('a clobbered <form> as the slot parent: multi and root mode, text and node values, cleanup', async () => {
    const form = clobberedForm(...STRUCTURE);
    container().appendChild(form);
    const marker = document.createTextNode('');
    Node.prototype.appendChild.call(form, marker);
    const [value, setValue] = createSignal<unknown>('text');
    createRoot(() => insert(form, value, marker));
    expect(marker.previousSibling!.textContent).toBe('text');
    const span = document.createElement('span');
    setValue(span);
    await frame();
    expect(marker.previousSibling).toBe(span);
    setValue([document.createElement('i'), 'x']);
    await frame();
    expect(form.childNodes.length).toBe(4); // img, i, text, marker
    setValue(null);
    await frame();
    expect(form.childNodes.length).toBe(3); // img, the slot's empty placeholder text, marker
    expect(marker.previousSibling!.textContent).toBe('');

    const rootForm = clobberedForm(...STRUCTURE);
    Node.prototype.removeChild.call(rootForm, rootForm.firstChild!); // root mode: the form is the only content
    const [root, setRoot] = createSignal<unknown>('a');
    createRoot(() => insert(rootForm, root));
    expect(rootForm.childNodes[0].textContent).toBe('a');
    setRoot('b');
    await frame();
    expect(rootForm.childNodes[0].textContent).toBe('b');
    setRoot(document.createElement('b'));
    await frame();
    expect(rootForm.childNodes[0].nodeName).toBe('B');
    setRoot('c');
    await frame();
    expect(rootForm.childNodes[0].textContent).toBe('c');
  });
});

describe('render and Portal', () => {
  it('render into a clobbered <form> container mounts and disposes (empty and non-empty container)', () => {
    const empty = clobberedForm(...STRUCTURE);
    Node.prototype.removeChild.call(empty, empty.firstChild!);
    container().appendChild(empty);
    const dispose = render(() => document.createElement('p'), empty);
    expect(empty.childNodes[0].nodeName).toBe('P');
    dispose();
    expect(empty.childNodes.length).toBe(0);

    const bounded = clobberedForm(...STRUCTURE); // has the <img>: bounded mode with markers
    container().appendChild(bounded);
    const dispose2 = render(() => document.createElement('p'), bounded);
    expect(bounded.childNodes.length).toBe(4); // img, start, p, end
    dispose2();
    expect(bounded.childNodes.length).toBe(1);
  });

  it('Portal into a clobbered <form> mount attaches and detaches its content', async () => {
    const mount = clobberedForm(...STRUCTURE);
    container().appendChild(mount);
    const dispose = createRoot((d) => {
      insert(container(), createComponent(Portal, { mount, get children() { return document.createElement('p'); } }));
      return d;
    });
    // (not querySelector: jsdom's selector engine reads the receiver's clobbered `nodeType` and throws)
    const hasP = () => Array.from(mount.childNodes).some((n) => n.nodeName === 'P');
    expect(hasP()).toBe(true);
    dispose();
    await frame();
    expect(hasP()).toBe(false);
  });
});

describe('spread, assign and attributes', () => {
  it('spread onto a clobbered <form> applies attributes, class, style and a delegated handler', async () => {
    const form = clobberedForm(...STRUCTURE, 'nodeName', 'localName', 'namespaceURI', 'ownerDocument', 'tagName', 'setAttribute', 'removeAttribute', EVENT_KEY + 'click');
    container().appendChild(form);
    const [on, setOn] = createSignal(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    createRoot(() => spread(form, () => ({ action: '/send', class: { on: on() }, style: { color: 'red' }, title: 'x', onClick: () => {} }), true));
    expect(form.getAttribute('action')).toBe('/send');
    expect(form.classList.contains('on')).toBe(true);
    expect(form.style.color).toBe('red');
    setOn(false);
    await frame();
    expect(form.classList.contains('on')).toBe(false);
    // the delegated handler could not be stored (non-writable named property): reported, nothing thrown
    expect(err.mock.calls.some((c) => String(c[0]).includes('could not store the delegated handler'))).toBe(true);
    assign(form, { title: 'y', hidden: true });
    expect(form.title).toBe('y');
    expect(form.hidden).toBe(true);
  });

  it('setAttribute / setAttributeNS / setBoolAttribute on a clobbered <form> write and remove', () => {
    const form = clobberedForm('setAttribute', 'removeAttribute', 'setAttributeNS', 'removeAttributeNS', 'nodeName');
    setAttribute(form, 'action', '/a');
    expect(form.getAttribute('action')).toBe('/a');
    setAttribute(form, 'action', null);
    expect(form.hasAttribute('action')).toBe(false);
    setAttributeNS(form, 'http://www.w3.org/XML/1998/namespace', 'xml:lang', 'en');
    expect(form.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')).toBe('en');
    setAttributeNS(form, 'http://www.w3.org/XML/1998/namespace', 'xml:lang', null);
    expect(form.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang')).toBeNull();
    setBoolAttribute(form, 'novalidate', true);
    expect(form.hasAttribute('novalidate')).toBe(true);
    setBoolAttribute(form, 'novalidate', false);
    expect(form.hasAttribute('novalidate')).toBe(false);
    // the policy still applies on the native path
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    setAttribute(form, 'action', 'javascript:alert(1)');
    expect(form.hasAttribute('action')).toBe(false);
    expect(err).toHaveBeenCalled();
  });
});

describe('delegated handlers on a form (L3)', () => {
  it('a handler whose bound data is shadowed by <img id="_$$clickData"> is skipped (not called with the image); ancestors still run', () => {
    const outer = container();
    const form = document.createElement('form');
    const img = document.createElement('img');
    form.appendChild(img);
    outer.appendChild(form);
    const inner = vi.fn();
    const outerHandler = vi.fn();
    addEvent(form, 'click', [inner, 'payload'], true);
    clobber(form, EVENT_KEY + 'clickData', img);
    addEvent(outer, 'click', outerHandler, true);
    delegateEvents(['click']);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(inner).not.toHaveBeenCalled();
    expect(outerHandler).toHaveBeenCalledTimes(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes('delegated handler skipped'))).toBe(true);
  });

  it('a handler shadowed by <img id="_$$click"> is skipped with a DEV error; shadowed data that looks like a RadioNodeList is skipped too', () => {
    const form = document.createElement('form');
    const img = document.createElement('img');
    form.appendChild(img);
    container().appendChild(form);
    clobber(form, EVENT_KEY + 'click', img);
    delegateEvents(['click']);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => img.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
    expect(err.mock.calls.some((c) => String(c[0]).includes('delegated handler skipped'))).toBe(true);

    const form2 = document.createElement('form');
    const input = document.createElement('input');
    form2.appendChild(input);
    container().appendChild(form2);
    const handler = vi.fn();
    addEvent(form2, 'click', [handler, { real: true }], true);
    clobber(form2, EVENT_KEY + 'clickData', form2.querySelectorAll('input')); // a NodeList: `item` + `length`
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });

  it('bound data written by addEvent is passed through even when it is a Node — on a form (writable expando) and on a div', () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    form.appendChild(input);
    container().appendChild(form);
    const onForm = vi.fn();
    const formData = document.createElement('span');
    addEvent(form, 'click', [onForm, formData], true);
    delegateEvents(['click']);
    input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onForm).toHaveBeenCalledTimes(1);
    expect(onForm.mock.calls[0][0]).toBe(formData); // our own expando is writable: not a clobbered named property

    const div = container();
    const onDiv = vi.fn();
    const divData = document.createElement('span');
    addEvent(div, 'click', [onDiv, divData], true);
    div.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onDiv).toHaveBeenCalledTimes(1);
    expect(onDiv.mock.calls[0][0]).toBe(divData);
  });

  it('addEvent on a form whose descendant shadows the expando does not throw (strict-mode TypeError is caught, DEV error)', () => {
    const form = clobberedForm(EVENT_KEY + 'click');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => addEvent(form, 'click', () => {}, true)).not.toThrow();
    expect(() => addEvent(form, 'click', [() => {}, 1], true)).not.toThrow();
    expect(err).toHaveBeenCalledTimes(2);
  });
});
