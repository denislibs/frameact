// frameact/dom — the runtime the compiler targets (`moduleName: "frameact/dom"`) plus render, the
// flow components, controlled-input directives and imperative helpers (spec §3.3).
export { template, type TemplateFactory } from './template';
export { strictHooks } from './strict';
// The policy tables (Properties, ChildProperties, Aliases, DelegatedEvents, SVGElements, SVGNamespace, …)
// stay private: the compiler imports none of them, and a live Set/object exported from here could be
// mutated by any code in the bundle to change what `spread`/`setAttribute` do (`Properties.add('href')`
// routes `href` into a raw property write, past the URL policy).
export { SVG_NS } from './constants';
export { insert, type InsertOptions, type MountableElement } from './insert';
export { render } from './render';
export {
  createComponent, effect, memo, getOwner, claimElement, children, type Component, type ChildrenReturn,
} from './component';
export { mergeProps, splitProps, spread, assign, ref, applyRef, readShallow, type PropsSource } from './props';
export { lazy, type ComponentProps, type LazyComponent, type LazyOptions } from './lazy';
export { For, type ForBaseProps, type Accessor, type Each } from './list';
export { ManualFor, type ManualForBaseProps } from './manualFor';
export {
  className, classList, toggleClassToken, classTokens, addExtraClass, removeExtraClass, toggleExtraClass,
} from './classes';
export { style, setStyleProperty, setExtraStyles } from './styles';
export { setAttribute, setAttributeNS, setBoolAttribute, setProperty } from './attributes';
export { addEvent, delegateEvents, clearDelegatedEvents, setListener, EVENT_KEY } from './events';
export { defineDirective, use, type Directive } from './directives';
export { forceControlledValue, isForcingControlledValue, registerControlledDirectives } from './controlled';
export { Show, Switch, Match, Dynamic, Portal, type MatchProps } from './flow';
export { HeavyAnimationScope } from './scope';
