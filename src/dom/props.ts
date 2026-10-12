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
import { createMemo, runWithOwner, untrack } from '../index';
import { isUnsafeAttribute, setAttribute, setBoolAttribute, setProp, setProperty } from './attributes';
import { className, classList } from './classes';
import { Aliases, ChildProperties, DelegatedEvents, getPropAlias, Properties, SVG_NS } from './constants';
import { addEvent, delegateEvents, setListener, tupleListener } from './events';
import { insert, insertExpression, normalize } from './insert';
import { getNatives } from './natives';
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

// Prop bags are untrusted: keys are written with a plain assignment (fast) except `__proto__`, which is
// defined as an own data property: on a normal object `bag.__proto__ = v` would reach the prototype.
// (The bags this module makes are null-prototype objects, where either way is safe; `assign` also
// accepts a caller's `prevProps`.) Reads go through own-key checks, never `key in bag`.
function put(bag: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(bag, key, { value, writable: true, enumerable: true, configurable: true });
  else bag[key] = value;
}

function getOwn(bag: Record<string, unknown>, key: string): unknown {
  return isOwnProp(bag, key) ? bag[key] : undefined;
}

/**
 * Compiler primitive: `spread(el, props | [sources], skipChildren, skip, name)`. One render effect
 * reads every prop (compute) and assigns the changed ones (apply); `children`, when not skipped,
 * get their own `insert`, which re-evaluates only when `children` or a function source changes
 * (an identical `children` value is a no-op). Returns the props as last applied.
 *
 * TRUST: the bag chooses the KEYS. A bag can name `innerHTML`, `prop:*` (a raw property write,
 * `prop:srcdoc`, `prop:href`) or `use:<directive>`, all of which are outside the value policy
 * (URLs, string handlers, `srcdoc` are policed; explicit sinks are not). Spread only bags whose
 * keys you control; the policy protects values, not key names.
 */
export function spread(
  node: Element,
  props: PropsSource | PropsSource[],
  skipChildren?: boolean,
  skip?: (key: string) => boolean,
  name?: string,
): Record<string, unknown> {
  const prevProps: Record<string, unknown> = Object.create(null);
  const keys = new Set<string>(); // reused by every pass of the effect below
  const sources: PropsSource[] = Array.isArray(props) ? props : [props];
  // Function sources are called once per pass; the attribute effect and the children slot share the result.
  const resolved = createMemo(() => sources.map(resolveSource));
  // Children first, then the attributes (as in Solid): `<select value>` needs its options to exist.
  if (!skipChildren && !(skip !== undefined && skip('children'))) {
    insert(node, () => childrenOf(resolved()), undefined, undefined, name === undefined ? undefined : { name: `${name}.children` });
  }
  const traits: Traits = traitsOf(node, true);
  createRenderEffect(
    () => collectProps(resolved(), keys, skip),
    (next) => {
      const r = next.ref;
      if (r !== prevProps.ref && (typeof r === 'function' || Array.isArray(r))) ref(() => r, node);
      applyProps(node, next, true, prevProps, true, traits);
    },
    name === undefined ? undefined : { name: `${name}.spread` },
  );
  return prevProps;
}

/**
 * Merge like `mergeProps`: own enumerable string keys only (never prototype properties of untrusted
 * objects), the key order of first appearance, the last DEFINED value wins (a later `undefined` falls
 * through to an earlier source). Values are read from the end, so a getter shadowed by a later
 * defined value is neither called nor tracked.
 */
function collectProps(
  sources: (Record<PropertyKey, any> | null)[],
  keys: Set<string>,
  skip?: (key: string) => boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  if (sources.length === 1) {
    // One source (the usual `{...props}`): its own enumerable keys are the keys, no shadowing to resolve.
    const only = sources[0];
    if (only) {
      for (const key of Object.keys(only)) if (key !== 'children' && !(skip !== undefined && skip(key))) put(out, key, only[key]);
    }
    return out;
  }
  keys.clear();
  for (const s of sources) {
    if (s) for (const key of Object.keys(s)) if (key !== 'children' && !(skip !== undefined && skip(key))) keys.add(key);
  }
  for (const key of keys) {
    let value: unknown;
    for (let i = sources.length - 1; i >= 0; i--) {
      const s = sources[i];
      if (s && isOwnProp(s, key) && (value = s[key]) !== undefined) break;
    }
    put(out, key, value);
  }
  return out;
}

function childrenOf(sources: (Record<PropertyKey, any> | null)[]): unknown {
  for (let i = sources.length - 1; i >= 0; i--) {
    const s = sources[i];
    if (s && isOwnProp(s, 'children')) return s.children;
  }
  return undefined;
}

/** What `applyProps` may assume about `next`/`prevProps` and what it need not re-read from the node. */
interface Traits {
  /** `next` is a `collectProps` bag and `prevProps` a null-prototype bag of `spread`: own keys by `in`, `for…in` visits. */
  fresh: boolean;
  isSVG: boolean;
  /** The tag name has a dash (a custom element). */
  dashed: boolean;
}

const own = (bag: Record<string, unknown>, key: string, fresh: boolean) => (fresh ? key in bag : isOwnProp(bag, key));

/**
 * Compiler/author primitive: write `props` onto `node`, removing props present in `prevProps` but
 * absent now. Same trust rule as `spread`: the bag's keys must be trusted, its values are policed.
 */
export function assign(
  node: Element,
  props: Record<string, unknown> | null | undefined,
  skipChildren?: boolean,
  prevProps: Record<string, unknown> = Object.create(null),
  skipRef = false,
): void {
  applyProps(node, props || {}, skipChildren, prevProps, skipRef, traitsOf(node, false));
}

/** Identity is read through the prototype natives: a <form> with a descendant named `nodeName` or `namespaceURI` is still a plain HTML form. */
function traitsOf(node: Element, fresh: boolean): Traits {
  const { namespaceURI, nodeName } = getNatives();
  return { fresh, isSVG: namespaceURI.call(node) === SVG_NS, dashed: nodeName.call(node).includes('-') };
}

function applyProps(
  node: Element,
  next: Record<string, unknown>,
  skipChildren: boolean | undefined,
  prevProps: Record<string, unknown>,
  skipRef: boolean,
  traits: Traits,
): void {
  const { fresh, isSVG } = traits;
  const isCE = traits.dashed || own(next, 'is', fresh);
  if (fresh) {
    for (const prop in prevProps) dropProp(node, next, prop, prevProps, skipRef, isSVG, isCE, true);
  } else {
    for (const prop of Object.keys(prevProps)) dropProp(node, next, prop, prevProps, skipRef, isSVG, isCE, false);
  }
  // `class` and `className` write the one class channel: in one bag their tokens are combined.
  const bothClasses = own(next, 'class', fresh) && own(next, 'className', fresh);
  if (bothClasses && DEV && !warnedClassPair.has(node)) {
    warnedClassPair.add(node);
    console.error('[frameact] class and className in one props bag: their tokens are combined; use class.');
  }
  if (fresh) {
    for (const prop in next) applyOne(node, next, prop, prevProps, skipChildren, skipRef, isSVG, isCE, bothClasses, true);
  } else {
    for (const prop of Object.keys(next)) applyOne(node, next, prop, prevProps, skipChildren, skipRef, isSVG, isCE, bothClasses, false);
  }
}

function dropProp(
  node: Element,
  next: Record<string, unknown>,
  prop: string,
  prevProps: Record<string, unknown>,
  skipRef: boolean,
  isSVG: boolean,
  isCE: boolean,
  fresh: boolean,
): void {
  if (own(next, prop, fresh) || prop === 'children') return;
  assignProp(node, prop, null, prevProps[prop], isSVG, isCE, skipRef);
  delete prevProps[prop];
}

function applyOne(
  node: Element,
  next: Record<string, unknown>,
  prop: string,
  prevProps: Record<string, unknown>,
  skipChildren: boolean | undefined,
  skipRef: boolean,
  isSVG: boolean,
  isCE: boolean,
  bothClasses: boolean,
  fresh: boolean,
): void {
  if (prop === 'children') {
    if (!skipChildren) insertExpression(node, normalize(next.children, false, false), undefined);
    return;
  }
  if (bothClasses && prop === 'className') {
    put(prevProps, prop, next.className);
    return;
  }
  const value = bothClasses && prop === 'class' ? [next.class, next.className] : next[prop];
  put(prevProps, prop, assignProp(node, prop, value, fresh ? prevProps[prop] : getOwn(prevProps, prop), isSVG, isCE, skipRef));
}

const warnedClassPair = new WeakSet<Element>();

function toPropertyName(name: string): string {
  return name.toLowerCase().replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Is `name` an attribute whose value `setAttribute` polices (a URL, an event handler, `srcdoc`)? */
function isPolicedName(name: string): boolean {
  return isUnsafeAttribute(name, 'javascript:0');
}

const HYPERLINK_TAGS = new Set(['a', 'area']);
const URL_SETTERS = new Set(['protocol', 'host', 'hostname', 'pathname', 'search', 'hash', 'port', 'username', 'password', 'origin']);
const nativePrototypes = new WeakMap<Document, Map<string, object | null>>();

/**
 * The prototype of a freshly made element of the same tag: what the browser itself defines on it.
 * `null` when the probe fails; the caller then treats every name as native (the safe path).
 */
function nativePrototype(node: Element): object | null {
  const { ownerDocument, namespaceURI, localName } = getNatives();
  const doc = ownerDocument.call(node)!;
  const ns = namespaceURI.call(node);
  const local = localName.call(node);
  let byTag = nativePrototypes.get(doc);
  if (!byTag) nativePrototypes.set(doc, (byTag = new Map()));
  const key = `${ns}|${local}`;
  let proto = byTag.get(key);
  if (proto === undefined) {
    try {
      proto = Object.getPrototypeOf(doc.createElementNS(ns, local)) as object;
    } catch {
      proto = null;
    }
    byTag.set(key, proto);
  }
  return proto;
}

/**
 * `is` (or a dashed tag) makes unknown props properties: `some-prop` → `someProp`, camelCase as written.
 * The policy is applied to the FINAL property name, after that conversion. Only an autonomous custom
 * element (`my-el`) owns its setters; on a built-in element (`<a is=…>`, `<button is=…>`) a policed
 * name (URL, handler, `srcdoc`, including `form-action` → `formAction`) is written as an attribute
 * through `setAttribute`, whose policy then applies; so is any name the native element already has
 * (`protocol`, …), and URL-component setters are refused on hyperlinks. `outerHTML` is never written, and `innerHTML`
 * only by its exact name (the known-property path), never through the dash conversion.
 */
function assignCustomProp(node: Element, prop: string, value: unknown): void {
  const name = prop.includes('-') ? toPropertyName(prop) : prop;
  if (name === 'outerHTML' || name === 'innerHTML') {
    if (DEV) console.error(`[frameact] ${prop}= is an HTML sink and is not written as a custom-element property.`);
    return;
  }
  const { nodeName, localName } = getNatives();
  if (!nodeName.call(node).includes('-')) {
    // A customized built-in: URL-component setters rewrite `href` behind the policy's back
    // (`href="x:…"` + `protocol="javascript"`), so they are refused outright on hyperlinks...
    const local = localName.call(node);
    if (HYPERLINK_TAGS.has(local) && URL_SETTERS.has(name)) {
      if (DEV) console.error(`[frameact] ${prop}= is a URL setter and is not written on <${local} is>; set href instead.`);
      return;
    }
    // ...and any name the native element already has (reflecting or not) takes the normal path, the
    // attribute with its policy. Only names the built-in does not know are custom properties.
    const native = nativePrototype(node);
    if (isPolicedName(name) || isPolicedName(prop) || native === null || name in native) {
      const attribute = isPolicedName(name) || !isPolicedName(prop) ? name : prop;
      return setAttribute(node, Aliases[attribute] || attribute, value);
    }
  }
  setProp(node, name, value);
}

// A NUL cannot occur in an event name written in a template, so this slot never collides with `on:<name>`.
const SPREAD_SLOT = '\u0000s:';

function assignProp(
  node: Element,
  prop: string,
  value: unknown,
  prev: unknown,
  isSVG: boolean,
  isCE: boolean,
  skipRef: boolean,
): unknown {
  // An identical value is already applied: `style` and `class` need no pass (their diff against
  // `prev` would be empty), and neither does anything else below.
  if (value === prev) return prev;
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
        // A refused value (a string, say) must not leave the previous handler behind.
        if (typeof value !== 'function') addEvent(node, event, null, true);
        addEvent(node, event, value, true);
        delegateEvents([event], getNatives().ownerDocument.call(node)!);
      } else {
        // setListener owns the bookkeeping (options of a handleEvent object, capture on removal); the
        // spread has its own slot, so an explicit `on:<event>` on the same element is independent.
        setListener(node, event, Array.isArray(value) ? (tupleListener(node, value) ?? value) : value, false, SPREAD_SLOT);
      }
      return value;
    }
  }
  const propAlias = isSVG ? undefined : getPropAlias(prop, getNatives().nodeName.call(node));
  const known = ChildProperties.has(prop) || Properties.has(prop) || propAlias !== undefined;
  if (ChildProperties.has(prop) || (!isSVG && known) || isCE) {
    if (isCE && !known) assignCustomProp(node, prop, value);
    else if ((propAlias ?? prop) === 'value' || (propAlias ?? prop) === 'defaultValue') {
      // setProperty: '' for null on INPUT/TEXTAREA, and a <select> value is re-applied in a microtask
      // when its options are inserted later in the same turn.
      setProperty(node, propAlias ?? prop, value);
    } else setProp(node, propAlias ?? prop, value);
    return value;
  }
  setAttribute(node, Aliases[prop] || prop, value);
  return value;
}
