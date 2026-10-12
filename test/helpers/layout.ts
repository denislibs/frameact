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
  Object.defineProperty(proto, 'offsetTop', { configurable: true, get(this: HTMLElement) { return items().indexOf(this) * itemHeight; } });
  Object.defineProperty(proto, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this === scroller ? viewport : itemHeight; } });
  Object.defineProperty(proto, 'offsetParent', { configurable: true, get(this: HTMLElement) { return this.isConnected ? scroller : null; } });
  proto.getBoundingClientRect = function (this: HTMLElement) {
    if (this === scroller) return { ...origin(), top: 0, y: 0 } as DOMRect;
    const top = items().indexOf(this) * itemHeight - scrollTop;
    return { top, bottom: top + itemHeight, left: 0, right: 300, width: 300, height: itemHeight, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
}

/** Undo `fakeLayout`'s prototype overrides (call in afterEach). */
export function resetLayout(): void {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  delete proto.offsetTop;
  delete proto.offsetHeight;
  delete proto.offsetParent;
  delete (proto as { getBoundingClientRect?: unknown }).getBoundingClientRect;
}
