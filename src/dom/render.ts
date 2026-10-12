import { DEV } from '../env';
import { createRoot } from '../index';
import { insert, type MountableElement } from './insert';
import { strictHooks } from './strict';

/**
 * Mount `code()` into `element` (appended after existing children). Synchronous: the root insert's
 * first apply runs at creation; the write into an attached container goes through the stricterdom
 * seam.
 *
 * The returned disposer depends on the container at mount time. Empty container: root mode (the
 * `textContent` fast path), and the disposer clears the WHOLE container. Non-empty container: render
 * brackets its nodes with its own pair of empty text markers and the disposer removes only what is
 * between them (plus the markers), leaving pre-existing and later-appended siblings alone.
 */
export function render(code: () => unknown, element: MountableElement, init?: unknown): () => void {
  if (DEV && !element) {
    throw new Error("[frameact] render(): the container element doesn't exist. Make sure it is in the document.");
  }
  let disposer!: () => void;
  const bounded = !!element.firstChild;
  const start = bounded ? document.createTextNode('') : null;
  const end = bounded ? document.createTextNode('') : null;
  strictHooks.forceMutation(() => {
    if (start && end) element.append(start, end);
    createRoot((dispose) => {
      disposer = dispose;
      insert(element, code(), end ?? undefined, init);
    });
  }, element);
  return () => {
    disposer();
    strictHooks.forceMutation(() => {
      if (!start || !end) {
        element.textContent = '';
        return;
      }
      if (start.parentNode === element) {
        if (end.parentNode === element) {
          for (let n = start.nextSibling; n && n !== end; ) {
            const next: ChildNode | null = n.nextSibling;
            n.remove();
            n = next;
          }
        } else if (DEV) {
          console.warn('[frameact] render(): the end marker is gone; only the start marker was removed.');
        }
      }
      start.remove();
      end.remove();
    }, element);
  };
}
