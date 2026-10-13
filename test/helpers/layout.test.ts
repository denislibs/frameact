import { fakeLayout, resetLayout } from './layout';

// jsdom's own prototype members that the fake touches: resetLayout must put exactly those back.
const KEYS = ['offsetTop', 'offsetHeight', 'offsetParent', 'getBoundingClientRect'] as const;
const protos = () => [HTMLElement.prototype, HTMLDivElement.prototype, HTMLSpanElement.prototype, Element.prototype];

function snapshotDescriptors() {
  return protos().map((proto) => KEYS.map((key) => Object.getOwnPropertyDescriptor(proto, key)));
}

it('resetLayout restores the prototypes it overrode: jsdom\'s own members come back, the fake leaves nothing on any prototype', () => {
  const before = snapshotDescriptors();
  const scroller = document.createElement('div');
  document.body.append(scroller);
  fakeLayout(scroller);
  expect(Object.getOwnPropertyDescriptor(HTMLDivElement.prototype, 'offsetTop')).toBeDefined(); // the fake is in
  resetLayout();
  expect(snapshotDescriptors()).toEqual(before);
  const span = document.createElement('span');
  expect(span.offsetTop).toBe(0); // jsdom's native value, not undefined
  expect(document.createElement('div').offsetTop).toBe(0);
  scroller.remove();
});

it('fakeLayout twice and one reset leaves a clean prototype chain', () => {
  const before = snapshotDescriptors();
  const a = document.createElement('div');
  const b = document.createElement('div');
  fakeLayout(a);
  fakeLayout(b);
  resetLayout();
  expect(snapshotDescriptors()).toEqual(before);
});
