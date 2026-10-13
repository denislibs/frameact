// frameact/kit — the client-readiness kit (plan 6): the thin UI layer a Telegram Web A–class client
// needs before its main screens. Components here carry CSS class contracts (the client brings the
// stylesheet, e.g. telegram-tt's Transition.scss); the core primitives they build on live in
// `frameact` (onMount, previous, …) and `frameact/dom` (lazy, splitProps).
export { waitForAnimationEnd, waitForTransitionEnd, type WaitForEndOptions } from './animationEnd';
export {
  createShowTransition, createMediaTransition, ShowTransition,
  type ShowTransitionOptions, type ShowTransitionResult, type ShowTransitionState, type ShowTransitionProps,
  type MediaTransitionOptions,
} from './showTransition';
export {
  Transition, ACTIVE_SLIDE_CLASS_NAME, TO_SLIDE_CLASS_NAME,
  type TransitionProps, type TransitionSlide, type TransitionDirection,
} from './transition';
export { createScrollAnchor, type ScrollAnchor, type ScrollAnchorOptions } from './scrollAnchor';
export { InfiniteScroll, type InfiniteScrollProps, type LoadMoreDirection } from './infiniteScroll';
