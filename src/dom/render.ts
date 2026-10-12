import { DEV } from '../env';
import { createRoot } from '../index';
import { insert, type MountableElement } from './insert';
import { strictHooks } from './strict';

/**
 * Mount `code()` into `element` (appended after existing children). Synchronous: the root insert's
 * first apply runs at creation; the write into an attached container goes through the stricterdom
 * seam. Returns a disposer that removes what `render` inserted: everything in an initially empty
 * container; otherwise only the nodes between the pre-existing children and render's own end marker.
 */
export function render(code: () => unknown, element: MountableElement, init?: unknown): () => void {
  if (DEV && !element) {
    throw new Error("[frameact] render(): the container element doesn't exist. Make sure it is in the document.");
  }
  let disposer!: () => void;
  // Pre-existing children stay: mount before our own end marker so the disposer knows where our nodes end.
  const preexisting = element.lastChild;
  const end = preexisting ? document.createTextNode('') : null;
  strictHooks.forceMutation(() => {
    if (end) element.appendChild(end);
    createRoot((dispose) => {
      disposer = dispose;
      insert(element, code(), end ?? undefined, init);
    });
  }, element);
  return () => {
    disposer();
    strictHooks.forceMutation(() => {
      if (!preexisting || !end) {
        element.textContent = '';
        return;
      }
      for (let n = preexisting.nextSibling; n && n !== end; ) {
        const next: ChildNode | null = n.nextSibling;
        n.remove();
        n = next;
      }
      end.remove();
    }, element);
  };
}
