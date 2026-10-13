// Original frameact code (clean-room, written from the kit's behavioural spec): wait for the end of a
// node's own CSS animation or transition.
//
// One listener on the node; only events whose target IS the node count (an `animationend` bubbling
// up from a descendant — a nested <Transition>, an icon — is not ours). The handler is called once:
// after `delayMs` (default 50 ms: lets the browser paint the final keyframe before the caller
// rewrites classes; 0 calls it inside the event), or after `fallbackMs` when no end event arrives
// (a stylesheet without the animation, `animation: none` under a media query). Whichever fires
// first wins; the listener and both timers are released then. `cancel()` releases everything too,
// at any point — before the event, during the post-event delay, before the fallback.
import { getNatives } from '../dom/natives';

export interface WaitForEndOptions {
  /** Only this `animationName` / transition `propertyName` counts. */
  name?: string;
  /** Call `handler` after this many ms even if no end event arrived. */
  fallbackMs?: number;
  /** Delay between the event and `handler` (default 50 ms); 0 calls it in the event. */
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 50;

type Timer = ReturnType<typeof setTimeout> | undefined;

function waitForEnd(
  node: Node,
  eventType: 'animationend' | 'transitionend',
  nameKey: 'animationName' | 'propertyName',
  handler: () => void,
  options: WaitForEndOptions | undefined,
): () => void {
  const name = options?.name;
  const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  const { addEventListener, removeEventListener } = getNatives();
  let settled = false; // the handler ran, or cancel() was called
  let delayTimer: Timer;
  let fallbackTimer: Timer;

  function release() {
    settled = true;
    removeEventListener.call(node, eventType, onEvent);
    if (delayTimer !== undefined) clearTimeout(delayTimer);
    if (fallbackTimer !== undefined) clearTimeout(fallbackTimer);
    delayTimer = fallbackTimer = undefined;
  }

  function fire() {
    if (settled) return;
    release();
    handler();
  }

  function onEvent(event: Event) {
    if (settled || delayTimer !== undefined) return; // not ours any more, or already counting down
    if (event.target !== node) return; // a descendant's end bubbled up
    if (name !== undefined && (event as unknown as Record<string, unknown>)[nameKey] !== name) return;
    if (delayMs > 0) delayTimer = setTimeout(fire, delayMs);
    else fire();
  }

  addEventListener.call(node, eventType, onEvent);
  const fallbackMs = options?.fallbackMs;
  if (fallbackMs !== undefined) fallbackTimer = setTimeout(fire, fallbackMs);

  return () => {
    if (!settled) release();
  };
}

/** Resolve once `node`'s own CSS animation ends. Returns a cancel function. */
export function waitForAnimationEnd(node: Node, handler: () => void, options?: WaitForEndOptions): () => void {
  return waitForEnd(node, 'animationend', 'animationName', handler, options);
}

/** Resolve once `node`'s own CSS transition ends. Returns a cancel function. */
export function waitForTransitionEnd(node: Node, handler: () => void, options?: WaitForEndOptions): () => void {
  return waitForEnd(node, 'transitionend', 'propertyName', handler, options);
}
