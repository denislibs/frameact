import { setExtraStyles, setStyleProperty, style } from '../../src/dom/styles';

it('object form sets, updates and removes per property; untouched properties are not rewritten', () => {
  const el = document.createElement('div');
  style(el, { color: 'red', 'font-size': '12px' });
  expect(el.style.color).toBe('red');
  expect(el.style.fontSize).toBe('12px');
  const set = vi.spyOn(el.style, 'setProperty');
  style(el, { color: 'blue', 'font-size': '12px', opacity: 0.5 }, { color: 'red', 'font-size': '12px' });
  expect(el.style.color).toBe('blue');
  expect(el.style.opacity).toBe('0.5');
  expect(set).toHaveBeenCalledTimes(2); // color + opacity
  style(el, { color: 'blue' });
  expect(el.style.fontSize).toBe('');
  expect(el.style.opacity).toBe('');
  expect(el.style.color).toBe('blue');
});

it('null removes only the properties the binding applied; imperative extra styles survive', () => {
  const el = document.createElement('div');
  setExtraStyles(el, { '--x': '1', marginTop: '2px' });
  style(el, { color: 'red' });
  style(el, null);
  expect(el.style.color).toBe('');
  expect(el.style.getPropertyValue('--x')).toBe('1');
  expect(el.style.marginTop).toBe('2px');
});

it('string form writes cssText (documented: incompatible with setExtraStyles) and transitions back to objects', () => {
  const el = document.createElement('div');
  style(el, 'color: red; margin: 1px');
  expect(el.style.cssText).toBe('color: red; margin: 1px;');
  style(el, { padding: '3px' }, 'color: red; margin: 1px');
  expect(el.style.color).toBe('');
  expect(el.style.padding).toBe('3px');
  style(el, null, { padding: '3px' });
  expect(el.style.padding).toBe('');
});

it('setStyleProperty sets and removes', () => {
  const el = document.createElement('div');
  setStyleProperty(el, 'width', '10px');
  expect(el.style.width).toBe('10px');
  setStyleProperty(el, 'width', null);
  expect(el.style.width).toBe('');
});

it('setExtraStyles supports camelCase properties and custom properties; null removes', () => {
  const el = document.createElement('div');
  setExtraStyles(el, { backgroundColor: 'red', '--y': 2 });
  expect(el.style.backgroundColor).toBe('red');
  expect(el.style.getPropertyValue('--y')).toBe('2');
  setExtraStyles(el, { backgroundColor: null, '--y': undefined });
  expect(el.style.backgroundColor).toBe('');
  expect(el.style.getPropertyValue('--y')).toBe('');
});
