// jsdom globals (incl. what dom/natives.ts needs) + a manual rAF (frames run by flushSync()).
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const g = globalThis as any;
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Text', 'Comment', 'DocumentFragment', 'Document', 'ShadowRoot', 'HTMLFormElement', 'HTMLTemplateElement', 'MutationObserver', 'Event', 'InputEvent', 'HTMLInputElement', 'SVGElement', 'getComputedStyle']) {
  if (!(key in g)) g[key] = key === 'window' ? dom.window : (dom.window as any)[key];
}
const rafs: (() => void)[] = [];
g.requestAnimationFrame = (cb: () => void) => rafs.push(cb);
g.cancelAnimationFrame = () => {};
delete g.requestIdleCallback;
export function clearRaf() {
  rafs.length = 0;
}
