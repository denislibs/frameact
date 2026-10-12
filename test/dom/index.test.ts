import * as dom from '../../src/dom/index';

it('exports the compiler contract (every name the 2.0 compiler imports from moduleName) and the author API', () => {
  const compiler = [
    'template', 'insert', 'effect', 'memo', 'createComponent', 'spread', 'assign', 'mergeProps',
    'setAttribute', 'setAttributeNS', 'setProperty', 'setBoolAttribute', 'className', 'style', 'setStyleProperty',
    'addEvent', 'delegateEvents', 'ref', 'applyRef', 'use', 'readShallow', 'getOwner', 'claimElement',
    'For', 'Show', 'Switch', 'Match', 'Portal', 'Dynamic',
  ];
  const authors = [
    'render', 'children', 'HeavyAnimationScope', 'defineDirective', 'clearDelegatedEvents',
    'addExtraClass', 'removeExtraClass', 'toggleExtraClass', 'setExtraStyles', 'classList', 'lazy', 'splitProps',
  ];
  for (const name of [...compiler, ...authors]) {
    expect(typeof (dom as Record<string, unknown>)[name], name).toBe('function');
  }
});

it('the policy tables are not part of the public surface (a live Set could be mutated to change the policy)', () => {
  for (const name of [
    'Properties', 'ChildProperties', 'BooleanAttributes', 'Aliases', 'DelegatedEvents', 'SVGElements', 'SVGNamespace',
    'DOMElements', 'getPropAlias',
  ]) {
    expect(name in dom, name).toBe(false);
  }
});
