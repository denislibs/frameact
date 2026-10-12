// Adapted from solidjs/solid `mergeProps` (packages/solid/src/render/component.ts)
// (MIT, © 2016-2025 Ryan Carniato) — https://github.com/solidjs/solid
//
// Notes for consumers (spread/assign, Task 9):
// - Keys are OWN, enumerable, string and symbol; inherited keys are never props.
//   Class-prototype getters and non-enumerable own keys are not props either (own-keys contract),
//   in the plain and in the Proxy branch alike.
// - A source's own `__proto__` key passes through as a plain own property (defined, never assigned):
//   copy keys with defineProperty / object spread, never with `target[key] = value`.
// - The Proxy branch re-resolves every function source on each trap (O(keys x sources) per
//   Object.keys + descriptor sweep); keep sweeps rare in hot paths.

import { DEV } from '../env';
import { createRenderEffect } from '../core/frame';
import { runWithOwner, untrack } from '../index';
import { isUnsafeAttribute, setAttribute, setBoolAttribute } from './attributes';
import { className, classList } from './classes';
import { Aliases, ChildProperties, DelegatedEvents, getPropAlias, Properties, SVG_NS } from './constants';
import { addEvent, delegateEvents, setListener } from './events';
import { insert, insertExpression, normalize } from './insert';
import { style } from './styles';

export type PropsSource =
  | Record<PropertyKey, any>
  | (() => Record<PropertyKey, any> | null | undefined | false)
  | null
  | undefined
  | false;

/** A function source is resolved on every access (its key set may change). */
export function resolveSource(source: PropsSource): Record<PropertyKey, any> | null {
  const resolved = typeof source === 'function' ? source() : source;
  return resolved || null;
}

/** Own AND enumerable: the one membership test for props (inherited and hidden keys are not props). */
const isOwnProp = (o: object, key: PropertyKey) => Object.prototype.propertyIsEnumerable.call(o, key);

function getFrom(sources: PropsSource[], key: PropertyKey): unknown {
  for (let i = sources.length - 1; i >= 0; i--) {
    const s = resolveSource(sources[i]);
    if (s && isOwnProp(s, key)) {
      const v = s[key];
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

function hasIn(sources: PropsSource[], key: PropertyKey): boolean {
  for (let i = sources.length - 1; i >= 0; i--) {
    const s = resolveSource(sources[i]);
    if (s && isOwnProp(s, key)) return true;
  }
  return false;
}

/** Own enumerable keys, strings and symbols alike. */
function keysOf(sources: PropsSource[]): (string | symbol)[] {
  const keys = new Set<string | symbol>();
  for (const source of sources) {
    const s = resolveSource(source);
    if (s) for (const key of Reflect.ownKeys(s)) if (isOwnProp(s, key)) keys.add(key);
  }
  return [...keys];
}

/**
 * Compiler primitive: merge props objects right-to-left (later wins, `undefined` falls through to an
 * earlier source), keeping getters lazy. With a function source the result is a Proxy whose key set
 * follows the source; otherwise a plain object of getters.
 */
export function mergeProps(...sources: PropsSource[]): any {
  if (sources.some((s) => typeof s === 'function')) {
    return new Proxy({} as Record<PropertyKey, unknown>, {
      get: (_target, key) => getFrom(sources, key),
      has: (_target, key) => hasIn(sources, key),
      ownKeys: () => keysOf(sources),
      getOwnPropertyDescriptor: (_target, key) =>
        hasIn(sources, key)
          ? { configurable: true, enumerable: true, get: () => getFrom(sources, key) }
          : undefined,
    });
  }
  const target: Record<PropertyKey, unknown> = {};
  for (const key of keysOf(sources)) {
    Object.defineProperty(target, key, { configurable: true, enumerable: true, get: () => getFrom(sources, key) });
  }
  return target;
}

/** Compiler primitive: frameact has no store proxies, so a shallow read is the value itself. */
export function readShallow<T>(value: T): T {
  return value;
}

/** Compiler primitive: a ref is a function or a (nested) array of functions; anything else is ignored. */
export function applyRef(r: unknown, element: Element): void {
  if (Array.isArray(r)) {
    for (const f of (r as unknown[]).flat(Infinity)) if (typeof f === 'function') f(element);
  } else if (typeof r === 'function') r(element);
}

/** Compiler primitive: `ref(() => expr, el)`. Refs own nothing — the callback runs with no owner. */
export function ref(fn: () => unknown, element: Element): void {
  const resolved = untrack(fn);
  runWithOwner(null, () => applyRef(resolved, element));
}

// Prop bags are untrusted: keys are copied with defineProperty and read through own-key checks, never
// with `bag[key] = value` / `bag[key]` / `key in bag` (a `__proto__` key would reach the prototype).
function put(bag: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(bag, key, { value, writable: true, enumerable: true, configurable: true });
}

function getOwn(bag: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : undefined;
}

function hasOwnKey(bag: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(bag, key);
}

/**
 * Compiler primitive: `spread(el, props | [sources], skipChildren, skip, name)`. One render effect
 * reads every prop (compute) and assigns the changed ones (apply); `children`, when not skipped,
 * get their own `insert` so an attribute change never rebuilds the subtree. Returns the props as
 * last applied.
 */
export function spread(
  node: Element,
  props: PropsSource | PropsSource[],
  skipChildren?: boolean,
  skip?: (key: string) => boolean,
  name?: string,
): Record<string, unknown> {
  const prevProps: Record<string, unknown> = {};
  const sources: PropsSource[] = Array.isArray(props) ? props : [props];
  createRenderEffect(
    () => collectProps(sources, skip),
    (next) => {
      const r = next.ref;
      if (r !== getOwn(prevProps, 'ref') && (typeof r === 'function' || Array.isArray(r))) ref(() => r, node);
      assign(node, next, true, prevProps, true);
    },
    name === undefined ? undefined : { name: `${name}.spread` },
  );
  if (!skipChildren && !(skip !== undefined && skip('children'))) {
    insert(node, () => childrenOf(sources), undefined, undefined, name === undefined ? undefined : { name: `${name}.children` });
  }
  return prevProps;
}

/** Own enumerable string keys only (never prototype properties of untrusted objects); later sources win. */
function collectProps(sources: PropsSource[], skip?: (key: string) => boolean): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  for (let i = 0; i < sources.length; i++) {
    const s = resolveSource(sources[i]);
    if (!s) continue;
    for (const key of Object.keys(s)) {
      if (key === 'children' || (skip !== undefined && skip(key))) continue;
      put(out, key, s[key]);
    }
  }
  return out;
}

function childrenOf(sources: PropsSource[]): unknown {
  for (let i = sources.length - 1; i >= 0; i--) {
    const s = resolveSource(sources[i]);
    if (s && isOwnProp(s, 'children')) return s.children;
  }
  return undefined;
}

/** Compiler/author primitive: write `props` onto `node`, removing props present in `prevProps` but absent now. */
export function assign(
  node: Element,
  props: Record<string, unknown> | null | undefined,
  skipChildren?: boolean,
  prevProps: Record<string, unknown> = {},
  skipRef = false,
): void {
  const next = props || {};
  const isSVG = node.namespaceURI === SVG_NS;
  const isCE = node.nodeName.includes('-') || hasOwnKey(next, 'is');
  for (const prop of Object.keys(prevProps)) {
    if (hasOwnKey(next, prop) || prop === 'children') continue;
    assignProp(node, prop, null, prevProps[prop], isSVG, isCE, skipRef);
    delete prevProps[prop];
  }
  for (const prop of Object.keys(next)) {
    if (prop === 'children') {
      if (!skipChildren) insertExpression(node, normalize(next.children, false, false), undefined);
      continue;
    }
    put(prevProps, prop, assignProp(node, prop, next[prop], getOwn(prevProps, prop), isSVG, isCE, skipRef));
  }
}

function toPropertyName(name: string): string {
  return name.toLowerCase().replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Is `name` an attribute whose value `setAttribute` polices (a URL, an event handler, `srcdoc`)? */
function isPolicedName(name: string): boolean {
  return isUnsafeAttribute(name, 'javascript:0');
}

/** `el[name] = value` for names that come from an untrusted bag: never the prototype. */
function setProp(node: Element, name: string, value: unknown): void {
  if (name === '__proto__') {
    if (DEV) console.error('[frameact] a property named __proto__ is not written onto an element.');
    return;
  }
  (node as unknown as Record<string, unknown>)[name] = value;
}

// Non-delegated `onX` listeners a spread attached, per element and event: replaced or removed on change.
const spreadListeners = new WeakMap<Element, Map<string, EventListener | EventListenerObject>>();

function setSpreadListener(node: Element, event: string, handler: unknown): void {
  let map = spreadListeners.get(node);
  const prev = map?.get(event);
  if (prev) {
    node.removeEventListener(event, prev);
    map!.delete(event);
  }
  let listener: EventListener | EventListenerObject | undefined;
  if (typeof handler === 'function') listener = handler as EventListener;
  else if (Array.isArray(handler)) {
    const [fn, data] = handler as [unknown, unknown];
    if (typeof fn === 'function') listener = (e: Event) => (fn as (data: unknown, e: Event) => void).call(node, data, e);
  } else if (typeof handler === 'object' && handler !== null && typeof (handler as EventListenerObject).handleEvent === 'function') {
    listener = handler as EventListenerObject;
  }
  if (!listener) {
    if (handler != null && handler !== false && DEV) {
      console.error(`[frameact] onX=: the handler for "${event}" must be a function, a [fn, data] tuple or an object with handleEvent; got`, handler);
    }
    return;
  }
  if (!map) spreadListeners.set(node, (map = new Map()));
  map.set(event, listener);
  node.addEventListener(event, listener);
}

/**
 * `is` (or a dashed tag) makes unknown props properties: `some-prop` → `someProp`, camelCase as written.
 * The policy is applied to the FINAL property name, after that conversion. Only an autonomous custom
 * element (`my-el`) owns its setters; on a built-in element (`<a is=…>`, `<button is=…>`) a policed
 * name (URL, handler, `srcdoc`, including `form-action` → `formAction`) is written as an attribute
 * through `setAttribute`, whose policy then applies. `outerHTML` is never written, and `innerHTML`
 * only by its exact name (the known-property path), never through the dash conversion.
 */
function assignCustomProp(node: Element, prop: string, value: unknown): void {
  const name = prop.includes('-') ? toPropertyName(prop) : prop;
  if (name === 'outerHTML' || name === 'innerHTML') {
    if (DEV) console.error(`[frameact] ${prop}= is an HTML sink and is not written as a custom-element property.`);
    return;
  }
  if (!node.nodeName.includes('-')) {
    if (isPolicedName(name)) return setAttribute(node, name, value);
    if (isPolicedName(prop)) return setAttribute(node, prop, value);
  }
  setProp(node, name, value);
}

function assignProp(
  node: Element,
  prop: string,
  value: unknown,
  prev: unknown,
  isSVG: boolean,
  isCE: boolean,
  skipRef: boolean,
): unknown {
  // `style` (an applied-string/object memo on the element) and `class` (applied token set) are
  // idempotent: they run on every pass so unrelated updates leave imperative styles/classes alone.
  if (prop === 'style') {
    style(node, value, prev);
    return value;
  }
  if (prop === 'class' || prop === 'className') {
    className(node, value, prev);
    return value;
  }
  if (prop === 'classList') {
    classList(node, value);
    return value;
  }
  if (value === prev) return prev;
  if (prop === 'ref') {
    if (!skipRef && value) ref(() => value, node);
    return value;
  }
  if (prop.indexOf(':') > -1) {
    if (prop.startsWith('on:')) setListener(node, prop.slice(3), value, false);
    else if (prop.startsWith('oncapture:')) setListener(node, prop.slice(10), value, true);
    else if (prop.startsWith('bool:')) setBoolAttribute(node, prop.slice(5), value);
    else if (prop.startsWith('prop:')) setProp(node, prop.slice(5), value);
    // use: (the directive registry), attr:, class:, style:, xlink:/xml:: all dispatch inside setAttribute
    else setAttribute(node, prop, value);
    return value;
  }
  // `on` + an uppercase letter is an event; a lowercase `onclick` is an attribute (setAttribute refuses strings).
  if (prop.length > 2 && prop.startsWith('on')) {
    const c = prop.charCodeAt(2);
    if (c > 64 && c < 91) {
      const event = prop.slice(2).toLowerCase();
      if (DelegatedEvents.has(event)) {
        addEvent(node, event, value, true);
        delegateEvents([event], node.ownerDocument);
      } else setSpreadListener(node, event, value);
      return value;
    }
  }
  const propAlias = isSVG ? undefined : getPropAlias(prop, node.tagName);
  const known = ChildProperties.has(prop) || Properties.has(prop) || propAlias !== undefined;
  if (ChildProperties.has(prop) || (!isSVG && known) || isCE) {
    if (isCE && !known) assignCustomProp(node, prop, value);
    else if ((propAlias ?? prop) === 'value' || (propAlias ?? prop) === 'defaultValue') {
      setProp(node, propAlias ?? prop, node.nodeName === 'INPUT' || node.nodeName === 'TEXTAREA' ? (value ?? '') : value);
    } else setProp(node, propAlias ?? prop, value);
    return value;
  }
  setAttribute(node, Aliases[prop] || prop, value);
  return value;
}
