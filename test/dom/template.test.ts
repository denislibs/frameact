import { template } from '../../src/dom/template';
import { DelegatedEvents, getPropAlias, SVG_NS } from '../../src/dom/constants';

it('clones a fresh element per call, parsing the template once', () => {
  const t = template('<div class=a><span>x');
  const a = t();
  const b = t();
  expect(a).not.toBe(b);
  expect(a.outerHTML).toBe('<div class="a"><span>x</span></div>');
  expect(a.isConnected).toBe(false);
});

it('flag 2 strips the wrapper element (SVG partials)', () => {
  const t = template('<svg><rect x=1></svg>', 2);
  const rect = t();
  expect(rect.tagName.toLowerCase()).toBe('rect');
  expect(rect.namespaceURI).toBe(SVG_NS);
});

it('flag 1 uses importNode (custom elements)', () => {
  const spy = vi.spyOn(document, 'importNode');
  const el = template('<my-element>', 1)();
  expect(el.tagName.toLowerCase()).toBe('my-element');
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});

it('vendored constants are exported', () => {
  expect(DelegatedEvents.has('click')).toBe(true);
  expect(getPropAlias('readonly', 'INPUT')).toBe('readOnly');
  expect(getPropAlias('readonly', 'DIV')).toBeUndefined();
  expect(getPropAlias('class', 'DIV')).toBe('className');
});
