// Original frameact code (clean-room, written from the kit's behavioural spec): the show/hide
// transition — an element that mounts with a "not yet open" frame, flips to open one frame later,
// and stays rendered for the duration of its close transition.
//
// State machine (`ShowTransitionState`): closed → scheduled-open → open → closing → closed.
//   - `isOpen` turns true: `scheduled-open` at once (tickEnd). The element is created and attached
//     with `shown not-open` in the next mutate phase; the flip to `open` is booked from THAT mutate
//     phase into the following frame's measure phase, so the browser paints the not-open frame
//     and the CSS transition runs from it. `noOpenTransition` skips straight to `open`.
//   - `isOpen` turns false: `closing` (classes `not-open closing`), then `closed` after `closeDuration`
//     (`onCloseAnimationEnd`). `noCloseTransition` closes at once. Re-opening while closing cancels
//     the timer. `forceOpen` counts as open.
// Per instance (ShowTransition is used per list row): two signals (state, shouldRender), one tickEnd
// effect (the machine), one mutation effect (the class writes) — no element signal, no memos. The
// element is handed in through `ref`, which writes the current classes once; every later state
// change is one apply of the mutation effect (five classList toggles).
import { createEffect, createMemo, createMutationEffect, createSignal, onCleanup, untrack, type Accessor } from '../index';
import { requestMeasure } from '../scheduler/fasterdom';
import { insert } from '../dom/insert';
import { getNatives } from '../dom/natives';
import { spread } from '../dom/props';

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

const DEFAULT_CLOSE_DURATION_MS = 350;
const TRANSITION_CLASS = 'opacity-transition';

/** The five state tokens, in the order they are written: [shown, not-shown, open, not-open, closing]. */
type StateTokens = readonly [string, string, string, string, string];
const UNPREFIXED_TOKENS: StateTokens = ['shown', 'not-shown', 'open', 'not-open', 'closing'];

function stateTokens(prefix: string): StateTokens {
  if (prefix === '') return UNPREFIXED_TOKENS;
  return [`${prefix}shown`, `${prefix}not-shown`, `${prefix}open`, `${prefix}not-open`, `${prefix}closing`];
}

/** Mutate-phase (or detached-element) write of the state classes; idempotent. */
function writeState(el: Element, tokens: StateTokens, state: ShowTransitionState): void {
  const list = el.classList;
  const closed = state === 'closed';
  list.toggle(tokens[0], !closed);
  list.toggle(tokens[1], closed);
  list.toggle(tokens[2], state === 'open');
  list.toggle(tokens[3], state !== 'open');
  list.toggle(tokens[4], state === 'closing');
}

export function createShowTransition(options: ShowTransitionOptions): ShowTransitionResult {
  const { isOpen, forceOpen, noOpenTransition, noCloseTransition, onCloseAnimationEnd } = options;
  const closeDuration = options.closeDuration ?? DEFAULT_CLOSE_DURATION_MS;
  const className = options.className ?? 'fast';
  const tokens = stateTokens(options.prefix ?? '');
  const wantsOpen = (): boolean => !!(forceOpen?.() || isOpen());

  let current: ShowTransitionState = options.noMountTransition && untrack(wantsOpen) ? 'open' : 'closed';
  const [state, setState] = createSignal<ShowTransitionState>(current);
  const [shouldRender, setShouldRender] = createSignal(current !== 'closed');
  let el: Element | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function go(next: ShowTransitionState): void {
    current = next;
    setState(next);
    setShouldRender(next !== 'closed');
  }

  function cancelClose(): void {
    if (closeTimer === undefined) return;
    clearTimeout(closeTimer);
    closeTimer = undefined;
  }

  function close(): void {
    closeTimer = undefined;
    go('closed');
    onCloseAnimationEnd?.();
  }

  /** Measure task booked from the mutate phase that wrote `not-open`: the open frame is the next one. */
  function flip(): void {
    if (!disposed && current === 'scheduled-open') go('open');
  }

  // The machine: logic, so tickEnd (never parked by animations). `apply` runs untracked; the option
  // accessors are read at the moment of the transition they modify.
  createEffect(
    wantsOpen,
    (open) => {
      if (open) {
        if (current === 'open' || current === 'scheduled-open') return;
        cancelClose();
        go(noOpenTransition?.() ? 'open' : 'scheduled-open');
      } else {
        if (current === 'closed' || current === 'closing') return;
        if (noCloseTransition?.()) close();
        else {
          go('closing');
          closeTimer = setTimeout(close, closeDuration);
        }
      }
    },
    undefined,
    { name: 'showTransition' },
  );

  // The class writes, in the mutate phase. The scheduled-open frame also books the flip.
  createMutationEffect(
    state,
    (s) => {
      if (el !== undefined) writeState(el, tokens, s);
      if (s === 'scheduled-open') requestMeasure(flip);
    },
    { name: 'showTransition.classes' },
  );

  onCleanup(() => {
    disposed = true;
    cancelClose();
  });

  return {
    ref(node) {
      el = node;
      if (className !== false) node.classList.add(TRANSITION_CLASS, className);
      writeState(node, tokens, current);
    },
    state,
    shouldRender,
    isClosing: () => state() === 'closing',
  };
}

export interface MediaTransitionOptions extends Omit<ShowTransitionOptions, 'isOpen' | 'noMountTransition' | 'className'> {
  hasMediaData: Accessor<boolean | undefined>;
  className?: string | false;
}

/** For large media: no fade-in when the data is already there at creation, the `slow` class. */
export function createMediaTransition(options: MediaTransitionOptions): ShowTransitionResult {
  const { hasMediaData, className, ...rest } = options;
  return createShowTransition({
    ...rest,
    isOpen: hasMediaData,
    noMountTransition: untrack(hasMediaData) === true,
    className: className ?? 'slow',
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

/** The props the component consumes itself; everything else is spread onto the div. */
const OWN_PROPS = new Set(['isOpen', 'isHidden', 'isCustom', 'noCloseTransition', 'shouldAnimateFirstRender', 'children']);
const isOwnProp = (key: string) => OWN_PROPS.has(key);

/**
 * `<ShowTransition isOpen>`: a `<div>` (the remaining props are spread onto it: `id`, `class`,
 * `style`, `onClick`, `ref`, `data-*`) that mounts while `isOpen` and stays for the close transition;
 * the children are created with the div and kept until it is gone (no "previous children" copy:
 * they simply stay mounted while closing).
 */
export function ShowTransition(props: ShowTransitionProps): unknown {
  const t = createShowTransition({
    isOpen: () => !!props.isOpen && !props.isHidden,
    noMountTransition: !props.shouldAnimateFirstRender,
    noCloseTransition: () => props.noCloseTransition,
    className: props.isCustom ? false : 'fast',
  });
  // Rendered while the transition says so or while hidden-but-kept. A boolean memo first: the div
  // must survive every state change and an `isHidden` flip (same element through closing and closed).
  const rendered = createMemo(() => t.shouldRender() || !!props.isHidden);
  return createMemo(() => {
    if (!rendered()) return undefined;
    return untrack(() => {
      const div = getNatives().createElement.call(document, 'div');
      t.ref(div); // the state classes come first, the user's `class` tokens after them
      insert(div, () => props.children);
      spread(div, props, true, isOwnProp);
      return div;
    });
  });
}
