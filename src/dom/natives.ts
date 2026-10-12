// DOM clobbering. `HTMLFormElement` has `[LegacyOverrideBuiltIns]`: a descendant form control with
// `name="X"` or ANY descendant with `id="X"` (an `<img id>`) shadows the form's own property `X`, built-ins
// included: `form.parentNode` is then the control, `form.remove` / `form.insertBefore` are not functions,
// `form.nodeName` is an element. Content-derived names and ids inside a form (an emoji id, a file name,
// a poll option) would let a message freeze a list or crash a render. So the runtime reads structure
// and calls the DOM methods it depends on through the prototype natives below, cached on first use
// (`.call(node, …)`: the same monomorphic call V8 makes for `node.method(…)`).
//
// Covered: structure getters, insertion/removal, identity getters, `textContent`, the attribute
// methods. Not covered: `classList`, `style`, `addEventListener`, `value`, `data` and other
// per-feature APIs of a form whose descendant takes exactly that name. That case fails loudly, not
// silently, and stays local to the element: the binding's effect throws on every run (its `_applied`
// never advances, so the error repeats), and because the compiler groups an element's dynamic
// attributes into one effect and `spread` applies its props in one pass, the OTHER props of that
// same effect or spread are not applied either. Other elements, the list and the frame are unaffected.
// Also not covered: `document` has `[LegacyOverrideBuiltIns]` too — a `<form name="addEventListener">`
// or `<img name="addEventListener">` in the document shadows `document.addEventListener`, which
// `delegateEvents` and the controlled-input listeners call (a `name`, not an `id`, is needed: low
// risk; `querySelectorAll` is already taken from the prototype for the same reason). Both are
// follow-ups (plan 3, "Follow-ups").
export interface Natives {
  parentNode: (this: Node) => Node | null;
  firstChild: (this: Node) => ChildNode | null;
  nextSibling: (this: Node) => ChildNode | null;
  nodeType: (this: Node) => number;
  /** Upper-case for HTML elements (`'FORM'`), the same as `tagName` there. */
  nodeName: (this: Node) => string;
  ownerDocument: (this: Node) => Document | null;
  localName: (this: Element) => string;
  namespaceURI: (this: Element) => string | null;
  /** `Node.prototype.textContent` setter. */
  setTextContent: (this: Node, text: string | null) => void;
  insertBefore: <T extends Node>(this: Node, node: T, child: Node | null) => T;
  appendChild: <T extends Node>(this: Node, node: T) => T;
  replaceChild: <T extends Node>(this: Node, node: Node, child: T) => T;
  removeChild: <T extends Node>(this: Node, child: T) => T;
  contains: (this: Node, other: Node | null) => boolean;
  shadowHost: (this: ShadowRoot) => Element;
  setAttribute: (this: Element, name: string, value: string) => void;
  removeAttribute: (this: Element, name: string) => void;
  setAttributeNS: (this: Element, namespace: string | null, name: string, value: string) => void;
  removeAttributeNS: (this: Element, namespace: string | null, localName: string) => void;
  /** `HTMLFormElement.prototype.elements` (`<input name="elements">` shadows `form.elements`). */
  formElements: (this: HTMLFormElement) => HTMLFormControlsCollection;
  /** `querySelectorAll` of a document / shadow root / element (a form named `querySelectorAll` shadows it on `document`). */
  querySelectorAll: {
    document: Document['querySelectorAll'];
    fragment: DocumentFragment['querySelectorAll'];
    element: Element['querySelectorAll'];
  };
}

let natives: Natives | undefined;

function getter<T extends object>(proto: T, name: string): (this: T) => any {
  return Object.getOwnPropertyDescriptor(proto, name)!.get!;
}

export function getNatives(): Natives {
  return (natives ??= {
    parentNode: getter(Node.prototype, 'parentNode'),
    firstChild: getter(Node.prototype, 'firstChild'),
    nextSibling: getter(Node.prototype, 'nextSibling'),
    nodeType: getter(Node.prototype, 'nodeType'),
    nodeName: getter(Node.prototype, 'nodeName'),
    ownerDocument: getter(Node.prototype, 'ownerDocument'),
    localName: getter(Element.prototype, 'localName'),
    namespaceURI: getter(Element.prototype, 'namespaceURI'),
    setTextContent: Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!.set!,
    insertBefore: Node.prototype.insertBefore,
    appendChild: Node.prototype.appendChild,
    replaceChild: Node.prototype.replaceChild,
    removeChild: Node.prototype.removeChild,
    contains: Node.prototype.contains,
    shadowHost: getter(ShadowRoot.prototype, 'host'),
    setAttribute: Element.prototype.setAttribute,
    removeAttribute: Element.prototype.removeAttribute,
    setAttributeNS: Element.prototype.setAttributeNS,
    removeAttributeNS: Element.prototype.removeAttributeNS,
    formElements: getter(HTMLFormElement.prototype, 'elements'),
    querySelectorAll: {
      document: Document.prototype.querySelectorAll,
      fragment: DocumentFragment.prototype.querySelectorAll,
      element: Element.prototype.querySelectorAll,
    },
  });
}
