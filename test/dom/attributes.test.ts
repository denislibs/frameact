import { setAttribute, setAttributeNS, setBoolAttribute, setProperty } from '../../src/dom/attributes';
import { defineDirective, use } from '../../src/dom/directives';
import { createMemo, createRoot, createSignal } from '../../src/index';

afterEach(() => {
  vi.restoreAllMocks();
});

const tooltipValue = () => 'hi';

it('plain attributes: null/false remove, true writes an empty value, values stringify', () => {
  const el = document.createElement('div');
  setAttribute(el, 'title', 'x');
  expect(el.getAttribute('title')).toBe('x');
  setAttribute(el, 'title', 0);
  expect(el.getAttribute('title')).toBe('0');
  setAttribute(el, 'hidden', true);
  expect(el.getAttribute('hidden')).toBe('');
  setAttribute(el, 'hidden', false);
  expect(el.hasAttribute('hidden')).toBe(false);
  setAttribute(el, 'title', null);
  expect(el.hasAttribute('title')).toBe(false);
});

it('class, classList and className go through the token diff (className warns in dev)', () => {
  const el = document.createElement('div');
  el.classList.add('extra');
  setAttribute(el, 'class', 'a');
  setAttribute(el, 'classList', { b: true });
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  setAttribute(el, 'className', 'c');
  expect(err).toHaveBeenCalledTimes(1);
  err.mockRestore();
  expect(new Set(Array.from(el.classList))).toEqual(new Set(['extra', 'b', 'c']));
});

it('class:x, style:x, attr:x, bool:x, prop:x', () => {
  const el = document.createElement('input');
  setAttribute(el, 'class:on', 1);
  expect(el.classList.contains('on')).toBe(true);
  setAttribute(el, 'class:on', 0);
  expect(el.classList.contains('on')).toBe(false);
  setAttribute(el, 'style:width', '5px');
  expect(el.style.width).toBe('5px');
  setAttribute(el, 'attr:value', 'raw');
  expect(el.getAttribute('value')).toBe('raw');
  setAttribute(el, 'bool:required', 'yes');
  expect(el.hasAttribute('required')).toBe(true);
  setAttribute(el, 'bool:required', '');
  expect(el.hasAttribute('required')).toBe(false);
  setAttribute(el, 'prop:value', 'p');
  expect(el.value).toBe('p');
});

it('xlink:href goes through setAttributeNS; setAttributeNS removes by local name', () => {
  const svgUse = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  setAttribute(svgUse, 'xlink:href', '#a');
  expect(svgUse.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('#a');
  setAttributeNS(svgUse, 'http://www.w3.org/1999/xlink', 'xlink:href', null);
  expect(svgUse.hasAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe(false);
});

it('refuses javascript: URLs on URL attributes and string event-handler attributes', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const a = document.createElement('a');
  setAttribute(a, 'href', 'java\tscript:alert(1)');
  expect(a.hasAttribute('href')).toBe(false);
  setAttribute(a, 'href', 'https://example.com');
  setAttribute(a, 'href', ' JAVASCRIPT:alert(1)');
  expect(a.hasAttribute('href')).toBe(false);
  setAttribute(a, 'onclick', 'alert(1)');
  expect(a.hasAttribute('onclick')).toBe(false);
  expect(err).toHaveBeenCalledTimes(3);
  err.mockRestore();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  setAttribute(a, 'onclick', () => {});
  expect(a.hasAttribute('onclick')).toBe(false);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

it('use:x dispatches to a registered directive with the raw value; unknown directives are reported', () => {
  const el = document.createElement('div');
  const tooltip = vi.fn();
  defineDirective('tooltip', tooltip);
  setAttribute(el, 'use:tooltip', tooltipValue);
  expect(tooltip).toHaveBeenCalledWith(el, tooltipValue);
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  setAttribute(el, 'use:nope', 1);
  expect(err).toHaveBeenCalledTimes(1);
  err.mockRestore();
});

it('use(fn, el, arg) is the hand-written directive form: fn(el, arg) runs untracked', () => {
  const el = document.createElement('div');
  const [n, setN] = createSignal(1);
  const directive = vi.fn((target: Element, arg: string) => {
    target.setAttribute('data-n', `${arg}${n()}`);
  });
  const runs = vi.fn();
  const memo = createRoot(() =>
    createMemo(() => {
      runs();
      use(directive, el, 'a');
      return 0;
    }),
  );
  memo();
  expect(directive).toHaveBeenCalledWith(el, 'a');
  expect(el.getAttribute('data-n')).toBe('a1');
  setN(2); // read inside the directive: it must not have subscribed the memo
  memo();
  expect(runs).toHaveBeenCalledTimes(1);
});

it('setBoolAttribute and setProperty (input value nullish → empty; select value applied after options arrive)', async () => {
  const input = document.createElement('input');
  setProperty(input, 'value', null);
  expect(input.value).toBe('');
  setProperty(input, 'value', 'v');
  expect(input.value).toBe('v');
  setBoolAttribute(input, 'disabled', 1);
  expect(input.disabled).toBe(true);
  const select = document.createElement('select');
  setProperty(select, 'value', 'b');
  const option = document.createElement('option');
  option.value = 'b';
  select.appendChild(option);
  await Promise.resolve();
  expect(select.value).toBe('b');
});
