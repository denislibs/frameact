import { DEV } from '../env';
import { createRoot } from '../index';
import { insert, type MountableElement } from './insert';
import { strictHooks } from './strict';

/**
 * Mount `code()` into `element` (appended after existing children). Synchronous: the root insert's
 * first apply runs at creation; the write into an attached container goes through the stricterdom
 * seam. Returns a disposer that also clears the container.
 */
export function render(code: () => unknown, element: MountableElement, init?: unknown): () => void {
  if (DEV && !element) {
    throw new Error("[frameact] render(): the container element doesn't exist. Make sure it is in the document.");
  }
  let disposer!: () => void;
  strictHooks.forceMutation(() => {
    createRoot((dispose) => {
      disposer = dispose;
      insert(element, code(), element.firstChild ? null : undefined, init);
    });
  }, element);
  return () => {
    disposer();
    strictHooks.forceMutation(() => {
      element.textContent = '';
    }, element);
  };
}
