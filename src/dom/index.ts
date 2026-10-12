export { template, type TemplateFactory } from './template';
export { strictHooks } from './strict';
export {
  Properties, ChildProperties, BooleanAttributes, Aliases, getPropAlias, DelegatedEvents, SVGElements, SVGNamespace,
  DOMElements, SVG_NS,
} from './constants';
export { insert, type InsertOptions, type MountableElement } from './insert';
export { render } from './render';
export {
  createComponent, effect, memo, getOwner, claimElement, children, type Component, type ChildrenReturn,
} from './component';
export { mergeProps, type PropsSource } from './props';
