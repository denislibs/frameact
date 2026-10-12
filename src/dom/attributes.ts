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

const URL_ATTRIBUTES = new Set(['href', 'src', 'action', 'formaction', 'xlink:href']);
const LOWERCASE_EVENT = /^on[a-z]+$/;
// oxlint-disable-next-line no-control-regex -- the URL parser ignores C0 controls, so we must strip them
const CONTROL_CHARS = /[\u0000-\u001F]/g;

/** `javascript:` URLs — after stripping the control characters the URL parser ignores — are refused. */
function isUnsafeUrl(value: string): boolean {
  return value.replace(CONTROL_CHARS, '').trimStart().toLowerCase().startsWith('javascript:');
}

function camelEvent(name: string): string {
  return `on${name.slice(2, 3).toUpperCase()}${name.slice(3)}`;
}

/** Why an attribute write is refused (`null`: it is allowed). `value` is a string for non-handler attributes. */
type Refusal = 'handler-string' | 'handler-function' | 'handler-value' | 'url';

function refusal(name: string, value: unknown): Refusal | null {
  // HTML attribute names are case-insensitive (`ONCLICK`, `formAction`): decide on the lowercase name.
  const lower = name.toLowerCase();
  if (LOWERCASE_EVENT.test(lower)) {
    if (value == null || value === false) return null; // removal
    if (typeof value === 'string') return 'handler-string';
    if (typeof value === 'function') return 'handler-function';
    return 'handler-value'; // numbers, true, …: anything that would be stringified into the attribute
  }
  if (URL_ATTRIBUTES.has(lower) && typeof value === 'string' && isUnsafeUrl(value)) return 'url';
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

/** Compiler primitive for property writes it cannot inline (e.g. `<select value>`). */
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
