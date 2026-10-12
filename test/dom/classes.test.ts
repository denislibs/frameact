import { addExtraClass, className, classList, classTokens, removeExtraClass, toggleClassToken, toggleExtraClass } from '../../src/dom/classes';

const classes = (el: Element) => new Set(Array.from(el.classList));

it('string form diffs tokens and keeps imperative classes', () => {
  const el = document.createElement('div');
  el.classList.add('extra');
  className(el, 'a b');
  expect(classes(el)).toEqual(new Set(['extra', 'a', 'b']));
  const add = vi.spyOn(el.classList, 'add');
  const remove = vi.spyOn(el.classList, 'remove');
  className(el, 'b c', 'a b');
  expect(classes(el)).toEqual(new Set(['extra', 'b', 'c']));
  expect(add).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(1);
  className(el, 'b c', 'b c'); // same value: nothing happens
  expect(add).toHaveBeenCalledTimes(1);
  className(el, null);
  expect(classes(el)).toEqual(new Set(['extra']));
});

it('object and array forms; multi-token keys; numbers; booleans ignored', () => {
  const el = document.createElement('div');
  className(el, ['base', { 'on sel': true, off: false, undefined: true }, 7, false, null, ['nested']]);
  expect(classes(el)).toEqual(new Set(['base', 'on', 'sel', '7', 'nested']));
  className(el, { on: true });
  expect(classes(el)).toEqual(new Set(['on']));
});

it('classList= is an independent channel from class=', () => {
  const el = document.createElement('div');
  className(el, 'a');
  classList(el, { b: true });
  expect(classes(el)).toEqual(new Set(['a', 'b']));
  className(el, 'c');
  expect(classes(el)).toEqual(new Set(['c', 'b']));
  classList(el, { b: false, d: true });
  expect(classes(el)).toEqual(new Set(['c', 'd']));
});

it('a token applied by both channels is removed when either drops it (keep the channels disjoint)', () => {
  const el = document.createElement('div');
  className(el, 'shared a');
  classList(el, { shared: true });
  expect(classes(el)).toEqual(new Set(['shared', 'a']));
  className(el, 'a');
  expect(classes(el)).toEqual(new Set(['a']));
});

it('class:x toggles single tokens (and splits multi-token names)', () => {
  const el = document.createElement('div');
  toggleClassToken(el, 'x', true);
  toggleClassToken(el, 'y z', true);
  expect(classes(el)).toEqual(new Set(['x', 'y', 'z']));
  toggleClassToken(el, 'y z', false);
  expect(classes(el)).toEqual(new Set(['x']));
});

it('extra-class helpers are thin classList wrappers that reactive updates leave alone', () => {
  const el = document.createElement('div');
  className(el, 'r1');
  addExtraClass(el, 'e');
  className(el, 'r2');
  expect(classes(el)).toEqual(new Set(['r2', 'e']));
  toggleExtraClass(el, 'e');
  expect(el.classList.contains('e')).toBe(false);
  toggleExtraClass(el, 'e', true);
  removeExtraClass(el, 'e');
  expect(classes(el)).toEqual(new Set(['r2']));
});

it('classTokens never yields empty tokens', () => {
  const out = new Set<string>();
  classTokens(['', '  ', { '': true, ' a ': true }], out);
  expect(out).toEqual(new Set(['a']));
});

it('works on SVG elements', () => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  className(el, { on: true });
  expect(el.getAttribute('class')).toBe('on');
});
