// Adapted from teact (MIT, © 2022 Alexander Zinchuk) — https://github.com/Ajaxy/teact src/lib/fasterdom/layoutCauses.ts
// The list of layout-forcing getters and methods: https://gist.github.com/paulirish/5d52fb081b3570c81e3a
// frameact adds `selectionStart`/`selectionEnd` (spec §3.3: the caret is read at event time, in the measure phase).

export interface LayoutCauses {
  props?: readonly string[];
  methods?: readonly string[];
}

/** Keys are global names (`globalThis[name]`): a constructor (its prototype is patched) or the `window` object itself. */
export const LAYOUT_CAUSES: Readonly<Record<string, LayoutCauses>> = {
  Element: {
    props: [
      'clientLeft', 'clientTop', 'clientWidth', 'clientHeight',
      'scrollWidth', 'scrollHeight', 'scrollLeft', 'scrollTop',
    ],
    methods: [
      'getClientRects', 'getBoundingClientRect',
      'scrollBy', 'scrollTo', 'scrollIntoView', 'scrollIntoViewIfNeeded',
    ],
  },
  HTMLElement: {
    props: [
      'offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight', 'offsetParent',
      'innerText',
    ],
    methods: ['focus'],
  },
  window: {
    props: [
      'scrollX', 'scrollY',
      'innerHeight', 'innerWidth',
    ],
    methods: ['getComputedStyle'],
  },
  VisualViewport: {
    props: [
      'height', 'width', 'offsetTop', 'offsetLeft',
    ],
  },
  Document: {
    props: ['scrollingElement'],
    methods: ['elementFromPoint'],
  },
  HTMLInputElement: {
    props: ['selectionStart', 'selectionEnd'],
    methods: ['select'],
  },
  HTMLTextAreaElement: {
    props: ['selectionStart', 'selectionEnd'],
  },
  MouseEvent: {
    props: ['layerX', 'layerY', 'offsetX', 'offsetY'],
  },
  Range: {
    methods: ['getClientRects', 'getBoundingClientRect'],
  },
};
