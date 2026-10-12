// Imported first by every bench: jsdom globals + a manual rAF (frames are run by flushSync()).
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const g = globalThis as any;
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'DocumentFragment', 'MutationObserver', 'Event', 'InputEvent', 'HTMLInputElement', 'SVGElement']) {
  if (!(key in g)) g[key] = key === 'window' ? dom.window : (dom.window as any)[key];
}
const rafs: (() => void)[] = [];
g.requestAnimationFrame = (cb: () => void) => rafs.push(cb);
g.cancelAnimationFrame = () => {};
delete g.requestIdleCallback;
/** Drop pending rAF callbacks (flushSync already ran the frame work). */
export function clearRaf() {
  rafs.length = 0;
}
