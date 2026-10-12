import { isUnsafeAttribute, setAttribute, setAttributeNS } from '../../src/dom/attributes';

const XLINK = 'http://www.w3.org/1999/xlink';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('on* attributes are never written (C1, C2, C3)', () => {
  it('refuses a string through attr:', () => {
    const a = document.createElement('a');
    setAttribute(a, 'attr:onclick', 'alert(1)');
    expect(a.hasAttribute('onclick')).toBe(false);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it.each(['ONCLICK', 'onClick', 'OnMouseOver', 'attr:ONCLICK', 'attr:onError'])('refuses the name %s case-insensitively', (name) => {
    const a = document.createElement('a');
    setAttribute(a, name, 'alert(1)');
    expect(Array.from(a.attributes).map((attr) => attr.name)).toEqual([]);
  });

  it('refuses non-string, non-null values (String object, number, true, object)', () => {
    const a = document.createElement('a');
    // oxlint-disable-next-line no-new-wrappers -- the wrapper object is the probe
    for (const value of [new String('alert(1)'), 1, true, { toString: () => 'alert(1)' }]) {
      setAttribute(a, 'onclick', value);
      expect(a.hasAttribute('onclick')).toBe(false);
    }
  });

  it('null/undefined/false only remove', () => {
    const a = document.createElement('a');
    for (const value of [null, undefined, false]) {
      setAttribute(a, 'onclick', value);
      expect(a.hasAttribute('onclick')).toBe(false);
    }
    expect(errors).not.toHaveBeenCalled();
  });
});

describe('URL attributes (C2, C3)', () => {
  it.each([
    ['HREF', 'javascript:alert(1)'],
    ['Href', ' JavaScript:alert(1)'],
    ['attr:href', 'javascript:alert(1)'],
    ['attr:HREF', 'javascript:alert(1)'],
    ['src', 'javascript:alert(1)'],
    ['action', 'javascript:alert(1)'],
    ['formAction', 'javascript:alert(1)'],
    ['FORMACTION', 'javascript:alert(1)'],
  ])('refuses %s=%s', (name, value) => {
    const el = document.createElement('button');
    setAttribute(el, name, value);
    expect(Array.from(el.attributes)).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('checks the stringified value: URL and String objects, objects with toString', () => {
    const a = document.createElement('a');
    // oxlint-disable-next-line no-new-wrappers -- the wrapper object is the probe
    for (const value of [new URL('javascript:alert(1)'), new String('javascript:alert(1)'), { toString: () => 'javascript:alert(1)' }]) {
      setAttribute(a, 'href', value);
      expect(a.hasAttribute('href')).toBe(false);
    }
    setAttribute(a, 'href', new URL('https://example.com/x'));
    expect(a.getAttribute('href')).toBe('https://example.com/x');
  });

  it('stringifies once (a toString that changes its answer cannot pass the check)', () => {
    const a = document.createElement('a');
    let calls = 0;
    const sly = { toString: () => (calls++ === 0 ? 'https://ok.example' : 'javascript:alert(1)') };
    setAttribute(a, 'href', sly);
    expect(a.getAttribute('href')).toBe('https://ok.example');
  });

  it('setAttributeNS checks the stringified value too', () => {
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    setAttributeNS(use, XLINK, 'xlink:href', new URL('javascript:alert(1)'));
    expect(use.hasAttributeNS(XLINK, 'href')).toBe(false);
  });
});

describe('isUnsafeAttribute (shared with spread)', () => {
  it('reports the same decisions as setAttribute', () => {
    expect(isUnsafeAttribute('onclick', 'x')).toBe(true);
    expect(isUnsafeAttribute('ONCLICK', () => {})).toBe(true);
    expect(isUnsafeAttribute('onclick', null)).toBe(false);
    expect(isUnsafeAttribute('HREF', 'javascript:alert(1)')).toBe(true);
    expect(isUnsafeAttribute('href', new URL('javascript:alert(1)'))).toBe(true);
    expect(isUnsafeAttribute('href', '/safe')).toBe(false);
    expect(isUnsafeAttribute('title', 'javascript:alert(1)')).toBe(false);
    expect(isUnsafeAttribute('href', null)).toBe(false);
  });
});
