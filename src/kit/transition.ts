// Original frameact code (clean-room, written from the kit's behavioural spec): keyed slides with a
// CSS animation between them, on telegram-tt's class contract (bring the stylesheet).
//
// Model
//   - One `<div class="Transition">` holds one `<div class="Transition_slide">` per live key, in
//     ascending key order. A slide's content is created once (under its own root, which carries the
//     transition's heavy-animation scope) and kept until the slide is dropped.
//   - A STEP (`activeKey` changes) is one mutation effect: compute creates the missing slide on
//     detached DOM; apply (mutate phase) writes the classes — container `Transition-${name}` or
//     `Transition-${name}Backwards`, previous slide `-from`, new slide `-to`, the rest `-inactive` —
//     begins a heavy animation on the scope, watches the `to` slide's own `animationend`, calls
//     `onStart`. Which slides survive a step: `renderCount` / `shouldCleanup` keep every live slide;
//     otherwise only {previous, active} (keep-alive).
//   - The END arrives through `waitForAnimationEnd` and is applied in a mutation task: the heavy
//     animation is released first, then (unless the step was superseded or the component disposed)
//     the classes settle (`-active` / `-inactive`), `shouldCleanup` drops slides, `shouldRestoreHeight`
//     measures the active slide in the forced-reflow phase of the same frame and writes the
//     container's height in its mutate step, and `onStop` runs last.
//   - A step during a running step supersedes it: the first step's end only releases its own heavy
//     animation. A non-animated switch (`name: 'none'`, `disableAnimation`) during a running step
//     cancels it (waiter, heavy animation, `onStop`) so nothing stays stuck. Disposal cancels every
//     in-flight end, releases every heavy animation and disposes the slides; nothing touches the DOM
//     or calls `onStop` after it.
//   - Scopes: the slides' effects are gated by `props.scope` (default: a fresh child of the enclosing
//     scope); the component's own effects live under a child owner that re-provides the ENCLOSING
//     scope, so a step is never parked by this transition's own blocking animation.
import { DEV } from '../env';
import {
  createEffect, createHeavyAnimationScope, createMutationEffect, createRoot, createSignal, currentHeavyAnimationScope, getOwner,
  onCleanup, provideHeavyAnimationScope, runWithOwner, untrack, type Accessor, type HeavyAnimationScope,
} from '../index';
import { compute, createScope } from '../core/core';
import { requestForcedReflow, requestMutation } from '../scheduler/fasterdom';
import { insert } from '../dom/insert';
import { getNatives } from '../dom/natives';
import { spread } from '../dom/props';
import { setExtraStyles } from '../dom/styles';
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
  /**
   * Keep every slide ever shown (tt `renderCount`): a slide is created once per key and never removed.
   * The number is the size of the key set you expect (keys `0 … renderCount - 1`); it is a hint, not
   * a cap: with keys that are not a small enum (message ids, timestamps) the slides — and their DOM —
   * grow without bound. DEV warns once when more slides than `renderCount` are alive. Use
   * `shouldCleanup` or the default keep-alive for open key sets.
   */
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
  /**
   * JSX (created once per slide) or a render function called once per slide — **prefer the render
   * function**. Both slides are live during the animation: JSX children read the current props and
   * state, so the outgoing slide shows the NEW content while it slides out. The outgoing slide is
   * frozen on its old content only when the render function renders by `slide.key`
   * (`(slide) => <Screen id={slide.key} />`): each slide then owns the content of its own key.
   */
  children: unknown | ((slide: TransitionSlide) => unknown);
  [attr: `data-${string}`]: unknown;
  [handler: `on${Capitalize<string>}`]: unknown;
}

export const ACTIVE_SLIDE_CLASS_NAME = 'Transition_slide-active';
export const TO_SLIDE_CLASS_NAME = 'Transition_slide-to';
const FROM_SLIDE_CLASS_NAME = 'Transition_slide-from';
const INACTIVE_SLIDE_CLASS_NAME = 'Transition_slide-inactive';
const CONTAINER_CLASS_NAME = 'Transition';
const SLIDE_CLASS_NAME = 'Transition_slide';
/** A slide whose stylesheet has no animation (or `animation: none`) still settles. */
const ANIMATION_END_FALLBACK_MS = 1000;

type SlideStateClass =
  | typeof ACTIVE_SLIDE_CLASS_NAME
  | typeof TO_SLIDE_CLASS_NAME
  | typeof FROM_SLIDE_CLASS_NAME
  | typeof INACTIVE_SLIDE_CLASS_NAME;

interface SlideRecord {
  key: number;
  el: HTMLDivElement;
  /** The state class currently on the element (`''` before the first write). */
  state: SlideStateClass | '';
  dispose: () => void;
}

/** One animated step; stays in `inFlight` until its end task ran (or disposal cancelled it). */
interface Step {
  seq: number;
  to: SlideRecord;
  cancelWait: () => void;
  endHeavyAnimation: () => void;
}

/** The props the component consumes itself; everything else (`id`, `class`, `ref`, `data-*`, `on*`) is spread onto the container. */
const OWN_PROPS = new Set([
  'activeKey', 'name', 'direction', 'renderCount', 'shouldCleanup', 'cleanupExceptionKey', 'cleanupOnlyKey', 'shouldRestoreHeight',
  'restoreHeightKey', 'contentSelector', 'isBlockingAnimation', 'scope', 'disableAnimation', 'slideClass', 'onStart', 'onStop', 'children',
]);
const isOwnProp = (key: string) => OWN_PROPS.has(key);

function callback(fn: (() => void) | undefined, what: string): void {
  if (fn === undefined) return;
  try {
    fn();
  } catch (error) {
    console.error(`[frameact] <Transition> ${what} failed`, error);
  }
}

function isForwards(direction: TransitionDirection | undefined, fromKey: number, toKey: number): boolean {
  if (direction === 1) return true;
  if (direction === -1) return false;
  const natural = toKey > fromKey;
  return direction === 'inverse' ? !natural : natural;
}

export function Transition(props: TransitionProps): unknown {
  const natives = getNatives();
  const container = natives.createElement.call(document, 'div') as HTMLDivElement;
  container.classList.add(CONTAINER_CLASS_NAME);
  const slideClassTokens = (props.slideClass ?? '').split(/\s+/).filter(Boolean);
  const outerScope = currentHeavyAnimationScope();
  const scope = props.scope ?? createHeavyAnimationScope(outerScope);
  const owner = getOwner();

  let currentKey = untrack(() => props.activeKey);
  const [activeKey, setActiveKey] = createSignal(currentKey);
  const [fromKey, setFromKey] = createSignal<number | undefined>(undefined);
  const slides: SlideRecord[] = []; // ascending key order = DOM order
  const inFlight: Step[] = [];
  let running: Step | undefined;
  let stepSeq = 0;
  let containerAnimationClass: string | undefined;
  let disposed = false;
  let warnedRenderCount = false;

  // The slides' scope: every effect their content creates snapshots it.
  provideHeavyAnimationScope(scope);

  const findSlide = (key: number): SlideRecord | undefined => {
    for (let i = 0; i < slides.length; i++) if (slides[i].key === key) return slides[i];
    return undefined;
  };

  /** Create the slide for `key` (detached): its content under its own root, in the component's context. */
  function createSlide(key: number): SlideRecord {
    const el = natives.createElement.call(document, 'div') as HTMLDivElement;
    el.classList.add(SLIDE_CLASS_NAME, ...slideClassTokens);
    const slide: TransitionSlide = {
      key,
      isActive: () => activeKey() === key,
      isFrom: () => fromKey() === key,
      activeKey,
    };
    // A detached root (disposed by us when the slide is dropped) created under the component owner,
    // whatever owner this runs in: it inherits the component's context — the heavy-animation scope.
    const dispose = runWithOwner(owner, () =>
      createRoot((d) => {
        const children = props.children;
        insert(el, typeof children === 'function' ? (children as (s: TransitionSlide) => unknown)(slide) : children);
        return d;
      }),
    );
    const record: SlideRecord = { key, el, state: '', dispose: dispose ?? (() => {}) };
    let at = slides.length;
    while (at > 0 && slides[at - 1].key > key) at--;
    slides.splice(at, 0, record);
    if (DEV && !warnedRenderCount) {
      const renderCount = untrack(() => props.renderCount);
      if (renderCount !== undefined && slides.length > renderCount) {
        warnedRenderCount = true;
        console.warn(
          `[frameact] <Transition renderCount={${renderCount}}>: ${slides.length} slides are alive. Slides are kept per key and never dropped; with keys that are not a small enum the DOM grows without bound — use shouldCleanup or the default keep-alive.`,
        );
      }
    }
    return record;
  }

  // ---- DOM writes (mutate phase only) --------------------------------------

  function setSlideState(record: SlideRecord, state: SlideStateClass): void {
    if (record.state === state) return;
    if (record.state !== '') record.el.classList.remove(record.state);
    record.el.classList.add(state);
    record.state = state;
  }

  function setContainerAnimation(cls: string | undefined): void {
    if (containerAnimationClass === cls) return;
    if (containerAnimationClass !== undefined) container.classList.remove(containerAnimationClass);
    if (cls !== undefined) container.classList.add(cls);
    containerAnimationClass = cls;
  }

  /** Put the live slides into the container in key order (moves only what is out of place). */
  function syncChildren(): void {
    const { parentNode, nextSibling, insertBefore } = natives;
    let ref: Node | null = null;
    for (let i = slides.length - 1; i >= 0; i--) {
      const el = slides[i].el;
      if (parentNode.call(el) !== container || nextSibling.call(el) !== ref) insertBefore.call(container, el, ref);
      ref = el;
    }
  }

  /** Dispose and detach every slide `drop` selects (never the active one). */
  function dropSlides(drop: (record: SlideRecord) => boolean): void {
    for (let i = slides.length - 1; i >= 0; i--) {
      const record = slides[i];
      if (record.key === currentKey || !drop(record)) continue;
      slides.splice(i, 1);
      record.dispose();
      if (natives.parentNode.call(record.el) === container) natives.removeChild.call(container, record.el);
    }
  }

  function settleSlides(active: SlideRecord): void {
    for (const record of slides) setSlideState(record, record === active ? ACTIVE_SLIDE_CLASS_NAME : INACTIVE_SLIDE_CLASS_NAME);
    setContainerAnimation(undefined);
    setFromKey(undefined);
  }

  /** The step is over (end event, instant switch, mount): cleanup policy, height restore. */
  function settle(): void {
    if (props.shouldCleanup) {
      const only = props.cleanupOnlyKey;
      const except = props.cleanupExceptionKey;
      dropSlides((record) => (only !== undefined ? record.key === only : record.key !== except));
    }
    if (props.shouldRestoreHeight) scheduleRestoreHeight();
  }

  /** Measure the active slide (or `contentSelector` inside it) in the forced-reflow phase, write the container's height in its mutate step. */
  function scheduleRestoreHeight(): void {
    const key = currentKey;
    requestForcedReflow(() => {
      if (disposed || key !== currentKey) return undefined;
      const record = findSlide(key);
      if (record === undefined) return undefined;
      const selector = props.contentSelector;
      const target = selector ? (natives.querySelectorAll.element.call(record.el, selector)[0] as HTMLElement | undefined) : record.el;
      if (target === undefined) return undefined;
      const height = target.clientHeight;
      return () => {
        if (disposed) return;
        setExtraStyles(container, { height: `${height}px`, flexBasis: `${height}px` });
        setExtraStyles(record.el, { height: 'auto' });
      };
    });
  }

  function forget(step: Step): void {
    const i = inFlight.indexOf(step);
    if (i !== -1) inFlight.splice(i, 1);
    if (running === step) running = undefined;
  }

  /** The end of `step`'s animation, in the mutate phase. */
  function finish(step: Step): void {
    step.endHeavyAnimation(); // always: the scope must not stay animating for a superseded step
    forget(step);
    if (disposed || step.seq !== stepSeq) return; // superseded: the later step finishes the classes
    settleSlides(step.to);
    settle();
    callback(props.onStop, 'onStop');
  }

  /** A non-animated switch during `step`: stop it now so no class or scope stays stuck. */
  function interrupt(step: Step): void {
    step.cancelWait();
    step.endHeavyAnimation();
    forget(step);
    callback(props.onStop, 'onStop');
  }

  function applyStep(key: number, prevKey: number | undefined): void {
    currentKey = key;
    setActiveKey(key);
    const next = findSlide(key)!;
    if (prevKey === undefined) {
      // Mount: the active slide, no animation.
      setSlideState(next, ACTIVE_SLIDE_CLASS_NAME);
      syncChildren();
      settle();
      return;
    }
    const prev = findSlide(prevKey);
    // Keep-alive: without renderCount/shouldCleanup only the previous and the new slide live on.
    if (!props.renderCount && !props.shouldCleanup) dropSlides((record) => record !== prev);
    const name = props.name;
    if (name === 'none' || props.disableAnimation) {
      if (running !== undefined) interrupt(running);
      settleSlides(next);
      syncChildren();
      settle();
      return;
    }
    const step: Step = { seq: ++stepSeq, to: next, cancelWait: () => {}, endHeavyAnimation: () => {} };
    running = step; // a step still running is superseded: its end only releases its heavy animation
    inFlight.push(step);
    for (const record of slides) {
      setSlideState(record, record === next ? TO_SLIDE_CLASS_NAME : record === prev ? FROM_SLIDE_CLASS_NAME : INACTIVE_SLIDE_CLASS_NAME);
    }
    setContainerAnimation(`${CONTAINER_CLASS_NAME}-${name}${isForwards(props.direction, prevKey, key) ? '' : 'Backwards'}`);
    syncChildren();
    setFromKey(prevKey);
    step.endHeavyAnimation = scope.begin(Infinity, !!props.isBlockingAnimation);
    step.cancelWait = waitForAnimationEnd(next.el, () => requestMutation(() => finish(step)), { fallbackMs: ANIMATION_END_FALLBACK_MS });
    callback(props.onStart, 'onStart');
  }

  // ---- the component's own effects: under the ENCLOSING scope ----------------
  const own = createScope();
  compute(
    own,
    () => {
      provideHeavyAnimationScope(outerScope);
      createMutationEffect(
        () => {
          const key = props.activeKey;
          if (findSlide(key) === undefined) createSlide(key);
          return key;
        },
        applyStep,
        { name: 'transition.step' },
      );
      let restoreHeightRuns = 0;
      createEffect(
        () => props.restoreHeightKey,
        () => {
          // The first apply is the creation one (the mount already measured); re-measure on changes.
          if (restoreHeightRuns++ > 0 && props.shouldRestoreHeight) scheduleRestoreHeight();
        },
        undefined,
        { name: 'transition.restoreHeightKey' },
      );
      spread(container, props, true, isOwnProp);
    },
    null,
  );

  onCleanup(() => {
    disposed = true;
    for (const step of inFlight.splice(0)) {
      step.cancelWait();
      step.endHeavyAnimation();
    }
    running = undefined;
    for (const record of slides.splice(0)) record.dispose();
  });

  return container;
}
