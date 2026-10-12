// DOM clobbering: `<form><input name="parentNode"></form>` makes `form.parentNode` the input (forms
// override even built-in properties), so structure that event delegation and portals depend on is read
// through the prototype getters (`Node.prototype.parentNode`, `Node.prototype.contains`,
// `ShadowRoot.prototype.host`), cached on first use.
export interface Natives {
  parentNode: (this: Node) => Node | null;
  contains: (this: Node, other: Node | null) => boolean;
  shadowHost: (this: ShadowRoot) => Element;
}

let natives: Natives | undefined;

export function getNatives(): Natives {
  return (natives ??= {
    parentNode: Object.getOwnPropertyDescriptor(Node.prototype, 'parentNode')!.get!,
    contains: Node.prototype.contains,
    shadowHost: Object.getOwnPropertyDescriptor(ShadowRoot.prototype, 'host')!.get!,
  });
}
