import { createRoot, createSignal } from 'frameact';
import { render } from 'frameact/dom';
import { setAttribute } from '../../src/dom/attributes';
import { forceControlledValue } from '../../src/dom/controlled';
import { clearDelegatedEvents, EVENT_KEY } from '../../src/dom/events';
import { getNatives } from '../../src/dom/natives';
import { spread } from '../../src/dom/props';
import { clobber } from '../helpers/clobber';
import { flushMicrotasks } from '../helpers/micro';

// The compiler clones templates with `cloneNode`, so a fresh clone is owned by the template's inert
// document (no browsing context) while `use:value` binds it. These tests go through real compiled TSX
// (frameact/vite) and through hand-made inert nodes; the document listeners must still end up on a
// live document. Nothing here calls registerControlledDirectives(): the plugin injects it.

afterEach(() => {
  clearDelegatedEvents();
  document.body.textContent = '';
});

/** Simulate a keystroke: the browser has already changed the value when `input` fires. */
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function mount(view: () => any, into: Element = document.body) {
  const host = into.ownerDocument.createElement('div');
  into.appendChild(host);
  return { host, dispose: render(view, host) };
}

const letters = (v: string) => /^[a-z]*$/.test(v);

function Letters() {
  const [text, setText] = createSignal('ab');
  return (
    <input
      use:value={text}
      onInput={(e) => {
        const v = e.currentTarget.value;
        if (letters(v)) setText(v);
      }}
    />
  );
}

function Area() {
  const [text, setText] = createSignal('ab');
  return <textarea use:value={text} onInput={(e) => letters(e.currentTarget.value) && setText(e.currentTarget.value)} />;
}

function Pick() {
  const [pick, setPick] = createSignal('a');
  return (
    <select use:value={pick} onInput={(e) => e.currentTarget.value !== 'c' && setPick(e.currentTarget.value)}>
      <option value="a">a</option>
      <option value="b">b</option>
      <option value="c">c</option>
    </select>
  );
}

function Box() {
  const [on, setOn] = createSignal(false);
  return <input type="checkbox" use:checked={on} onChange={(e) => e.currentTarget.checked && setOn(true)} />;
}

function Plain(props: { text: string; set: (v: string) => void }) {
  return <input use:value={props.text} onInput={(e) => letters(e.currentTarget.value) && props.set(e.currentTarget.value)} />;
}

it('compiled use:value reverts a rejected character (the clone is bound while owned by the inert template document)', () => {
  const { host, dispose } = mount(() => <Letters />);
  const input = host.querySelector('input')!;
  expect(input.value).toBe('ab');
  type(input, 'ab1');
  expect(input.value).toBe('ab');
  type(input, 'abc');
  expect(input.value).toBe('abc');
  dispose();
});

it('the plain-value form (use:value={props.x}) reverts too', async () => {
  const [text, setText] = createSignal('ab');
  const { host, dispose } = mount(() => <Plain text={text()} set={setText} />);
  const input = host.querySelector('input')!;
  type(input, 'ab1');
  await flushMicrotasks();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); // the deferred check runs in the frame
  expect(input.value).toBe('ab');
  dispose();
});

it('compiled <textarea use:value> reverts', () => {
  const { host, dispose } = mount(() => <Area />);
  const area = host.querySelector('textarea')!;
  type(area, 'ab1');
  expect(area.value).toBe('ab');
  dispose();
});

it('compiled <select use:value> reverts a rejected option', () => {
  const { host, dispose } = mount(() => <Pick />);
  const select = host.querySelector('select')!;
  select.value = 'b';
  select.dispatchEvent(new Event('input', { bubbles: true }));
  expect(select.value).toBe('b');
  select.value = 'c';
  select.dispatchEvent(new Event('input', { bubbles: true }));
  expect(select.value).toBe('b');
  dispose();
});

it('compiled use:checked reverts a rejected toggle', () => {
  const { host, dispose } = mount(() => <Box />);
  const box = host.querySelector('input')!;
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  expect(box.checked).toBe(true);
  box.checked = false; // the handler refuses to uncheck
  box.dispatchEvent(new Event('change', { bubbles: true }));
  expect(box.checked).toBe(true);
  dispose();
});

it('IME composition on a compiled input is not rolled back until it ends', async () => {
  const { host, dispose } = mount(() => <Letters />);
  const input = host.querySelector('input')!;
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.value = 'abか'; // composing text the handler would reject
  input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  expect(input.value).toBe('abか');
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); // the post-composition check is deferred
  expect(input.value).toBe('ab');
  dispose();
});

it('forceControlledValue works on a compiled input', () => {
  const { host, dispose } = mount(() => <Letters />);
  const input = host.querySelector('input')!;
  forceControlledValue(input, 'zz');
  expect(input.value).toBe('zz');
  dispose();
});

it('an input created in an inert document and bound there is reverted once it is moved into the live one', () => {
  const t = document.createElement('template');
  t.innerHTML = '<input>';
  const input = t.content.firstChild!.cloneNode(true) as HTMLInputElement;
  expect(input.ownerDocument).not.toBe(document);
  const [text, setText] = createSignal('ab');
  createRoot(() => setAttribute(input, 'use:value', text));
  (input as any)[EVENT_KEY + 'input'] = (e: Event) => letters((e.currentTarget as HTMLInputElement).value) && setText((e.currentTarget as HTMLInputElement).value);
  document.body.appendChild(input);
  type(input, 'ab1');
  expect(input.value).toBe('ab');
  clearDelegatedEvents();
  input.remove();
});

describe('another live document', () => {
  it('a compiled input rendered into an iframe is reverted there (listeners land on the iframe document)', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const { host, dispose } = mount(() => <Letters />, doc.body);
    await flushMicrotasks(); // the detached-at-bind element is re-resolved after the render has inserted it
    const input = host.querySelector('input')!;
    expect(input.ownerDocument).toBe(doc);
    type(input, 'ab1');
    expect(input.value).toBe('ab');
    type(input, 'abc');
    expect(input.value).toBe('abc');
    dispose();
    clearDelegatedEvents(doc);
  });

  it('a document from createHTMLDocument works the same', async () => {
    const doc = document.implementation.createHTMLDocument('x');
    const { host, dispose } = mount(() => <Letters />, doc.body);
    await flushMicrotasks();
    const input = host.querySelector('input')!;
    type(input, 'ab1');
    expect(input.value).toBe('ab');
    dispose();
    clearDelegatedEvents(doc);
  });

  it('listeners are installed once per document, however many inputs bind', async () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    const natives = getNatives();
    const original = natives.addEventListener;
    const types: string[] = [];
    const spy = vi.spyOn(natives, 'addEventListener').mockImplementation(function (this: EventTarget, ...args: Parameters<typeof original>) {
      if (this === doc) types.push(args[0]);
      return original.apply(this, args);
    });
    try {
      const { dispose: d1 } = mount(() => <Letters />, doc.body);
      const { dispose: d2 } = mount(() => <Letters />, doc.body);
      await flushMicrotasks();
      expect(types.filter((t) => t === 'selectionchange')).toHaveLength(1);
      expect(types.filter((t) => t === 'focusout')).toHaveLength(1);
      d1();
      d2();
    } finally {
      spy.mockRestore();
      clearDelegatedEvents(doc);
    }
  });
});

it('a delegated spread handler on a compiled element works (same inert-owner root cause)', () => {
  const calls: string[] = [];
  const props = { onClick: () => calls.push('click') };
  const { host, dispose } = mount(() => <button {...props}>b</button>);
  host.querySelector('button')!.click();
  expect(calls).toEqual(['click']);
  dispose();
});

it('spread onClick on an inert-owned <form> whose isConnected is shadowed still delegates on the live document', () => {
  const t = document.createElement('template');
  t.innerHTML = '<form><img name="isConnected"></form>';
  const form = t.content.firstChild!.cloneNode(true) as HTMLFormElement;
  clobber(form, 'isConnected', form.firstChild); // what [LegacyOverrideBuiltIns] presents (jsdom lacks it)
  const calls: string[] = [];
  createRoot(() => spread(form, { onClick: () => calls.push('click') }));
  document.body.appendChild(form);
  form.click();
  expect(calls).toEqual(['click']);
});

it('a node bound after insertion into a document without a browsing context listens on that document at once (no settle)', () => {
  const doc = document.implementation.createHTMLDocument('x');
  const input = doc.createElement('input');
  doc.body.appendChild(input);
  const [text, setText] = createSignal('ab');
  createRoot(() => setAttribute(input, 'use:value', text));
  (input as any)[EVENT_KEY + 'input'] = (e: Event) => letters((e.currentTarget as HTMLInputElement).value) && setText((e.currentTarget as HTMLInputElement).value);
  type(input, 'ab1'); // synchronously: the microtask has not run
  expect(input.value).toBe('ab');
  clearDelegatedEvents(doc);
});
