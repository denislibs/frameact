import { getRunningEffect } from '../../src/core/effects';
import { createEffect, createMutationEffect, createRoot, createSignal, flushSync, requestMeasure, requestMutation } from '../../src/index';
import { flushSync as flushFrame } from '../../src/scheduler/fasterdom';
import { createComponent } from '../../src/dom/component';
import { render } from '../../src/dom/render';
import { Portal } from '../../src/dom/flow';
import { strictHooks } from '../../src/dom/strict';
import {
  disableStrict, enableStrict, forceMeasure, forceMutation, IGNORE_SUBTREE_ATTR, isStrictEnabled, setHandler,
  StrictViolationError, suppressStrict,
} from '../../src/stricterdom/stricterdom';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();
// captured before any enableStrict(): jsdom's methods are JS, so "native code" cannot be checked
const NATIVE_GBCR = Element.prototype.getBoundingClientRect;

let violations: StrictViolationError[];
const disposers: (() => void)[] = [];
beforeEach(() => {
  violations = [];
  enableStrict();
  setHandler((error) => { violations.push(error); });
});
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  flushSync();
  setHandler();
  disableStrict();
});

/** An attached container, appended under suppressStrict: the append itself would be a violation (phase: measure). */
function attached(): HTMLDivElement {
  return suppressStrict(container);
}

/** A root disposed after the test. */
function testRoot(fn: () => void) {
  createRoot((dispose) => {
    disposers.push(dispose);
    fn();
  });
}

const summary = (v: StrictViolationError) => `${v.kind}:${v.detail}:${v.phase}:${v.path ?? '-'}`;

/** What `<img name="…">` does to `document` in a browser (jsdom has no named properties): an own shadow of a builtin. */
function shadow(name: string) {
  Object.defineProperty(document, name, { value: Document.prototype.createElement.call(document, 'img'), configurable: true });
}

it('enableStrict patches the layout getters/methods on the prototypes; disableStrict restores the natives', () => {
  const patched = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get!;
  const patchedMethod = Element.prototype.getBoundingClientRect;
  expect(isStrictEnabled()).toBe(true);
  // a setter next to a patched getter survives (scrollTop is read-write)
  expect(typeof Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!.set).toBe('function');
  disableStrict();
  expect(isStrictEnabled()).toBe(false);
  expect(Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!.get).not.toBe(patched);
  expect(Element.prototype.getBoundingClientRect).not.toBe(patchedMethod);
  expect(Element.prototype.getBoundingClientRect).toBe(NATIVE_GBCR);
  enableStrict(); // idempotent with the afterEach
  enableStrict();
});

it('a layout read in the measure phase (idle, event handlers) is fine; in a mutation apply it is a violation with the effect path', () => {
  const el = attached();
  void el.offsetHeight;
  void el.getBoundingClientRect();
  expect(violations).toEqual([]);
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createComponent(
      () => {
        createMutationEffect(() => n(), (v) => { if (v) void el.offsetHeight; }, { name: 'div.style:height' });
        return null;
      },
      {},
      'Panel',
    );
  });
  setN(1);
  flushSync();
  expect(violations.map(summary)).toEqual(['measure:offsetHeight:mutate:Panel > div.style:height']);
  expect(violations[0].message).toBe(
    '[frameact/stricterdom] Unexpected measurement `offsetHeight` in Panel > div.style:height [mutate]',
  );
  expect(violations[0]).toBeInstanceOf(Error);
  expect(violations[0].name).toBe('StrictViolationError');
});

it('selectionStart, focus() and getComputedStyle in the mutate phase are violations; a raw requestMutation task has no path', () => {
  const input = document.createElement('input');
  suppressStrict(() => document.body.appendChild(input));
  requestMutation(() => {
    void input.selectionStart;
    input.focus();
    void getComputedStyle(input);
  });
  flushSync();
  expect(violations.map(summary)).toEqual([
    'measure:selectionStart:mutate:-', 'measure:focus:mutate:-', 'measure:getComputedStyle:mutate:-',
  ]);
  expect(violations[0].message).toBe('[frameact/stricterdom] Unexpected measurement `selectionStart` outside an effect [mutate]');
});

it('a live-DOM write outside the mutate phase is reported through the observer with the target; writes in the mutate phase are not', async () => {
  const el = attached();
  el.setAttribute('class', 'x'); // event-handler time: phase is measure
  await flushMicrotasks();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  expect(violations[0].target).toBe(el);
  expect(violations[0].message).toBe('[frameact/stricterdom] Unexpected mutation `class` of <div class="x"> outside an effect [measure]');
  violations.length = 0;
  requestMutation(() => {
    el.setAttribute('class', 'y');
    el.appendChild(document.createElement('span'));
  });
  await frame(); // a real frame pass: records are drained at the mutate → measure change
  await flushMicrotasks();
  expect(violations).toEqual([]);
});

it('a mutation effect writing in flushSync is not a false positive (records are judged at the phase change, not when the observer fires)', async () => {
  const el = document.createElement('div'); // detached at creation, as the runtime builds subtrees
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createMutationEffect(() => n(), (v) => { el.setAttribute('data-n', String(v)); el.className = `n${v}`; });
  });
  forceMutation(() => document.body.appendChild(el), document.body); // the mount
  setN(1);
  flushSync();
  await flushMicrotasks();
  expect(violations).toEqual([]);
  // ...while a measure task writing in the same flushSync is caught, as 'measure'
  requestMeasure(() => { el.className = 'bad'; });
  flushSync();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
});

it('detached subtrees may be built in any phase; the exceptions: data-*, data-stricterdom-ignore subtrees, details[open], childList inside contentEditable', async () => {
  const el = attached();
  const detached = document.createElement('div');
  detached.className = 'a';
  detached.appendChild(document.createElement('b'));
  el.setAttribute('data-state', 'open');
  const ignored = document.createElement('div');
  ignored.setAttribute(IGNORE_SUBTREE_ATTR, '');
  el.appendChild(ignored); // (this append is itself a violation on `el`: see below)
  await flushMicrotasks();
  violations.length = 0;
  ignored.appendChild(document.createElement('p'));
  ignored.firstElementChild!.className = 'editor';
  const details = document.createElement('details');
  el.appendChild(details);
  await flushMicrotasks();
  violations.length = 0;
  details.open = true;
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', '');
  el.appendChild(editor);
  await flushMicrotasks();
  violations.length = 0;
  editor.appendChild(document.createTextNode('typed')); // the engine's edit
  editor.setAttribute('class', 'focused'); // an attribute write is still a violation
  await flushMicrotasks();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
});

it('forceMutation sanctions writes to the given nodes in the measure phase; it refuses the mutate phase unless allowAnyPhase', () => {
  const el = attached();
  const other = attached();
  forceMutation(() => {
    el.className = 'mounted';
    other.className = 'collateral';
  }, el);
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  expect(violations[0].target).toBe(other);
  violations.length = 0;
  forceMutation(() => { el.className = 'x'; other.className = 'y'; }, [el, other]);
  expect(violations).toEqual([]);
  // a nested sanction of the same node (a Portal inside a Portal, both into <body>) keeps the outer one in force
  forceMutation(() => {
    forceMutation(() => { el.className = 'inner'; }, el);
    el.className = 'outer, after the inner one';
  }, el);
  expect(violations).toEqual([]);
  let refused: unknown;
  let allowed = false;
  requestMutation(() => {
    try { forceMutation(() => {}, el); } catch (error) { refused = error; }
    forceMutation(() => { allowed = true; }, el, true);
  });
  flushSync();
  expect(String(refused)).toContain("the current phase is 'mutate' already");
  expect(allowed).toBe(true);
});

it('forceMeasure opens a layout-read window inside the mutate phase; a write inside it is a violation; elsewhere it is a plain call', () => {
  const el = attached();
  let read = -1;
  requestMutation(() => {
    read = forceMeasure(() => el.offsetHeight);
    el.className = 'legit'; // after the window: mutate again
    forceMeasure(() => { el.className = 'inside'; });
  });
  flushSync();
  expect(read).toBe(0);
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  // outside the mutate phase (event handlers, measure tasks — kit helpers run in both): no error, no window
  violations.length = 0;
  expect(forceMeasure(() => el.offsetWidth)).toBe(0);
  let inMeasureTask = -1;
  requestMeasure(() => { inMeasureTask = forceMeasure(() => el.clientWidth); });
  flushSync();
  expect(inMeasureTask).toBe(0);
  expect(violations).toEqual([]);
});

it('suppressStrict silences both checks for its callback (re-entrant); violations before it are still reported', async () => {
  const el = attached();
  el.className = 'before';
  requestMutation(() => {
    suppressStrict(() => {
      void el.offsetHeight;
      suppressStrict(() => { void el.getBoundingClientRect(); });
      void el.offsetWidth;
    });
    void el.clientWidth; // outside again
  });
  const result = suppressStrict(() => {
    el.className = 'suppressed';
    return 42;
  });
  flushSync();
  await flushMicrotasks();
  expect(result).toBe(42);
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-', 'measure:clientWidth:mutate:-']);
  // strict switched off and on inside a window: the window still closes cleanly, later windows still suppress
  suppressStrict(() => disableStrict());
  enableStrict();
  suppressStrict(() => { el.className = 'quiet'; });
  await flushMicrotasks();
  expect(violations).toHaveLength(2);
});

it('setHandler() without a handler restores console.error; a throwing handler reaches the caller of a layout read', () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  setHandler();
  const el = attached();
  requestMutation(() => { void el.offsetHeight; });
  flushSync();
  expect(err).toHaveBeenCalledTimes(1);
  expect(err.mock.calls[0][0]).toBeInstanceOf(StrictViolationError);
  setHandler((error) => { throw error; });
  let thrown: unknown;
  requestMutation(() => {
    try { void el.offsetHeight; } catch (error) { thrown = error; }
  });
  flushSync();
  expect(thrown).toBeInstanceOf(StrictViolationError);
});

it('render() into an attached container and Portal go through the seam: no violation; the seam is restored by disableStrict', async () => {
  const el = attached();
  const [n, setN] = createSignal(0);
  const dispose = render(() => {
    const span = document.createElement('span');
    createMutationEffect(() => n(), (v) => { span.textContent = String(v); });
    return [span, createComponent(Portal, { get children() { return document.createElement('i'); } })];
  }, el);
  disposers.push(dispose);
  await flushMicrotasks();
  expect(el.innerHTML).toBe('<span>0</span>');
  expect(document.body.querySelector('i')).not.toBeNull();
  setN(1);
  flushSync();
  await flushMicrotasks();
  expect(violations).toEqual([]);
  dispose();
  flushSync();
  await flushMicrotasks();
  expect(el.innerHTML).toBe('');
  expect(violations).toEqual([]);
  disableStrict();
  expect(strictHooks.forceMutation(() => 'plain', el)).toBe('plain');
});

it('a tickEnd effect writing the live DOM is reported synchronously after its apply, attributed to it', () => {
  const el = attached();
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createComponent(
      () => {
        createEffect(() => n(), (v) => { el.title = `t${v}`; }, undefined, { name: 'logic' });
        return null;
      },
      {},
      'Sidebar',
    );
  });
  flushSync(); // the first (scheduled) apply of a tickEnd effect
  expect(violations.map(summary)).toEqual(['mutation:title:measure:Sidebar > logic']);
  expect(violations[0].message).toBe('[frameact/stricterdom] Unexpected mutation `title` of <div> in Sidebar > logic [measure]');
  violations.length = 0;
  setN(1);
  flushSync();
  expect(violations.map(summary)).toEqual(['mutation:title:measure:Sidebar > logic']);
});

it('a write pending when an apply starts is not attributed to that effect (a handler writes a signal, then the DOM)', () => {
  const el = attached();
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createComponent(
      () => {
        createEffect(() => n(), () => {}, undefined, { name: 'logic' });
        return null;
      },
      {},
      'Sidebar',
    );
  });
  flushSync();
  setN(1);
  el.className = 'pressed';
  // the tickEnd drain runs before the observer callback (Chrome's microtask order; flushSync reproduces it here)
  flushSync();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  // ...and a raw measure task's write is not attributed to the measure effect that applies after it
  violations.length = 0;
  requestMeasure(() => { el.title = 'raw'; });
  testRoot(() => {
    createComponent(
      () => {
        createEffect(() => n(), () => {}, (run) => requestMeasure(run), { name: 'measured' });
        return null;
      },
      {},
      'Panel',
    );
  });
  flushFrame();
  expect(violations.map(summary)).toEqual(['mutation:title:measure:-']);
});

it('document clobbering (content-named `contains` / `body` on document) does not break the checks', async () => {
  const el = attached();
  shadow('contains');
  shadow('body');
  try {
    el.className = 'x';
    await flushMicrotasks();
    expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
    disableStrict();
    enableStrict(); // finds the real <body> through the natives
    el.className = 'y';
    await flushMicrotasks();
    expect(violations.map(summary)).toEqual(['mutation:class:measure:-', 'mutation:class:measure:-']);
  } finally {
    delete (document as { contains?: unknown }).contains;
    delete (document as { body?: unknown }).body;
  }
});

it('a throwing console.error (a "fail on console" setup) with the default handler leaves no effect swapped in and breaks no flush', async () => {
  const el = attached();
  setHandler(); // the default handler: console.error(error)
  vi.spyOn(console, 'error').mockImplementation(() => { throw new Error('console.error is forbidden'); });
  const [n, setN] = createSignal(0);
  testRoot(() => {
    createEffect(() => n(), (v) => { el.className = `c${v}`; }, undefined, { name: 'logic' });
  });
  expect(() => flushSync()).not.toThrow(); // the violation is reported inside the apply hook, which must contain a throwing handler
  expect(getRunningEffect()).toBeNull();
  setN(1);
  expect(() => flushSync()).not.toThrow();
  expect(getRunningEffect()).toBeNull();
  await flushMicrotasks();
  expect(el.className).toBe('c1'); // the applies ran
});
