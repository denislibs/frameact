// Original frameact code (clean-room, written from the kit's behavioural spec): a scrolling list
// that asks for more items at either end and keeps the visible item in place across updates.
//
//   - The element is a `<div>` (rest props spread onto it) holding the children; the scrolling
//     element is the div itself or, with `scrollContainer`, the nearest ancestor matching it
//     (resolved once, after attach).
//   - Scroll anchoring is `createScrollAnchor` (snapshot in measure, restore in forced reflow).
//     The scroll handler keeps the anchor on the first visible item (a bounded walk from the last
//     anchor, two or three rect reads per event), so a list that drops rows from the far end still
//     restores to what the user sees.
//   - Loading: one MEASURE effect per items update (ONE tracked read of the list — a store array by
//     its shape) re-arms the two loaders and preloads backwards while the list is shorter than
//     `preloadBackwards` (`noScroll: true`) or does not fill the viewport. The scroll handler asks
//     backwards when moving down within `sensitiveArea` of the bottom and forwards when moving up
//     within it of the top. Each direction is `debounce(fn, 1000, true, false)`: one request, then
//     quiet for a second (or until the next chunk arrives, which re-arms it). The scroll event the
//     restore itself causes (`consumeRestored`) never asks for anything.
import { createMeasureEffect, onCleanup } from '../index';
import { debounce } from '../scheduler/schedulers';
import { insert } from '../dom/insert';
import { getNatives } from '../dom/natives';
import { spread } from '../dom/props';
import { createItemsVersion, createScrollAnchor } from './scrollAnchor';

export type LoadMoreDirection = 'forwards' | 'backwards';

export interface InfiniteScrollProps {
  /** The list (a store array is tracked by its shape: in-place `produce`/`reconcile` writes count). */
  items?: readonly unknown[];
  /** Default `.ListItem`. */
  itemSelector?: string;
  /** Ask for more (backwards) while the list is shorter than this. Default 20. */
  preloadBackwards?: number;
  /** Distance (px) from an end at which more is requested. Default 800. */
  sensitiveArea?: number;
  noScrollRestore?: boolean;
  noScrollRestoreOnTop?: boolean;
  /** A selector of the scrolling ancestor when this element is not the one that scrolls. Read once. */
  scrollContainer?: string;
  onLoadMore?: (args: { direction: LoadMoreDirection; noScroll?: boolean }) => void;
  onScroll?: (e: Event) => void;
  ref?: (el: HTMLDivElement) => void;
  id?: string;
  class?: unknown;
  style?: unknown;
  children?: unknown;
  [attr: `data-${string}`]: unknown;
  [handler: `on${Capitalize<string>}`]: unknown;
}

const DEFAULT_PRELOAD_BACKWARDS = 20;
const DEFAULT_SENSITIVE_AREA_PX = 800;
/** After a request a direction stays quiet this long (unless a new chunk arrives). */
const LOAD_MORE_QUIET_MS = 1000;

/** The props the component consumes itself; everything else (`id`, `class`, `style`, `ref`, `data-*`, `on*`) is spread onto the div. */
const OWN_PROPS = new Set([
  'items', 'itemSelector', 'preloadBackwards', 'sensitiveArea', 'noScrollRestore', 'noScrollRestoreOnTop', 'scrollContainer',
  'onLoadMore', 'onScroll', 'children',
]);
const isOwnProp = (key: string) => OWN_PROPS.has(key);

export function InfiniteScroll(props: InfiniteScrollProps): unknown {
  const natives = getNatives();
  const el = natives.createElement.call(document, 'div') as HTMLDivElement;
  const scrollContainerSelector = props.scrollContainer;
  let scroller: HTMLElement = el;
  let listening = false;
  let lastScrollTop: number | undefined;
  let anchorIndex = 0;

  const anchor = createScrollAnchor({
    container: () => scroller,
    list: () => el,
    items: () => props.items,
    itemSelector: props.itemSelector,
    noScrollRestore: () => props.noScrollRestore,
    noScrollRestoreOnTop: () => props.noScrollRestoreOnTop,
  });

  // ---- loading ----------------------------------------------------------------

  const requestBackwards = () => props.onLoadMore?.({ direction: 'backwards', noScroll: false });
  const requestForwards = () => props.onLoadMore?.({ direction: 'forwards' });
  let loadBackwards = requestBackwards;
  let loadForwards = requestForwards;

  /** Fresh loaders: the next approach to an end asks at once; repeats within a second are ignored. */
  function armLoaders(): void {
    loadBackwards = debounce(requestBackwards, LOAD_MORE_QUIET_MS, true, false);
    loadForwards = debounce(requestForwards, LOAD_MORE_QUIET_MS, true, false);
  }

  /** Measure phase (layout reads): preload while the list is short or does not fill the viewport. */
  function preload(): void {
    const count = props.items?.length ?? 0;
    if (count < (props.preloadBackwards ?? DEFAULT_PRELOAD_BACKWARDS)) props.onLoadMore?.({ direction: 'backwards', noScroll: true });
    else if (scroller.scrollHeight <= scroller.clientHeight) loadBackwards();
  }

  // ---- the scroll handler (an event handler: layout reads are fine here) --------

  /** Keep the anchor on the first visible item: a bounded walk from the current anchor. */
  function trackAnchor(): void {
    const items = anchor.items();
    if (items.length === 0) return;
    const viewportTop = scroller.getBoundingClientRect().top;
    const current = anchor.anchor();
    let i = anchorIndex < items.length && items[anchorIndex] === current ? anchorIndex : Math.max(0, current ? items.indexOf(current) : 0);
    let rect = items[i].getBoundingClientRect();
    while (i > 0) {
      const above = items[i - 1].getBoundingClientRect();
      if (above.bottom <= viewportTop) break;
      i--;
      rect = above;
    }
    while (rect.bottom <= viewportTop && i < items.length - 1) rect = items[++i].getBoundingClientRect();
    anchorIndex = i;
    anchor.track(items[i], rect.top);
  }

  function onScroll(event: Event): void {
    props.onScroll?.(event);
    const top = scroller.scrollTop;
    if (anchor.consumeRestored()) {
      // The browser's scroll event for the restore's own scrollTop write: not the user's.
      lastScrollTop = top;
      return;
    }
    trackAnchor();
    const prevTop = lastScrollTop;
    lastScrollTop = top;
    if (prevTop === undefined || top === prevTop) return; // the first event only tracks the anchor
    const area = props.sensitiveArea ?? DEFAULT_SENSITIVE_AREA_PX;
    if (top > prevTop) {
      if (scroller.scrollHeight - top - scroller.clientHeight <= area) loadBackwards();
    } else if (top <= area) loadForwards();
  }

  /** After attach: the scrolling element (the div, or the ancestor `scrollContainer` names) and its scroll listener. */
  function listen(): void {
    listening = true;
    if (scrollContainerSelector) scroller = (el.closest(scrollContainerSelector) as HTMLElement | null) ?? el;
    natives.addEventListener.call(scroller, 'scroll', onScroll, { passive: true });
  }

  // One tracked read of the list per update (a store array by its O(1) shape, anything else by identity),
  // turned into a fresh number per change: two store arrays can share a shape version, so the effect is
  // driven by the counter, not by the shape. The apply reads layout in the measure phase.
  createMeasureEffect(
    createItemsVersion(() => props.items),
    () => {
      if (!listening) listen();
      armLoaders();
      preload();
    },
    { name: 'infiniteScroll.items' },
  );

  onCleanup(() => {
    if (listening) natives.removeEventListener.call(scroller, 'scroll', onScroll);
  });

  insert(el, () => props.children);
  spread(el, props, true, isOwnProp);
  return el;
}
