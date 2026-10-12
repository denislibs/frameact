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

describe('URL scheme policy (I3)', () => {
  const URL_ATTRS = ['href', 'src', 'action', 'formaction', 'poster', 'srcset', 'data', 'xlink:href'];

  it.each(['javascript', 'vbscript'])('refuses %s: on every URL attribute, however it is dressed up', (scheme) => {
    const el = document.createElement('div');
    for (const name of URL_ATTRS) {
      for (const dressed of [`${scheme}:x`, ` \t${scheme.toUpperCase()}:x`, `\u0001 ${scheme.slice(0, 4)}\n${scheme.slice(4)}:x`, `${scheme.slice(0, 3)}\t${scheme.slice(3, 6)}\r\n${scheme.slice(6)}:x`]) {
        setAttribute(el, name, dressed);
        expect(el.hasAttribute(name), `${name}=${JSON.stringify(dressed)}`).toBe(false);
      }
    }
  });

  it('refuses data: on navigational attributes, whatever the MIME type', () => {
    const el = document.createElement('div');
    for (const name of ['href', 'action', 'formaction', 'xlink:href', 'data']) {
      for (const value of ['data:text/html,<script>1</script>', 'DATA:image/png;base64,AAAA', ' data:,x']) {
        setAttribute(el, name, value);
        expect(el.hasAttribute(name), `${name}=${value}`).toBe(false);
      }
    }
  });

  it('allows data: on src/poster/srcset only for image/, audio/ and video/', () => {
    const el = document.createElement('img');
    for (const name of ['src', 'poster', 'srcset']) {
      for (const value of ['data:image/png;base64,AAAA', 'DATA:Image/SVG+xml,<svg/>', 'data:audio/ogg;base64,AA', ' data:\tvideo/mp4;base64,AA']) {
        setAttribute(el, name, value);
        expect(el.getAttribute(name), `${name}=${value}`).toBe(value);
        el.removeAttribute(name);
      }
      for (const value of ['data:text/html,<script>1</script>', 'data:,hi', 'data:application/xhtml+xml,x', 'data:;base64,AAAA', 'data:imagefoo/png,x']) {
        setAttribute(el, name, value);
        expect(el.hasAttribute(name), `${name}=${value}`).toBe(false);
      }
    }
  });

  it('allows http, https, mailto, tel, blob:, relative URLs and custom app schemes', () => {
    const a = document.createElement('a');
    for (const value of [
      'https://example.com', 'http://example.com/?q=javascript:1', 'mailto:a@b.c', 'tel:+123', 'blob:https://x/1', '/path/javascript:x',
      '#frag', 'rel/path', '//cdn.example', 'tg://resolve?domain=x', 'java script:x', 'javascript', '',
    ]) {
      setAttribute(a, 'href', value);
      expect(a.getAttribute('href'), value).toBe(value);
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it('refuses javascript:/vbscript: in SVG animation targets (set/animate to, from, by, values)', () => {
    const svg = 'http://www.w3.org/2000/svg';
    const set = document.createElementNS(svg, 'set');
    for (const name of ['to', 'from', 'by', 'values']) {
      setAttribute(set, name, ' javascript:alert(1)');
      expect(set.hasAttribute(name), name).toBe(false);
    }
    setAttribute(set, 'values', 'a;b;VBScript:x');
    expect(set.hasAttribute('values')).toBe(false);
    setAttribute(set, 'values', 'a;b;c');
    expect(set.getAttribute('values')).toBe('a;b;c');
    setAttribute(set, 'to', '#x');
    expect(set.getAttribute('to')).toBe('#x');
  });

  it('isUnsafeAttribute follows the same policy', () => {
    expect(isUnsafeAttribute('href', 'vbscript:x')).toBe(true);
    expect(isUnsafeAttribute('href', 'data:text/html,x')).toBe(true);
    expect(isUnsafeAttribute('src', 'data:image/png;base64,AA')).toBe(false);
    expect(isUnsafeAttribute('src', 'data:text/html,x')).toBe(true);
    expect(isUnsafeAttribute('to', 'javascript:x')).toBe(true);
  });
});
