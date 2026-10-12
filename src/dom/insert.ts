// Adapted from solidjs/solid packages/web/src/client.ts (MIT, © 2016-2025 Ryan Carniato) and
// dom-expressions packages/dom-expressions/src/client.js (MIT, © 2017 Ryan Carniato).
// frameact: `insert` is a two-phase render effect — compute = normalize (pure; creates subtrees on
// detached DOM), apply = insertExpression (the DOM write: synchronous at creation, mutate phase later).
import { DEV } from '../env';
import { createRenderEffect } from '../core/frame';
import type { EffectOptions } from '../core/effects';
import { getNatives } from './natives';
import { manualOrderOf, ownedBy, reconcileArrays, reconcileManual, tagManualOrder, tagSlot } from './reconcile';

// No `Document`: lib.dom types its `textContent` as a read-only `null`, and mounting into a Document is meaningless anyway.
export type MountableElement = Element | ShadowRoot | DocumentFragment;

export interface InsertOptions {
  /** Portal: the slot's logical host. Inserted top-level nodes are registered for event retargeting (`portalHostOf`). */
  host?: () => Node | null;
  /** Dev label from the compiler's sourceNames (`div.children`). */
  name?: string;
}

/** Returned by the outer insert compute when a nested effect owns the slot (its apply then does nothing). */
const INNER_OWNED: unique symbol = Symbol('frameact.innerOwned');
/** Text nodes created by this module. Only these are reused as positional text slots; a Text node handed in by the user is a plain node. */
const ownText = new WeakSet<Text>();

function createOwnText(data: string): Text {
  const node = document.createTextNode(data);
  ownText.add(node);
  return node;
}

/**
 * Resolve nested accessors and arrays. Functions with parameters (row mappers) are values, not
 * accessors. `doNotUnwrap`: keep a top-level function (and any function inside an array — the
 * array then resolves to a wrapper function) so the caller can give it its own effect.
 */
export function flatten(children: any, skipNonRendered: boolean, doNotUnwrap: boolean): any {
  if (typeof children === 'function' && !children.length) {
    if (doNotUnwrap) return children;
    do children = children();
    while (typeof children === 'function' && !children.length);
  }
  if (skipNonRendered && (children == null || children === true || children === false || children === '')) {
    return undefined;
  }
  if (Array.isArray(children)) {
    const results: any[] = [];
    // The copy keeps the manual-order tag (`For order="manual"`); a For nested inside a larger array
    // is flattened into it and loses the tag: it then falls back to the ordinary reconcile.
    const manual = manualOrderOf(children);
    if (manual) tagManualOrder(results, manual);
    if (flattenArray(children, results, skipNonRendered, doNotUnwrap)) {
      return () => {
        const nested: any[] = [];
        flattenArray(results, nested, skipNonRendered, false);
        return nested;
      };
    }
    return results;
  }
  return children;
}

let warnedNestedManual = false;

function flattenArray(children: any[], results: any[], skipNonRendered: boolean, doNotUnwrap: boolean): boolean {
  let needsUnwrap = false;
  for (let i = 0; i < children.length; i++) {
    let child = children[i];
    if (typeof child === 'function' && !child.length) {
      if (doNotUnwrap) {
        results.push(child);
        needsUnwrap = true;
        continue;
      }
      do child = child();
      while (typeof child === 'function' && !child.length);
    }
    if (Array.isArray(child)) {
      if (DEV && !warnedNestedManual && manualOrderOf(child)) {
        warnedNestedManual = true;
        console.warn('[frameact] <For order="manual"> nested in a larger array loses its manual order (it needs its own slot); the ordinary diff is used');
      }
      needsUnwrap = flattenArray(child, results, skipNonRendered, doNotUnwrap) || needsUnwrap;
    } else if (skipNonRendered && (child == null || child === true || child === false || child === '')) {
      // not rendered
    } else results.push(child);
  }
  return needsUnwrap;
}

/** Compute-half value shape: primitives stay raw (text nodes are materialised in the apply, reusing positional ones). */
export function normalize(value: any, multi: boolean, doNotUnwrap: boolean): any {
  value = flatten(value, true, doNotUnwrap);
  // Only a zero-parameter function is an accessor that gets its own effect. A function with parameters
  // (a row mapper) is a value: it falls through to insertExpression, which renders it as nothing.
  if (doNotUnwrap && typeof value === 'function' && !value.length) return value;
  if (multi && !Array.isArray(value)) value = [value != null ? value : ''];
  return value;
}

/**
 * Compiler primitive. `marker === undefined`: the hole is the element's only content (root mode:
 * textContent fast path). `marker` a node or `null`: multi mode, content lives before the marker
 * (`null` = at the end).
 */
export function insert(
  parent: MountableElement,
  accessor: unknown,
  marker?: Node | null,
  initial?: unknown,
  options?: InsertOptions,
): void {
  const multi = marker !== undefined;
  const host = options?.host && { parent, host: options.host };
  if (multi && !initial) initial = [];
  if (typeof accessor !== 'function' || (accessor as (...args: unknown[]) => unknown).length) {
    const value = normalize(accessor, multi, true);
    if (typeof value !== 'function' || value.length) {
      const inserted = insertExpression(parent, value, initial, marker);
      if (host) tagHost(inserted, host);
      return;
    }
    accessor = value;
  }
  if (multi && (initial as unknown[]).length === 0) {
    const placeholder = createOwnText('');
    parent.insertBefore(placeholder, marker ?? null);
    initial = [placeholder];
  }
  let current: any = initial;
  const effectOptions: EffectOptions | undefined = options?.name === undefined ? undefined : { name: options.name };
  const read = accessor as () => unknown;
  createRenderEffect<any>(
    () => {
      const value = normalize(read(), multi, true);
      if (typeof value !== 'function') return value;
      // A function value (a For's row accessor, a memo, a fragment holding one) gets its own effect:
      // the outer tracks only what produced the function. Owned by this compute → disposed when the
      // outer recomputes.
      createRenderEffect<any>(
        () => normalize(value, multi, false),
        (inner) => {
          current = insertExpression(parent, inner, current, marker);
          if (host) tagHost(current, host);
        },
        effectOptions,
      );
      return INNER_OWNED;
    },
    (value) => {
      if (value === INNER_OWNED) return;
      current = insertExpression(parent, value, current, marker);
      if (host) tagHost(current, host);
    },
    effectOptions,
  );
}

/**
 * Apply half: write `value` into the slot described by `current`, return the new `current`.
 * Note: when `value` is an array it is mutated in place (primitives and non-renderables are replaced
 * by text nodes). `insert` always passes a fresh copy (see `flatten`); direct callers must too.
 */
export function insertExpression(parent: MountableElement, value: any, current: any, marker?: Node | null): any {
  if (value === current) return value;
  const t = typeof value;
  const multi = marker !== undefined;

  if (t === 'string' || t === 'number') {
    const text = String(value);
    if (multi) {
      // Direct callers only: insert() wraps primitives into an array in multi mode.
      let node = Array.isArray(current) ? current[0] : undefined;
      if (node && ownText.has(node)) {
        if (node.data !== text) node.data = text;
      } else node = createOwnText(text);
      return cleanChildren(parent, current, marker, node);
    }
    const tc = typeof current;
    const first = parent.firstChild;
    if ((tc === 'string' || tc === 'number') && current !== '' && first && first.nodeType === 3) {
      (first as Text).data = text;
    } else parent.textContent = text;
    return value;
  }
  if (value == null || t === 'boolean') return cleanChildren(parent, current, marker);
  if (t === 'function') {
    if (value.length) {
      // Same as an array item: a row mapper is not renderable. Renders as nothing, old content cleared.
      if (DEV) console.warn('[frameact] Unrecognized child value. Rendered as nothing', value);
      return cleanChildren(parent, current, marker);
    }
    if (DEV) console.error('[frameact] insertExpression: unexpected function value (normalize first)', value);
    return current;
  }
  if (Array.isArray(value)) {
    const currentArray = Array.isArray(current);
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const ti = typeof item;
      if (ti === 'string' || ti === 'number') {
        const text = String(item);
        const prev = currentArray ? current[i] : undefined;
        if (prev && ownText.has(prev)) {
          if (prev.data !== text) prev.data = text;
          value[i] = prev;
        } else value[i] = createOwnText(text);
      } else if (item == null || !item.nodeType) {
        // Not renderable: a function with parameters (a row mapper is a value, not an accessor), a plain
        // object, a stray null. Placing it into the DOM would throw `insertBefore: not of type Node`, so it
        // renders as nothing (Solid 2.0's client.ts has no such guard and throws).
        if (DEV) console.warn('[frameact] Unrecognized child value. Rendered as nothing', item);
        value[i] = createOwnText('');
      }
    }
    if (value.length === 0) {
      cleanChildren(parent, current, marker);
    } else if (currentArray) {
      if (current.length === 0) appendNodes(parent, value, marker ?? null);
      else {
        const manual = manualOrderOf(value);
        if (manual) reconcileManual(parent, current, value, marker, manual);
        else reconcileArrays(parent, current, value, marker);
      }
    } else {
      if (current != null && current !== '') {
        if (!multi) parent.textContent = '';
        else if (current.nodeType && current.parentNode === parent) current.remove();
      }
      appendNodes(parent, value, marker ?? null);
    }
    return value;
  }
  if (value.nodeType) {
    if (Array.isArray(current)) {
      cleanChildren(parent, current, multi ? marker : null, value);
    } else if (current != null && current.nodeType) {
      if (current.parentNode === parent) parent.replaceChild(value, current);
      else parent.insertBefore(value, marker ?? null);
    } else if (current != null && current !== '' && parent.firstChild) {
      // a sole text child holds the previous primitive (`0`/`NaN` are falsy, hence `!= null`)
      parent.replaceChild(value, parent.firstChild);
    } else parent.insertBefore(value, marker ?? null);
    tagSlot(value, marker);
    return value;
  }
  if (DEV) console.warn('[frameact] Unrecognized value. Skipped inserting', value);
  return current;
}

/** Remove the slot's nodes (optionally replacing them with one node). Returns the new `current`. */
function cleanChildren(parent: MountableElement, current: any, marker?: Node | null, replacement?: any): any {
  if (marker === undefined) {
    parent.textContent = '';
    if (replacement) {
      parent.appendChild(replacement);
      tagSlot(replacement, marker);
    }
    return replacement ?? '';
  }
  const list: any[] = Array.isArray(current) ? current : current != null && current !== '' ? [current] : [];
  if (list.length) {
    let inserted = false;
    for (let i = list.length - 1; i >= 0; i--) {
      const el = list[i];
      if (replacement !== el) {
        const owns = ownedBy(el, parent, marker);
        if (replacement && !inserted && !i) {
          if (owns) parent.replaceChild(replacement, el);
          else parent.insertBefore(replacement, marker);
        } else if (owns) el.remove();
      } else inserted = true;
    }
  } else if (replacement) parent.insertBefore(replacement, marker);
  if (replacement) tagSlot(replacement, marker);
  return replacement ? [replacement] : [];
}

function appendNodes(parent: MountableElement, array: any[], marker: Node | null): void {
  for (let i = 0; i < array.length; i++) {
    const n = array[i];
    parent.insertBefore(n, marker);
    tagSlot(n, marker);
  }
}

interface HostTag {
  parent: MountableElement;
  host: () => Node | null;
}

/** Portal content node -> its insert call's tag. A WeakMap, not a property: nothing on the node can clobber or throw. */
const portalHosts = new WeakMap<Node, HostTag>();

/**
 * The logical parent of a portal's top-level content node, or null. Reported only while the node's
 * native `parentNode` (prototype getter: a `<form>` control named `parentNode` shadows the property) is
 * that insert's mount, so a node moved out of the portal, or removed, stops reporting the old host.
 * Limitation: a node moved by hand elsewhere under the SAME mount (the default, `document.body`) keeps
 * its host; only leaving the mount is detected.
 */
export function portalHostOf(node: Node): Node | null {
  const tag = portalHosts.get(node);
  return tag !== undefined && getNatives().parentNode.call(node) === tag.parent ? tag.host() : null;
}

/** Test seam: register `node` as portal content hosted by `host` while it is a child of `parent` (default: its current parent). */
export function tagPortalHost(node: Node, host: () => Node | null, parent: MountableElement = node.parentNode as MountableElement): void {
  portalHosts.set(node, { parent, host });
}

/** Portal content: top-level nodes learn their logical host (delegated events bubble through it). */
function tagHost(value: any, tag: HostTag): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) tagHost(value[i], tag);
  } else if (value && value.nodeType && portalHosts.get(value) !== tag) portalHosts.set(value, tag);
}
