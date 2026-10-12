// Adapted from solidjs/solid packages/web/src/client.ts and dom-expressions client.js (MIT, © Ryan Carniato).
// frameact: the 2.0 compiler lowers every namespaced attribute to `setAttribute(el, name, value)`,
// so this is the dispatcher for `use:`, `class:`, `style:`, `on:`, `oncapture:`, `attr:`, `bool:`,
// `prop:`, `xlink:` and for `class`/`classList`/`className`. `class` and `classList` stay independent
// channels over one token list: a token that both apply is removed as soon as either drops it.
import { DEV } from '../env';
import { className, classList, toggleClassToken } from './classes';
import { SVGNamespace } from './constants';
import { runDirective } from './directives';
import { setListener } from './events';
import { setStyleProperty } from './styles';

// URL policy. Every attribute below holds a URL the browser may navigate to or load.
//   - `javascript:` and `vbscript:` are refused everywhere.
//   - `data:` is refused on the navigational attributes (it opens a document); on the loading
//     attributes in NON_NAVIGATIONAL it is allowed for image/, audio/ and video/ MIME types only.
//   - Everything else (http, https, mailto, tel, blob, relative, custom app schemes like `tg:`) is allowed.
// Not covered, because the compiler emits direct property writes the runtime never sees: `prop:href`,
// `<a href={…}>` compiled to `el.href = …` where the compiler chooses a property, and `setProperty`.
// Also not covered: `data:image/svg+xml` in `<iframe src>`/`<embed src>` (an opaque origin, no access
// to the app); do not feed untrusted values to those elements.
const URL_ATTRIBUTES = new Set([
  'href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'srcset', 'data', 'background', 'codebase',
  'manifest', 'longdesc', 'cite', 'ping',
]);
const NON_NAVIGATIONAL = new Set(['src', 'poster', 'srcset']);
// SVG animation (`<set attributeName="href" to="javascript:…">`): the value attributes are checked always.
const ANIMATION_VALUES = new Set(['to', 'from', 'by', 'values']);
const LOWERCASE_EVENT = /^on[a-z]+$/;
const MEDIA_MIME = /^(?:image|audio|video)\//;

function isSchemeChar(c: number): boolean {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 43 || c === 45 || c === 46;
}

/**
 * The URL's scheme, lowercased, as the URL parser sees it: leading C0 controls and spaces are
 * skipped, tab/newline/other C0 are ignored anywhere. `''` when there is no scheme. `end` is the
 * index after the colon.
 */
function urlScheme(value: string): { scheme: string; end: number } {
  const n = value.length;
  let i = 0;
  while (i < n && value.charCodeAt(i) <= 32) i++;
  let scheme = '';
  for (; i < n; i++) {
    const c = value.charCodeAt(i);
    if (c < 32) continue;
    if (c === 58) return { scheme, end: i + 1 };
    if (scheme.length >= 16 || !isSchemeChar(c)) break;
    scheme += value[i].toLowerCase();
  }
  return { scheme: '', end: 0 };
}

/** The MIME type of a `data:` URL (`end` = index after `data:`), lowercased; `''` when absent. */
function dataMime(value: string, end: number): string {
  let mime = '';
  for (let i = end; i < value.length && mime.length < 128; i++) {
    const c = value.charCodeAt(i);
    if (c < 32) continue;
    if (c === 44 || c === 59) break; // , or ;
    mime += value[i];
  }
  return mime.trim().toLowerCase();
}

function isUnsafeUrl(value: string, lowerName: string): boolean {
  const { scheme, end } = urlScheme(value);
  if (scheme === 'javascript' || scheme === 'vbscript') return true;
  if (scheme === 'data') return !(NON_NAVIGATIONAL.has(lowerName) && MEDIA_MIME.test(dataMime(value, end)));
  return false;
}

function isUnsafeAnimationValue(value: string): boolean {
  for (const part of value.split(';')) {
    const { scheme } = urlScheme(part);
    if (scheme === 'javascript' || scheme === 'vbscript') return true;
  }
  return false;
}

function camelEvent(name: string): string {
  return `on${name.slice(2, 3).toUpperCase()}${name.slice(3)}`;
}

/** Why an attribute write is refused (`null`: it is allowed). `value` is a string for non-handler attributes. */
type Refusal = 'handler-string' | 'handler-function' | 'handler-value' | 'url' | 'srcdoc';

function refusal(name: string, value: unknown): Refusal | null {
  // HTML attribute names are case-insensitive (`ONCLICK`, `formAction`): decide on the lowercase name.
  const lower = name.toLowerCase();
  if (LOWERCASE_EVENT.test(lower)) {
    if (value == null || value === false) return null; // removal
    if (typeof value === 'string') return 'handler-string';
    if (typeof value === 'function') return 'handler-function';
    return 'handler-value'; // numbers, true, …: anything that would be stringified into the attribute
  }
  if (lower === 'srcdoc') return value == null || value === false ? null : 'srcdoc'; // an HTML sink, like innerHTML
  if (typeof value !== 'string') return null;
  if (URL_ATTRIBUTES.has(lower) ? isUnsafeUrl(value, lower) : ANIMATION_VALUES.has(lower) && isUnsafeAnimationValue(value)) return 'url';
  return null;
}

/**
 * Is writing `value` into the attribute `name` refused (string event handlers, `javascript:` URLs)?
 * Shared with spreads. The value is stringified here for the URL check: pass the string you checked
 * to the write (`setAttribute` does), a second `String(value)` could answer differently.
 */
export function isUnsafeAttribute(name: string, value: unknown): boolean {
  return refusal(name, stringifyObject(value)) !== null;
}

/** Objects (URL, String, anything with toString) are what the DOM would stringify: decide on that string. */
function stringifyObject(value: unknown): unknown {
  return typeof value === 'object' && value !== null ? String(value) : value;
}

function report(name: string, value: unknown, reason: Refusal): void {
  if (!DEV) return;
  if (reason === 'url') console.error(`[frameact] refused an unsafe URL in ${name}=`, value);
  else if (reason === 'srcdoc') {
    console.error(`[frameact] ${name}= is an HTML sink and is not written through attributes. Opt in explicitly with prop:srcdoc={html} (trusted HTML only).`);
  }
  else if (reason === 'handler-function') {
    console.warn(`[frameact] ${name}={fn}: a lowercase event attribute attaches nothing. Use ${camelEvent(name.toLowerCase())}={fn}.`);
  } else {
    console.error(`[frameact] ${name}="…": string event handlers are an inline-script sink. Use ${camelEvent(name.toLowerCase())}={fn}.`);
  }
}

/** Compiler primitive. */
export function setAttribute(node: Element, name: string, value: unknown): void {
  if (name.indexOf(':') > -1) {
    if (name.startsWith('use:')) return runDirective(node, name.slice(4), value);
    if (name.startsWith('class:')) return toggleClassToken(node, name.slice(6), !!value);
    if (name.startsWith('style:')) return setStyleProperty(node, name.slice(6), value);
    if (name.startsWith('on:')) return setListener(node, name.slice(3), value, false);
    if (name.startsWith('oncapture:')) return setListener(node, name.slice(10), value, true);
    if (name.startsWith('bool:')) return setBoolAttribute(node, name.slice(5), value);
    if (name.startsWith('prop:')) {
      (node as unknown as Record<string, unknown>)[name.slice(5)] = value;
      return;
    }
    if (name.startsWith('attr:')) name = name.slice(5);
    else {
      const ns = SVGNamespace[name.split(':')[0]];
      if (ns) return setAttributeNS(node, ns, name, value);
    }
  } else if (name === 'class') return className(node, value);
  else if (name === 'classList') return classList(node, value);
  else if (name === 'className') {
    if (DEV) console.error('[frameact] className= on an element: use class= (className bypasses the token diff).');
    return className(node, value);
  }
  // Every path that ends in an attribute write (bare names and `attr:`) is checked here.
  if (value == null || value === false) {
    node.removeAttribute(name);
    return;
  }
  value = stringifyObject(value); // stringified once: what is checked is what is written
  const text = value === true ? '' : String(value);
  const reason = refusal(name, value);
  if (reason) {
    report(name, value, reason);
    node.removeAttribute(name);
  } else node.setAttribute(name, text);
}

/** Compiler primitive (`xlink:href`, `xml:lang`). */
export function setAttributeNS(node: Element, namespace: string, name: string, value: unknown): void {
  const local = name.indexOf(':') > -1 ? name.slice(name.indexOf(':') + 1) : name;
  if (value == null || value === false) {
    node.removeAttributeNS(namespace, local);
    return;
  }
  value = stringifyObject(value);
  const text = value === true ? '' : String(value);
  const reason = refusal(name, value);
  if (reason) {
    report(name, value, reason);
    node.removeAttributeNS(namespace, local);
  } else node.setAttributeNS(namespace, name, text);
}

/** `bool:name=` and spread booleans. */
export function setBoolAttribute(node: Element, name: string, value: unknown): void {
  if (value) node.setAttribute(name, '');
  else node.removeAttribute(name);
}

/**
 * Compiler primitive for property writes it cannot inline (e.g. `<select value>`). Property writes
 * (this, `prop:x`, compiler-inlined `el.href = …`) bypass the attribute checks above: do not feed them
 * untrusted URLs or HTML.
 */
export function setProperty(node: Element, name: string, value: unknown): void {
  const el = node as unknown as Record<string, unknown>;
  const tag = node.nodeName;
  if ((name === 'value' || name === 'defaultValue') && (tag === 'INPUT' || tag === 'TEXTAREA')) {
    el[name] = value ?? '';
  } else if (name === 'value' && tag === 'SELECT') {
    el.value = value;
    // Options inserted later in the same turn: reapply once they exist.
    if (value != null && el.value !== String(value)) {
      queueMicrotask(() => {
        el.value = value;
      });
    }
  } else el[name] = value;
}
