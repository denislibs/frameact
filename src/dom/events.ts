// Adapted from dom-expressions packages/dom-expressions/src/client.js (MIT, © 2017 Ryan Carniato):
// event delegation on `document`; handlers live on nodes under the compiler's `_$$<event>` keys.
import { HOST_KEY } from './insert';

/** Compiler contract: `el._$$click = handler`, `el._$$clickData = data` (accessed as strings: oxlint no-underscore-dangle). */
export const EVENT_KEY = '_$$';

const delegated = new WeakMap<Document, Set<string>>();
const clearHooks = new Set<(doc: Document) => void>();

/** Compiler primitive: attach one document listener per event type (idempotent). */
export function delegateEvents(eventNames: readonly string[], doc: Document = window.document): void {
  let names = delegated.get(doc);
  if (!names) delegated.set(doc, (names = new Set()));
  for (const name of eventNames) {
    if (!names.has(name)) {
      names.add(name);
      doc.addEventListener(name, eventHandler);
    }
  }
}

/** Tests/teardown: remove every delegated listener (and whatever registered through `onClearDelegated`). */
export function clearDelegatedEvents(doc: Document = window.document): void {
  const names = delegated.get(doc);
  if (names) {
    for (const name of names) doc.removeEventListener(name, eventHandler);
    delegated.delete(doc);
  }
  for (const hook of clearHooks) hook(doc);
}

/** Modules that add their own document listeners next to delegation (controlled inputs) clean up here. */
export function onClearDelegated(fn: (doc: Document) => void): void {
  clearHooks.add(fn);
}

/** Compiler primitive: `addEvent(el, name, handler, delegate)`; tuple handlers carry bound data. */
export function addEvent(node: Element, name: string, handler: unknown, delegate?: boolean): void {
  const target = node as unknown as Record<string, unknown>;
  if (delegate) {
    if (Array.isArray(handler)) {
      target[EVENT_KEY + name] = handler[0];
      target[EVENT_KEY + name + 'Data'] = handler[1];
    } else {
      target[EVENT_KEY + name] = handler;
      target[EVENT_KEY + name + 'Data'] = undefined; // a plain handler replaces a tuple's data
    }
    return;
  }
  if (Array.isArray(handler)) {
    const fn = handler[0] as (data: unknown, e: Event) => void;
    node.addEventListener(name, (handler[0] = (e: Event) => fn.call(node, handler[1], e)));
  } else {
    node.addEventListener(
      name,
      handler as EventListener,
      typeof handler === 'function' ? undefined : (handler as AddEventListenerOptions),
    );
  }
}

const listeners = new WeakMap<Element, Map<string, EventListenerOrEventListenerObject>>();

/** `on:name` / `oncapture:name`: a native listener per element and name, replaced or removed on update. */
export function setListener(node: Element, name: string, value: unknown, capture: boolean): void {
  let map = listeners.get(node);
  const key = capture ? `c:${name}` : name;
  const prev = map?.get(key);
  if (prev) {
    node.removeEventListener(name, prev, capture || (typeof prev === 'function' ? undefined : (prev as EventListenerOptions)));
    map!.delete(key);
  }
  if (!value) return;
  if (!map) listeners.set(node, (map = new Map()));
  const listener = value as EventListenerOrEventListenerObject;
  map.set(key, listener);
  node.addEventListener(name, listener, capture || (typeof listener === 'function' ? undefined : (listener as AddEventListenerOptions)));
}

function eventHandler(e: Event): void {
  let node: any = e.target;
  const key = EVENT_KEY + e.type;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = (value: unknown) => Object.defineProperty(e, 'target', { configurable: true, value });
  const handleNode = (): boolean => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      if (data !== undefined) handler.call(node, data, e);
      else if (typeof handler === 'function') handler.call(node, e);
      else handler.handleEvent(e);
      if (e.cancelBubble) return false;
    }
    if (node.host && typeof node.host !== 'string' && !node.host[HOST_KEY] && node.contains(e.target)) {
      retarget(node.host);
    }
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node[HOST_KEY] || node.parentNode || node.host)) {
      // keep walking: portal hosts, parents, shadow hosts
    }
  };
  // simulate currentTarget
  Object.defineProperty(e, 'currentTarget', {
    configurable: true,
    get() {
      return node || document;
    },
  });
  if (e.composedPath) {
    const path = e.composedPath();
    retarget(path[0]);
    for (let i = 0; i < path.length - 2; i++) {
      node = path[i];
      if (!handleNode()) break;
      if (node[HOST_KEY]) {
        node = node[HOST_KEY];
        walkUpTree(); // bubble up from the portal's logical position
        break;
      }
      if (node.parentNode === oriCurrentTarget) break; // never above the delegation root
    }
  } else walkUpTree();
  // Mixing portals and shadow DOM can leave a nonstandard target: restore it.
  retarget(oriTarget);
}
