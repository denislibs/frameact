// Show/hide with a CSS transition (telegram-tt `useShowTransition` / `<ShowTransition>` /
// `useMediaTransition`, re-done on signals). The element gets the classes
// `${prefix}shown|not-shown`, `${prefix}open|not-open`, `${prefix}closing` plus
// `opacity-transition ${className}` (the client's CSS animates `.open`); opening goes through
// `scheduled-open` so the element paints once without `open` and the transition runs; closing keeps
// the element for `closeDuration` ms (teact uses a timer, not `transitionend`: an element whose
// transition never runs still closes) and then `shouldRender` turns false.
import { DEV } from '../env';
import { createEffect, createMemo, createMutationEffect, createSignal, onCleanup, tickEnd, untrack, type Accessor } from '../index';
import { addExtraClass, toggleExtraClass } from '../dom/classes';
import { splitProps, spread } from '../dom/props';
import { requestMeasure } from '../scheduler/fasterdom';

export type ShowTransitionState = 'closed' | 'scheduled-open' | 'open' | 'closing';

export interface ShowTransitionOptions {
  isOpen: Accessor<boolean | undefined>;
  /** Read once: start in `open` when `isOpen()` is true at creation (no fade-in on mount). Default false. */
  noMountTransition?: boolean;
  noOpenTransition?: Accessor<boolean | undefined>;
  noCloseTransition?: Accessor<boolean | undefined>;
  /** ms the element stays rendered after `isOpen()` turned false. Default 350. */
  closeDuration?: number;
  /** Added with `opacity-transition` at the first element; `false` adds neither (custom CSS). Default `'fast'`. */
  className?: string | false;
  /** Prefix of the state classes (`${prefix}open`). Default `''`. */
  prefix?: string;
  /** While true the state is `open` whatever `isOpen()` says. */
  forceOpen?: Accessor<boolean | undefined>;
  onCloseAnimationEnd?: () => void;
}

export interface ShowTransitionResult {
  /** Hand it to the element: `ref={t.ref}` (or `t.ref(el)`); it applies the state classes. */
  ref: (el: Element) => void;
  state: Accessor<ShowTransitionState>;
  /** `state() !== 'closed'`: render the element while this is true. */
  shouldRender: Accessor<boolean>;
  isClosing: Accessor<boolean>;
}

const CLOSE_DURATION = 350;

function applyClasses(el: Element, state: ShowTransitionState, prefix: string): void {
  const shown = state !== 'closed';
  toggleExtraClass(el, `${prefix}shown`, shown);
  toggleExtraClass(el, `${prefix}not-shown`, !shown);
  toggleExtraClass(el, `${prefix}open`, state === 'open');
  toggleExtraClass(el, `${prefix}not-open`, state !== 'open');
  toggleExtraClass(el, `${prefix}closing`, state === 'closing');
}

export function createShowTransition(options: ShowTransitionOptions): ShowTransitionResult {
  const { isOpen, noOpenTransition, noCloseTransition, forceOpen, onCloseAnimationEnd } = options;
  const closeDuration = options.closeDuration ?? CLOSE_DURATION;
  const className = options.className ?? 'fast';
  const prefix = options.prefix ?? '';

  const initiallyOpen = untrack(() => !!(forceOpen?.() || isOpen()));
  const [state, setState] = createSignal<ShowTransitionState>(
    initiallyOpen ? (options.noMountTransition || untrack(() => noOpenTransition?.()) ? 'open' : 'scheduled-open') : 'closed',
  );
  const [el, setEl] = createSignal<Element | null>(null);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const clearCloseTimer = () => {
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };
  onCleanup(clearCloseTimer);

  // Logic: the state machine follows `isOpen` (tickEnd — no DOM here).
  createEffect(
    () => ({ open: !!isOpen(), force: !!forceOpen?.() }),
    ({ open, force }) => {
      const s = untrack(state);
      if (force) {
        clearCloseTimer();
        setState('open');
        return;
      }
      if (open) {
        if (s === 'open' || s === 'scheduled-open') return;
        clearCloseTimer();
        setState(untrack(() => noOpenTransition?.()) ? 'open' : 'scheduled-open');
        return;
      }
      if (s === 'closed' || s === 'closing') return;
      if (untrack(() => noCloseTransition?.())) {
        setState('closed');
        return;
      }
      setState('closing');
      closeTimer = setTimeout(() => {
        closeTimer = undefined;
        setState('closed');
        onCloseAnimationEnd?.();
      }, closeDuration);
    },
    tickEnd,
    { name: 'showTransition' },
  );

  // DOM: the classes follow the state (mutate phase). `scheduled-open` paints once, then the next
  // frame's measure flips to `open`, so the CSS transition starts from the painted `not-open` state.
  createMutationEffect(
    () => [el(), state()] as const,
    ([element, s]) => {
      if (element === null) return;
      applyClasses(element, s, prefix);
      if (s === 'scheduled-open') {
        requestMeasure(() => {
          if (untrack(state) === 'scheduled-open') setState('open');
        });
      }
    },
    { name: 'showTransition.classes' },
  );

  return {
    ref(element) {
      if (className !== false) {
        addExtraClass(element, 'opacity-transition');
        addExtraClass(element, className);
      }
      // Applied right here, at creation (the node is detached): the element attaches with its initial
      // classes, so no transition starts from an unstyled first paint (teact's `ref.onChange` workaround).
      applyClasses(element, untrack(state), prefix);
      setEl(element);
    },
    state,
    shouldRender: createMemo(() => state() !== 'closed'),
    isClosing: createMemo(() => state() === 'closing'),
  };
}

export interface MediaTransitionOptions extends Omit<ShowTransitionOptions, 'isOpen' | 'noMountTransition' | 'className'> {
  hasMediaData: Accessor<boolean | undefined>;
  className?: string | false;
}

/** For large media: no fade-in when the data is already there at creation, the `slow` class. */
export function createMediaTransition(options: MediaTransitionOptions): ShowTransitionResult {
  const { hasMediaData, ...rest } = options;
  return createShowTransition({
    ...rest,
    isOpen: hasMediaData,
    noMountTransition: untrack(() => !!hasMediaData()),
    className: options.className ?? 'slow',
  });
}

export interface ShowTransitionProps {
  isOpen: boolean | undefined;
  /** Keep the element rendered but closed (`not-shown`). */
  isHidden?: boolean;
  /** No `opacity-transition fast` classes: the client's own CSS. */
  isCustom?: boolean;
  noCloseTransition?: boolean;
  /** Read once: animate the first render too (default: an element open at creation does not fade in). */
  shouldAnimateFirstRender?: boolean;
  ref?: (el: HTMLDivElement) => void;
  id?: string;
  class?: unknown;
  style?: unknown;
  onClick?: (e: MouseEvent) => void;
  children?: unknown;
  [attr: `data-${string}`]: unknown;
}

const OWN_PROPS = ['isOpen', 'isHidden', 'isCustom', 'noCloseTransition', 'shouldAnimateFirstRender'] as const;

/**
 * `<ShowTransition isOpen>`: a `<div>` (the remaining props are spread onto it: `id`, `class`,
 * `style`, `onClick`, `ref`, `data-*`) that mounts while `isOpen` and stays for the close transition;
 * the children are created with the div and kept until it is gone (no "previous children" copy:
 * they simply stay mounted while closing).
 */
export function ShowTransition(props: ShowTransitionProps): unknown {
  if (DEV) {
    // The descriptor, not `props.children`: reading a JSX getter would create the children an extra time.
    const children = Object.getOwnPropertyDescriptor(props, 'children')?.value as unknown;
    if (typeof children === 'function' && children.length > 0) {
      console.error('[frameact] <ShowTransition>: children must be JSX, not a render function.');
    }
  }
  const [own, rest] = splitProps(props, OWN_PROPS);
  const t = createShowTransition({
    isOpen: () => !!own.isOpen && !own.isHidden,
    noMountTransition: !untrack(() => own.shouldAnimateFirstRender),
    className: untrack(() => own.isCustom) ? false : undefined,
    noCloseTransition: () => own.noCloseTransition,
  });
  // A boolean memo: the element is created when it becomes present and kept while it stays present
  // (isHidden toggling while open, or open -> closing -> closed under isHidden, keeps the same div).
  const present = createMemo(() => t.shouldRender() || !!own.isHidden);
  return createMemo(() => {
    if (!present()) return undefined;
    return untrack(() => {
      const el = document.createElement('div');
      t.ref(el);
      spread(el, rest, false, undefined, 'ShowTransition');
      return el;
    });
  });
}
