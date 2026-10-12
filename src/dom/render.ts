import { DEV } from '../env';
import { createRoot } from '../index';
import { insert, type MountableElement } from './insert';
import { getNatives } from './natives';
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
 * The container is read and written through the prototype natives: a `<form>` container with a
 * descendant named `firstChild`, `append` or `textContent` mounts and unmounts like any element.
 */
export function render(code: () => unknown, element: MountableElement, init?: unknown): () => void {
  if (DEV && !element) {
    throw new Error("[frameact] render(): the container element doesn't exist. Make sure it is in the document.");
  }
  const { firstChild, nextSibling, parentNode, appendChild, removeChild, setTextContent } = getNatives();
  let disposer!: () => void;
  const bounded = firstChild.call(element) !== null;
  const { createTextNode } = getNatives();
  const start = bounded ? createTextNode.call(document, '') : null;
  const end = bounded ? createTextNode.call(document, '') : null;
  strictHooks.forceMutation(() => {
    if (start && end) {
      appendChild.call(element, start);
      appendChild.call(element, end);
    }
    createRoot((dispose) => {
      disposer = dispose;
      insert(element, code(), end ?? undefined, init);
    });
  }, element);
  return () => {
    disposer();
    strictHooks.forceMutation(() => {
      if (!start || !end) {
        setTextContent.call(element, '');
        return;
      }
      if (parentNode.call(start) === element) {
        if (parentNode.call(end) === element) {
          for (let n = nextSibling.call(start); n && n !== end; ) {
            const next: ChildNode | null = nextSibling.call(n);
            removeChild.call(element, n);
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
