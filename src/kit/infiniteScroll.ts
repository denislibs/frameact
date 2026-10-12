// `<InfiniteScroll>` (telegram-tt `components/ui/InfiniteScroll.tsx` on signals): a scroll
// container that keeps its scroll position across list updates (`createScrollAnchor`), asks for
// more items near either end (`onLoadMore`, debounced like tt: fire at once, then quiet for 1 s),
// and preloads when the list is shorter than `preloadBackwards` or does not fill the viewport.
// Not ported: `withAbsolutePositioning`/`maxHeight`, `cacheBuster`, `beforeChildren` (put it in
// `children`); `scrollContainer` (tt `scrollContainerClosest`) is a selector for a scrolling ancestor.
import { createMeasureEffect, createMemo, untrack } from '../index';
import { insert } from '../dom/insert';
import { splitProps, spread } from '../dom/props';
import { debounce } from '../scheduler/schedulers';
import { createScrollAnchor, trackItems } from './scrollAnchor';

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
const DEFAULT_SENSITIVE_AREA = 800;
const LOAD_MORE_QUIET_MS = 1000;

const OWN_PROPS = [
  'items', 'itemSelector', 'preloadBackwards', 'sensitiveArea', 'noScrollRestore', 'noScrollRestoreOnTop',
  'scrollContainer', 'onLoadMore', 'onScroll', 'children',
] as const;

function offsetTopIn(el: HTMLElement, scroller: HTMLElement, nested: boolean): number {
  if (!nested) return el.offsetTop;
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

export function InfiniteScroll(props: InfiniteScrollProps): unknown {
  const [own, rest] = splitProps(props, OWN_PROPS);
  const el = document.createElement('div');
  spread(el, rest, true, undefined, 'InfiniteScroll');
  insert(el, () => own.children);

  const closest = untrack(() => own.scrollContainer);
  const scroller = (): HTMLElement => (closest ? (el.closest<HTMLElement>(closest) ?? el) : el);
  const nested = closest !== undefined;

  const anchor = createScrollAnchor({
    container: scroller,
    list: () => el,
    items: () => own.items,
    itemSelector: untrack(() => own.itemSelector),
    noScrollRestore: () => own.noScrollRestore,
    noScrollRestoreOnTop: () => own.noScrollRestoreOnTop,
  });

  // Recreated per `items` change (as tt does): a new chunk re-arms the quiet period.
  const loaders = createMemo(() => {
    trackItems(own.items);
    const onLoadMore = own.onLoadMore;
    if (!onLoadMore) return undefined;
    return {
      backwards: debounce((noScroll = false) => onLoadMore({ direction: 'backwards', noScroll }), LOAD_MORE_QUIET_MS, true, false),
      forwards: debounce(() => onLoadMore({ direction: 'forwards' }), LOAD_MORE_QUIET_MS, true, false),
    };
  });

  // Initial preload (measure: reads scrollHeight/clientHeight after attach).
  createMeasureEffect(
    () => [trackItems(own.items) as readonly unknown[] | undefined, loaders(), own.preloadBackwards ?? DEFAULT_PRELOAD_BACKWARDS] as const,
    ([items, load, preloadBackwards]) => {
      if (!load) return;
      if (preloadBackwards > 0 && (!items || items.length < preloadBackwards)) {
        load.backwards(true);
        return;
      }
      const { scrollHeight, clientHeight } = scroller();
      if (clientHeight && scrollHeight < clientHeight) load.backwards();
    },
    { name: 'InfiniteScroll.preload' },
  );

  function onScroll(e: Event): void {
    const load = untrack(loaders);
    if (load) {
      const items = anchor.items();
      const current = anchor.anchor();
      const container = scroller();
      if (nested && !el.getBoundingClientRect().width) {
        anchor.track(undefined);
        anchor.consumeRestored();
      } else if (!anchor.consumeRestored()) {
        const { scrollTop, scrollHeight, offsetHeight } = container;
        const first = items[0];
        const last = items[items.length - 1];
        const top = first ? offsetTopIn(first, container, nested) : 0;
        const bottom = last ? offsetTopIn(last, container, nested) + last.offsetHeight : scrollHeight;
        const sensitiveArea = untrack(() => own.sensitiveArea) ?? DEFAULT_SENSITIVE_AREA;
        const isNearTop = scrollTop <= top + sensitiveArea;
        const isNearBottom = bottom - (scrollTop + offsetHeight) <= sensitiveArea;
        const currentTop = current?.offsetParent ? current.getBoundingClientRect().top : undefined;
        let updated = false;
        if (isNearTop && first) {
          const firstTop = first.getBoundingClientRect().top;
          const newTop = currentTop !== undefined && current !== first ? currentTop : firstTop;
          if (current && newTop > anchor.anchorTop()) {
            anchor.track(first, firstTop);
            updated = true;
            load.forwards();
          }
        }
        if (isNearBottom && last) {
          const lastTop = last.getBoundingClientRect().top;
          const newTop = currentTop !== undefined && current !== last ? currentTop : lastTop;
          if (current && newTop < anchor.anchorTop()) {
            anchor.track(last, lastTop);
            updated = true;
            load.backwards();
          }
        }
        if (!updated) {
          if (currentTop !== undefined) anchor.track(current, currentTop);
          else if (first) anchor.track(first, first.getBoundingClientRect().top);
        }
      }
    }
    untrack(() => own.onScroll)?.(e);
  }

  // The listener goes on the scrolling element; a nested list finds its ancestor once attached.
  createMeasureEffect(
    () => undefined,
    () => {
      const target = scroller();
      target.addEventListener('scroll', onScroll);
      return () => target.removeEventListener('scroll', onScroll);
    },
    { name: 'InfiniteScroll.listen' },
  );

  return el;
}
