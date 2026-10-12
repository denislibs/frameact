// Adapted from dom-expressions packages/dom-expressions/src/client.js (MIT, © 2017 Ryan Carniato):
// event delegation on `document`; handlers live on nodes under the compiler's `_$$<event>` keys.
import { DEV } from '../env';
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

/** A native listener or a listener object: the only things `addEventListener` accepts. */
function isListener(value: unknown): value is EventListenerOrEventListenerObject {
  return typeof value === 'function' || (typeof value === 'object' && value !== null && typeof (value as { handleEvent?: unknown }).handleEvent === 'function');
}

function refuseHandler(where: string, name: string, handler: unknown): void {
  if (DEV) console.error(`[frameact] ${where}${name}: the handler must be a function, a [fn, data] tuple or an object with handleEvent; got`, handler);
}

/** `[fn, data]` as a listener calling `fn.call(node, data, e)`; `undefined` when `fn` is not a function. The tuple is never written to (it may be shared). */
export function tupleListener(node: Element, tuple: readonly unknown[]): EventListener | undefined {
  const fn = tuple[0] as (data: unknown, e: Event) => void;
  const data = tuple[1];
  return typeof fn === 'function' ? (e: Event) => fn.call(node, data, e) : undefined;
}

/** Compiler primitive: `addEvent(el, name, handler, delegate)`; tuple handlers carry bound data. */
export function addEvent(node: Element, name: string, handler: unknown, delegate?: boolean): void {
  const target = node as unknown as Record<string, unknown>;
  if (delegate) {
    if (Array.isArray(handler)) {
      if (!isListener(handler[0])) return refuseHandler('onX=', name, handler);
      target[EVENT_KEY + name] = handler[0];
      target[EVENT_KEY + name + 'Data'] = handler[1];
    } else {
      if (handler != null && !isListener(handler)) return refuseHandler('onX=', name, handler);
      target[EVENT_KEY + name] = handler;
      target[EVENT_KEY + name + 'Data'] = undefined; // a plain handler replaces a tuple's data
    }
    return;
  }
  if (Array.isArray(handler)) {
    const listener = tupleListener(node, handler);
    if (!listener) return refuseHandler('onX=', name, handler);
    node.addEventListener(name, listener);
  } else if (handler == null) {
    // nothing to attach
  } else if (isListener(handler)) {
    node.addEventListener(name, handler, typeof handler === 'function' ? undefined : (handler as AddEventListenerOptions));
  } else refuseHandler('onX=', name, handler);
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
  if (!isListener(value)) return refuseHandler(capture ? 'oncapture:' : 'on:', name, value); // never stored: later updates stay valid
  if (!map) listeners.set(node, (map = new Map()));
  map.set(key, value);
  node.addEventListener(name, value, capture || (typeof value === 'function' ? undefined : (value as AddEventListenerOptions)));
}

// DOM clobbering: `<form><input name="parentNode"></form>` makes `form.parentNode` the input (forms
// override even built-in properties), so the walk reads structure through the prototype getters
// (`Node.prototype.parentNode`, `Node.prototype.contains`, `ShadowRoot.prototype.host`), cached on
// first use. Expando keys (`_$$click`, `_$host`) cannot be read any other way and are validated.
interface Natives {
  parentNode: (this: Node) => Node | null;
  contains: (this: Node, other: Node | null) => boolean;
  shadowHost: (this: ShadowRoot) => Element;
}
const MAX_PORTAL_HOPS = 64;
let natives: Natives | undefined;

function getNatives(): Natives {
  return (natives ??= {
    parentNode: Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode')!.get!,
    contains: Node.prototype.contains,
    shadowHost: Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'host')!.get!,
  });
}

function eventHandler(e: Event): void {
  const { parentNode, contains, shadowHost } = getNatives();
  let node: any = e.target;
  const key = EVENT_KEY + e.type;
  const oriCurrentTarget = e.currentTarget;
  const retarget = (value: unknown) => Object.defineProperty(e, 'target', { configurable: true, value });
  /**
   * A portal's logical parent. The real host is an accessor (insert.ts defines it with a getter); form
   * named properties — including controls linked from elsewhere with `form=` — are data properties,
   * so only an own accessor counts. The host must also be a Node outside the portal's own subtree.
   */
  const portalHost = (n: any): Node | undefined => {
    if (!n[HOST_KEY]) return undefined;
    const getter = Object.getOwnPropertyDescriptor(n, HOST_KEY)?.get;
    const h = getter?.call(n);
    return h instanceof Node && !contains.call(n, h) ? h : undefined;
  };
  let hops = 0; // safety net: portals nest a handful of levels, a longer chain is a cycle
  const handleNode = (): boolean => {
    const handler = node[key];
    if (handler && node.disabled !== true) {
      const data = node[`${key}Data`];
      if (typeof handler === 'function') {
        if (data !== undefined) handler.call(node, data, e);
        else handler.call(node, e);
      } else if (typeof handler.handleEvent === 'function') handler.handleEvent(e);
      if (e.cancelBubble) return false;
    }
    if (node instanceof ShadowRoot) {
      const host = shadowHost.call(node);
      if (!portalHost(host) && contains.call(node, e.target as Node)) retarget(host);
    }
    return true;
  };
  const walkUpTree = () => {
    while (handleNode()) {
      const host = portalHost(node);
      if (host && ++hops > MAX_PORTAL_HOPS) break;
      node = host || parentNode.call(node) || (node instanceof ShadowRoot ? shadowHost.call(node) : null);
      if (!node) break;
    }
  };
  // simulate currentTarget
  Object.defineProperty(e, 'currentTarget', {
    configurable: true,
    get() {
      return node || document;
    },
  });
  try {
    if (e.composedPath) {
      const path = e.composedPath();
      retarget(path[0]);
      for (let i = 0; i < path.length - 2; i++) {
        node = path[i];
        if (!handleNode()) break;
        const host = portalHost(node);
        if (host) {
          node = host;
          walkUpTree(); // bubble up from the portal's logical position
          break;
        }
        if (parentNode.call(node) === oriCurrentTarget) break; // never above the delegation root
      }
    } else walkUpTree();
  } finally {
    // Back to the native values for whoever listens after us (Task 8's document-level checks).
    // The shadowing own properties are deleted, so the prototype getters answer again.
    delete (e as any).target;
    delete (e as any).currentTarget;
  }
}
