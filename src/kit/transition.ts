// Keyed slide transitions (telegram-tt `components/ui/Transition.tsx`, re-done on signals; the
// client brings the stylesheet — tt's Transition.scss — these are the class contracts):
//   container  `Transition` + `Transition-${name}` / `Transition-${name}Backwards` while animating
//   slide      `Transition_slide` + one of `-active` | `-from` | `-to` | `-inactive`
// The previous slide is kept alive through the animation (and after it, unless `shouldCleanup`),
// each slide is created once per key and updates fine-grained on its own, the animation is a heavy
// animation on `scope` (blocking if `isBlockingAnimation`), the end is the watched slide's own
// `animationend` (1 s fallback), applied through `requestMutation`; `restoreHeight` measures the settled
// slide in the forced-reflow phase of that frame and sets the container height in its mutate step.
// Not ported: `slideOptimized` (transform/transitionend variant), `withSwipeControl`, `nextKey`,
// `shouldWrap` (slides are always wrapped).
import { DEV } from '../env';
import {
  createEffect, createMemo, createMutationEffect, createSignal, frameForcedReflow, onCleanup, untrack, type Accessor,
} from '../index';
import { addExtraClass, removeExtraClass, toggleExtraClass } from '../dom/classes';
import { createComponent } from '../dom/component';
import { insert } from '../dom/insert';
import { For } from '../dom/list';
import { splitProps, spread } from '../dom/props';
import { setExtraStyles } from '../dom/styles';
import { requestMutation } from '../scheduler/fasterdom';
import { createHeavyAnimationScope, provideHeavyAnimationScope, type HeavyAnimationScope } from '../scheduler/heavyAnimation';
import { waitForAnimationEnd } from './animationEnd';

export type TransitionDirection = 'auto' | 'inverse' | 1 | -1;

export interface TransitionSlide {
  key: number;
  isActive: Accessor<boolean>;
  isFrom: Accessor<boolean>;
  activeKey: Accessor<number>;
}

export interface TransitionProps {
  activeKey: number;
  /** CSS animation name: the container gets `Transition-${name}` (`'none'`: switch without animating). */
  name: string;
  direction?: TransitionDirection;
  /** Keep every slide ever shown (tt `renderCount`): a slide is created once per key and never removed. */
  renderCount?: number;
  /** After the animation, drop the slides that are not active (see the two exceptions). */
  shouldCleanup?: boolean;
  /** `shouldCleanup`: also keep this key. */
  cleanupExceptionKey?: number;
  /** `shouldCleanup`: drop only this key. */
  cleanupOnlyKey?: number;
  /** After the animation, set the container's height to the active slide's (`height`, `flex-basis`). */
  shouldRestoreHeight?: boolean;
  /** Re-measure for `shouldRestoreHeight` when this changes. */
  restoreHeightKey?: unknown;
  /** `shouldRestoreHeight`: measure this descendant of the active slide instead of the slide. */
  contentSelector?: string;
  isBlockingAnimation?: boolean;
  /**
   * The heavy-animation scope the animation runs on and that the slides' effects are gated by
   * (default: a fresh child of the scope this component is under, so a blocking animation parks only
   * this subtree; pass one scope to several transitions to gate them together). Read once.
   */
  scope?: HeavyAnimationScope;
  /** Switch without animating (the client's "animations off" setting). */
  disableAnimation?: boolean;
  /** Extra class(es) for every slide. Read once. */
  slideClass?: string;
  onStart?: () => void;
  onStop?: () => void;
  ref?: (el: HTMLDivElement) => void;
  id?: string;
  class?: unknown;
  /** JSX (created once per slide) or a render function called once per slide. */
  children: unknown | ((slide: TransitionSlide) => unknown);
  [attr: `data-${string}`]: unknown;
  [handler: `on${Capitalize<string>}`]: unknown;
}

const CLASSES = {
  slide: 'Transition_slide',
  active: 'Transition_slide-active',
  from: 'Transition_slide-from',
  to: 'Transition_slide-to',
  inactive: 'Transition_slide-inactive',
};
export const ACTIVE_SLIDE_CLASS_NAME = CLASSES.active;
export const TO_SLIDE_CLASS_NAME = CLASSES.to;

const FALLBACK_ANIMATION_END = 1000;

const OWN_PROPS = [
  'activeKey', 'name', 'direction', 'renderCount', 'shouldCleanup', 'cleanupExceptionKey', 'cleanupOnlyKey',
  'shouldRestoreHeight', 'restoreHeightKey', 'contentSelector', 'isBlockingAnimation', 'scope', 'disableAnimation',
  'slideClass', 'onStart', 'onStop', 'children',
] as const;

type SlideList = (props: { each: number[]; keyed: true; order: 'manual'; children: (key: number) => unknown }) => unknown;

interface SlidesProps {
  scope: HeavyAnimationScope;
  each: number[];
  children: (key: number) => unknown;
}

/** The slide list under its own owner, with `scope` provided: every effect created in a slide snapshots it. */
function Slides(props: SlidesProps): unknown {
  provideHeavyAnimationScope(props.scope);
  return createComponent(For as unknown as SlideList, { get each() { return props.each; }, keyed: true, order: 'manual', children: props.children });
}

interface Step {
  active: number;
  name: string;
  disabled: boolean;
  direction: TransitionDirection;
}

/** Ascending keys (the DOM order of the slides); insertion into a tiny array, no `.sort()`. */
function sortedKeys(set: Iterable<number>): number[] {
  const out: number[] = [];
  for (const key of set) {
    let i = out.length;
    while (i > 0 && out[i - 1] > key) i--;
    out.splice(i, 0, key);
  }
  return out;
}

function setSlideState(slides: Map<number, HTMLElement>, activeKey: number): void {
  for (const [key, el] of slides) {
    removeExtraClass(el, CLASSES.from);
    removeExtraClass(el, CLASSES.to);
    toggleExtraClass(el, CLASSES.active, key === activeKey);
    toggleExtraClass(el, CLASSES.inactive, key !== activeKey);
  }
}

export function Transition(props: TransitionProps): unknown {
  const [own, rest] = splitProps(props, OWN_PROPS);
  const scope = untrack(() => own.scope) ?? createHeavyAnimationScope();
  const slideClass = untrack(() => own.slideClass);
  const active = createMemo(() => own.activeKey);
  const [prevKey, setPrevKey] = createSignal<number | undefined>(undefined);
  const slides = new Map<number, HTMLElement>();

  // The keys alive: the active one (plus the previous one until cleanup, or every visited one with
  // renderCount), in key order (the DOM order). The previous key is tracked here, eagerly, for `isFrom`.
  const [alive, setAlive] = createSignal<number[]>([untrack(active)]);
  createMutationEffect(
    () => active(),
    (key, last) => {
      if (last === undefined) return;
      setPrevKey(last);
      const keep = untrack(alive);
      const next = new Set(untrack(() => own.renderCount) ? keep : [last]);
      next.add(key);
      setAlive(sortedKeys(next));
    },
    { name: 'Transition.keys' },
  );

  const container = document.createElement('div');
  addExtraClass(container, 'Transition');
  spread(container, rest, true, undefined, 'Transition');
  // The slides live under `scope` (their effects wait for this transition's blocking animation);
  // the transition's own effects below stay on the outer scope, so a step during an animation is
  // applied at once (it supersedes the running one) instead of being parked by it.
  const rows = createComponent(Slides, { scope, get each() { return alive(); }, children: slide }) as Accessor<unknown[]>;
  insert(container, rows);

  function slide(key: number): HTMLElement {
    const el = document.createElement('div');
    addExtraClass(el, CLASSES.slide);
    if (slideClass) for (const token of slideClass.split(/\s+/)) if (token) addExtraClass(el, token);
    slides.set(key, el);
    onCleanup(() => slides.delete(key));
    const child = own.children;
    const content =
      typeof child === 'function'
        ? (child as (slide: TransitionSlide) => unknown)({
            key,
            isActive: () => active() === key,
            isFrom: () => prevKey() === key,
            activeKey: active,
          })
        : child;
    insert(el, content);
    return el;
  }

  let currentKey = untrack(active);
  let animating = false;
  let disposed = false;
  // The key whose step has settled (its animation ended, or it switched without one): restoreHeight follows it.
  const [settledKey, setSettledKey] = createSignal(currentKey);
  const pendingEnds = new Set<() => void>();
  const cancels = new Set<() => void>();
  onCleanup(() => {
    disposed = true; // a mutate task already booked by an end event does nothing (no onStop after dispose)
    for (const cancel of cancels) cancel();
    cancels.clear();
    for (const end of pendingEnds) end();
    pendingEnds.clear();
  });

  function cleanupSlides(activeKey: number): void {
    if (!untrack(() => own.shouldCleanup)) return;
    const exception = untrack(() => own.cleanupExceptionKey);
    const only = untrack(() => own.cleanupOnlyKey);
    const next = new Set<number>([activeKey]);
    if (exception !== undefined) next.add(exception);
    else if (only !== undefined) for (const key of untrack(alive)) if (key !== only) next.add(key);
    setAlive(sortedKeys(next));
  }

  // The animation: classes on the slides and the container (mutate phase), one heavy animation per step.
  createMutationEffect<Step>(
    () => {
      // Pull the rows: `Transition.keys` (created first, so it runs first in the drain) has updated
      // `alive`, and reading `rows()` here creates the new key's slide before this apply.
      rows();
      return { active: active(), name: own.name, disabled: !!own.disableAnimation, direction: own.direction ?? 'auto' };
    },
    (step, last) => {
      const changed = last !== undefined && step.active !== last.active;
      if (!changed) {
        if (animating) return;
        setSlideState(slides, step.active);
        return;
      }
      currentKey = step.active;
      if (step.name === 'none' || step.disabled) {
        setSlideState(slides, step.active);
        setSettledKey(step.active);
        cleanupSlides(step.active);
        return;
      }
      const from = slides.get(last.active);
      const to = slides.get(step.active);
      if (DEV && !to) console.error(`[frameact] <Transition>: no slide for activeKey ${step.active}`);
      for (const [key, el] of slides) {
        removeExtraClass(el, CLASSES.active);
        toggleExtraClass(el, CLASSES.from, key === last.active);
        toggleExtraClass(el, CLASSES.to, key === step.active);
        toggleExtraClass(el, CLASSES.inactive, key !== last.active && key !== step.active);
      }
      const isBackwards =
        step.direction === -1 ||
        (step.direction === 'auto' && last.active > step.active) ||
        (step.direction === 'inverse' && last.active < step.active);
      animating = true;
      const endHeavyAnimation = scope.begin(undefined, !!untrack(() => own.isBlockingAnimation));
      pendingEnds.add(endHeavyAnimation);
      untrack(() => own.onStart)?.();
      toggleExtraClass(container, `Transition-${step.name}`, !isBackwards);
      toggleExtraClass(container, `Transition-${step.name}Backwards`, isBackwards);

      let cancel: (() => void) | undefined;
      const onAnimationEnd = () => {
        if (cancel) cancels.delete(cancel);
        if (disposed) return;
        // Event time: the writes go to the mutate phase.
        requestMutation(() => {
          pendingEnds.delete(endHeavyAnimation);
          if (disposed) return;
          if (currentKey !== step.active) {
            endHeavyAnimation(); // superseded by a later step: that step finishes the classes
            return;
          }
          removeExtraClass(container, `Transition-${step.name}`);
          removeExtraClass(container, `Transition-${step.name}Backwards`);
          setSlideState(slides, step.active);
          setSettledKey(step.active); // restoreHeight: measured in this frame's forced reflow
          untrack(() => own.onStop)?.();
          endHeavyAnimation();
          animating = false;
          cleanupSlides(step.active);
        });
      };
      const watched = (step.name === 'reveal' || step.name === 'slideFadeAndroid') && isBackwards ? from : to;
      if (watched) {
        cancel = waitForAnimationEnd(watched, onAnimationEnd, { fallbackMs: FALLBACK_ANIMATION_END });
        cancels.add(cancel);
      } else onAnimationEnd();
    },
    { name: 'Transition.animate' },
  );

  // restoreHeight: at mount, when a step settles and when restoreHeightKey/contentSelector change, the
  // settled slide is measured in the FORCED-REFLOW phase — after the mutate phase that created and
  // attached it (a measure effect would run before the new slide exists) — and the container height
  // is set in that phase's mutate step, in the same frame. During an animation the old height stays.
  const [restored, setRestored] = createSignal<{ key: number; height: number } | undefined>(undefined);
  createEffect(
    () => (own.shouldRestoreHeight ? ([settledKey(), own.restoreHeightKey, own.contentSelector] as const) : undefined),
    (deps) => {
      if (deps === undefined) return;
      const [key, , selector] = deps;
      const activeEl = slides.get(key);
      if (!activeEl) return;
      const contentEl = (selector ? activeEl.querySelector<HTMLElement>(selector) : null) ?? activeEl;
      const { clientHeight, clientWidth } = contentEl;
      if (!clientHeight || !clientWidth) return;
      setRestored({ key, height: clientHeight });
    },
    frameForcedReflow,
    { name: 'Transition.measureHeight' },
  );
  createMutationEffect(
    () => restored(),
    (r) => {
      if (r === undefined) return;
      const activeEl = slides.get(r.key);
      if (activeEl) setExtraStyles(activeEl, { height: 'auto' });
      setExtraStyles(container, { height: `${r.height}px`, flexBasis: `${r.height}px` });
    },
    { name: 'Transition.restoreHeight' },
  );

  return container;
}
