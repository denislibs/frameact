const undo: (() => void)[] = [];

/** Define `key` on `target`, remembering what was there (an own descriptor, or nothing) for `resetLayout`. */
function override(target: object, key: string, descriptor: PropertyDescriptor): void {
  const original = Object.getOwnPropertyDescriptor(target, key);
  undo.push(() => {
    if (original) Object.defineProperty(target, key, original);
    else delete (target as Record<string, unknown>)[key];
  });
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
}

/**
 * A fake vertical layout for jsdom (which lays nothing out): every `.ListItem` child of `list` is
 * `itemHeight` px tall and stacked in DOM order; the scroller has a writable `scrollTop`, a viewport
 * of `viewport` px and a `scrollHeight` of (items × itemHeight). Item rects are relative to the
 * scroller's scroll position, so a prepend moves the old first item's `top` down by the new rows.
 */
export function fakeLayout(scroller: HTMLElement, list: HTMLElement = scroller, itemHeight = 40, viewport = 200, onWrite?: (top: number) => void): void {
  let scrollTop = 0;
  const items = () => Array.from(list.querySelectorAll<HTMLElement>('.ListItem'));
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = Math.max(0, v);
      onWrite?.(v);
    },
  });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => items().length * itemHeight });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => viewport });
  Object.defineProperty(scroller, 'offsetHeight', { configurable: true, get: () => viewport });
  const origin = () => ({ top: -scrollTop, left: 0, width: 300, height: viewport, right: 300, bottom: viewport - scrollTop, x: 0, y: -scrollTop, toJSON: () => ({}) });
  scroller.getBoundingClientRect = () => ({ ...origin(), top: 0, y: 0 }) as DOMRect;
  const proto = Object.getPrototypeOf(scroller) as HTMLElement;
  // Items are measured through the prototype getters we override here (per element would miss new rows).
  override(proto, 'offsetTop', { get(this: HTMLElement) { return items().indexOf(this) * itemHeight; } });
  override(proto, 'offsetHeight', { get(this: HTMLElement) { return this === scroller ? viewport : itemHeight; } });
  override(proto, 'offsetParent', { get(this: HTMLElement) { return this.isConnected ? scroller : null; } });
  override(proto, 'getBoundingClientRect', {
    writable: true,
    value(this: HTMLElement) {
      if (this === scroller) return { ...origin(), top: 0, y: 0 } as DOMRect;
      const top = items().indexOf(this) * itemHeight - scrollTop;
      return { top, bottom: top + itemHeight, left: 0, right: 300, width: 300, height: itemHeight, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    },
  });
}

/** Undo `fakeLayout`'s prototype overrides, newest first (call in afterEach). */
export function resetLayout(): void {
  while (undo.length > 0) undo.pop()!();
}
