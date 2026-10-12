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

it('string form writes cssText and transitions back to objects', () => {
  const el = document.createElement('div');
  style(el, 'color: red; margin: 1px');
  expect(el.style.getPropertyValue('color')).toBe('red');
  expect(el.style.getPropertyValue('margin-top')).toBe('1px');
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

it('string form is tracked on the element: null clears without prev, an identical string is a no-op', () => {
  const el = document.createElement('div');
  style(el, 'color: red');
  style(el, null);
  expect(el.style.color).toBe('');
  style(el, 'color: red');
  setStyleProperty(el, 'width', '5px'); // a style:x binding
  style(el, 'color: red'); // same string: cssText is not rewritten
  expect(el.style.width).toBe('5px');
  style(el, { padding: '1px' }); // string -> object without prev
  expect(el.style.color).toBe('');
  expect(el.style.padding).toBe('1px');
});

it('a trailing !important becomes the priority argument', () => {
  const el = document.createElement('div');
  style(el, { color: 'red !important' });
  expect(el.style.getPropertyValue('color')).toBe('red');
  expect(el.style.getPropertyPriority('color')).toBe('important');
  setStyleProperty(el, 'width', '1px  !important ');
  expect(el.style.getPropertyValue('width')).toBe('1px');
  expect(el.style.getPropertyPriority('width')).toBe('important');
});

it('DEV hints for camelCase keys and unitless numbers; behaviour is unchanged', () => {
  const el = document.createElement('div');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  style(el, { fontSize: '12px' });
  expect(err).toHaveBeenCalledTimes(1);
  expect(el.style.fontSize).toBe(''); // CSSOM ignores the camelCase name, as in Solid
  style(el, { width: 10 });
  expect(err).toHaveBeenCalledTimes(2);
  style(el, { opacity: 0.5, 'z-index': 3, '--n': 4, height: 0 });
  expect(err).toHaveBeenCalledTimes(2); // unitless / custom / zero: fine
  err.mockRestore();
});

it('a custom property value with ";" does not set other properties and is DEV-flagged', () => {
  const el = document.createElement('div');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  style(el, { '--x': 'red; background: blue' });
  expect(el.style.background).toBe('');
  expect(err).toHaveBeenCalledTimes(1);
  err.mockRestore();
});

it('extra styles survive string style= writes (teact parity): set before or between, re-applied after every cssText write, removed on null', () => {
  const el = document.createElement('div');
  setExtraStyles(el, { height: '40px', '--x': 1 });
  style(el, 'color: red');
  expect(el.style.color).toBe('red');
  expect(el.style.height).toBe('40px');
  expect(el.style.getPropertyValue('--x')).toBe('1');
  setExtraStyles(el, { transition: 'none' }); // accumulates: height stays registered
  style(el, 'color: blue; margin: 1px');
  expect(el.style.color).toBe('blue');
  expect(el.style.height).toBe('40px');
  expect(el.style.transition).toBe('none');
  expect(el.style.getPropertyValue('--x')).toBe('1');
  style(el, null); // cssText cleared: the extras come back
  expect(el.style.color).toBe('');
  expect(el.style.height).toBe('40px');
  style(el, { padding: '2px' }, 'color: blue; margin: 1px'); // string -> object clears cssText too
  expect(el.style.padding).toBe('2px');
  expect(el.style.height).toBe('40px');
  setExtraStyles(el, { height: null, '--x': undefined });
  expect(el.style.height).toBe('');
  style(el, 'color: green');
  expect(el.style.height).toBe(''); // removed from the registry: not re-applied
  expect(el.style.getPropertyValue('--x')).toBe('');
  expect(el.style.transition).toBe('none');
});

it('a bound string style= and the extras of another element do not mix; the registry is per element', () => {
  const a = document.createElement('div');
  const b = document.createElement('div');
  setExtraStyles(a, { height: '1px' });
  style(b, 'color: red');
  expect(b.style.height).toBe('');
});

describe('setExtraStyles: names are CSS properties, never JS properties of the declaration', () => {
  it('cssText, setProperty and removeProperty as keys are inert: no overlay is written, no method is shadowed', () => {
    const el = document.createElement('div');
    setExtraStyles(el, { cssText: 'position:fixed;inset:0;background:red', setProperty: 'x', removeProperty: 'y', item: 'z' } as never);
    style(el, 'color: blue');
    expect(el.style.cssText).toBe('color: blue;');
    expect(el.style.position).toBe('');
    style(el, { width: '1px' }); // would throw "setProperty is not a function" if the method were shadowed
    expect(el.style.width).toBe('1px');
    expect(typeof el.style.setProperty).toBe('function');
    expect(Object.hasOwn(el.style, 'setProperty')).toBe(false);
  });

  it('__proto__ as a key (JSON) touches no prototype', () => {
    const el = document.createElement('div');
    const styles = JSON.parse('{"__proto__": "polluted", "color": "red"}') as Record<string, string>;
    setExtraStyles(el, styles);
    expect(el.style.color).toBe('red');
    expect(Object.getPrototypeOf(el.style)).toBe(Object.getPrototypeOf(document.createElement('p').style));
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('camelCase, kebab-case and vendor spellings of one property are one registry entry', () => {
    const el = document.createElement('div');
    setExtraStyles(el, { backgroundColor: 'red' });
    setExtraStyles(el, { 'background-color': null }); // another spelling removes it
    style(el, 'color: blue');
    expect(el.style.backgroundColor).toBe('');
    setExtraStyles(el, { cssFloat: 'left', WebkitTransform: 'none' });
    expect(el.style.getPropertyValue('float')).toBe('left');
  });
});
