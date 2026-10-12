// Adapted from solidjs/solid packages/web/src/client.ts (MIT, © 2016-2025 Ryan Carniato) and
// dom-expressions packages/dom-expressions/src/client.js (MIT, © 2018-2019 Ryan Carniato).
import { DEV } from '../env';
import { getNatives } from './natives';

export type TemplateFactory = () => Element;

/**
 * The only innerHTML sink in the runtime: `html` is the compiler's static template string, never
 * runtime data.
 */
function create(html: string, flag: 1 | 2 | undefined): Element {
  if (DEV && /^<(html|head|body)[\s>]/i.test(html)) {
    throw new Error('[frameact] Document shell templates (<html>, <head>, <body>) cannot be client-created.');
  }
  const t = getNatives().createElement.call(document, 'template') as HTMLTemplateElement;
  t.innerHTML = html;
  const root = t.content.firstChild as Element;
  return flag === 2 ? (root.firstChild as Element) : root;
}

/**
 * Compiler primitive. `flag` 1 → clone with `document.importNode` (custom elements must be
 * upgraded); 2 → the html is wrapped in a namespace element (`<svg>…</svg>`) that is stripped.
 */
export function template(html: string, flag?: 1 | 2): TemplateFactory {
  let node: Element | undefined;
  return flag === 1
    ? () => getNatives().importNode.call(document, (node ??= create(html, flag)), true) as Element
    : () => (node ??= create(html, flag)).cloneNode(true) as Element;
}
