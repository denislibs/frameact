// Adapted from telegram-tt `src/util/cssAnimationEndListeners.ts` (GPL-3.0 project; this file is a
// re-implementation of the 40-line idiom, not a copy): wait for the `animationend`/`transitionend`
// of a node itself (not of a descendant), once, with an optional fallback timer for animations that
// never fire their end event (display:none mid-way, a disabled animation).

/** Chrome sometimes fires the end event a frame before the animation visibly completes. */
const ANIMATION_END_DELAY = 50;

export interface WaitForEndOptions {
  /** Only this `animationName` / transition `propertyName` counts. */
  name?: string;
  /** Call `handler` after this many ms even if no end event arrived. */
  fallbackMs?: number;
  /** Delay between the event and `handler` (default 50 ms); 0 calls it in the event. */
  delayMs?: number;
}

type EndEvent = 'animationend' | 'transitionend';

function waitForEndEvent(type: EndEvent, node: Node, handler: () => void, options: WaitForEndOptions): () => void {
  const { name, fallbackMs, delayMs = ANIMATION_END_DELAY } = options;
  let handled = false;
  let timer: ReturnType<typeof setTimeout> | undefined; // the fallback, then the post-event delay

  function cleanup() {
    node.removeEventListener(type, onEnd);
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function finish() {
    if (handled) return;
    handled = true;
    cleanup();
    handler();
  }

  function onEnd(e: Event) {
    if (handled || e.target !== e.currentTarget) return;
    if (name !== undefined) {
      const detail = type === 'animationend' ? (e as AnimationEvent).animationName : (e as TransitionEvent).propertyName;
      if (detail !== name) return;
    }
    if (delayMs > 0) {
      handled = true;
      cleanup();
      timer = setTimeout(() => {
        timer = undefined;
        handler();
      }, delayMs); // cancel() clears it too
    } else finish();
  }

  node.addEventListener(type, onEnd);
  if (fallbackMs !== undefined && fallbackMs > 0) timer = setTimeout(finish, fallbackMs);
  return () => {
    handled = true;
    cleanup();
  };
}

/** Resolve once `node`'s own CSS animation ends. Returns a cancel function. */
export function waitForAnimationEnd(node: Node, handler: () => void, options: WaitForEndOptions = {}): () => void {
  return waitForEndEvent('animationend', node, handler, options);
}

/** Resolve once `node`'s own CSS transition ends. Returns a cancel function. */
export function waitForTransitionEnd(node: Node, handler: () => void, options: WaitForEndOptions = {}): () => void {
  return waitForEndEvent('transitionend', node, handler, options);
}
