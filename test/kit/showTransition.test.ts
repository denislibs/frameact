import { createRoot, createSignal, flushSync } from '../../src/index';
import { createComponent } from '../../src/dom/component';
import { insert } from '../../src/dom/insert';
import { createMediaTransition, createShowTransition, ShowTransition } from '../../src/kit/showTransition';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

afterEach(() => {
  vi.useRealTimers();
});

const classes = (el: Element) => Array.from(el.classList).join(' ');

it('opens through scheduled-open: the element attaches with not-open, flips to open in the next frame; closes after closeDuration', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const root = container();
  const [open, setOpen] = createSignal(false);
  const states: string[] = [];
  let t!: ReturnType<typeof createShowTransition>;
  createRoot(() => {
    t = createShowTransition({ isOpen: open, closeDuration: 350, onCloseAnimationEnd: () => states.push('closed-cb') });
    insert(root, () => {
      if (!t.shouldRender()) return undefined;
      const el = document.createElement('div');
      t.ref(el);
      return el;
    });
  });
  expect(root.innerHTML).toBe('');
  expect(t.state()).toBe('closed');
  setOpen(true);
  await flushMicrotasks(); // tickEnd: the state machine
  expect(t.state()).toBe('scheduled-open');
  expect(t.shouldRender()).toBe(true);
  await frame(); // mutate: the div is created and attached with its initial classes
  const el = root.firstElementChild!;
  expect(classes(el)).toBe('opacity-transition fast shown not-open');
  await frame(); // measure: scheduled-open → open; mutate: the class
  expect(t.state()).toBe('open');
  expect(classes(el)).toBe('opacity-transition fast shown open');
  setOpen(false);
  await flushMicrotasks();
  expect(t.state()).toBe('closing');
  expect(t.isClosing()).toBe(true);
  await frame();
  expect(classes(el)).toBe('opacity-transition fast shown not-open closing');
  expect(root.firstElementChild).toBe(el); // still rendered
  vi.advanceTimersByTime(349);
  expect(t.state()).toBe('closing');
  vi.advanceTimersByTime(1);
  expect(t.state()).toBe('closed');
  expect(states).toEqual(['closed-cb']);
  await frame();
  expect(root.innerHTML).toBe('');
});

it('noMountTransition starts open; re-opening while closing cancels the timer; noCloseTransition closes at once; forceOpen wins', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const [open, setOpen] = createSignal(true);
  const [noClose, setNoClose] = createSignal(false);
  const [force, setForce] = createSignal(false);
  let t!: ReturnType<typeof createShowTransition>;
  const el = document.createElement('div');
  createRoot(() => {
    t = createShowTransition({ isOpen: open, noMountTransition: true, noCloseTransition: noClose, forceOpen: force, className: false, prefix: 'x-' });
    t.ref(el);
  });
  expect(t.state()).toBe('open');
  expect(classes(el)).toBe('x-shown x-open'); // className false: no opacity-transition
  setOpen(false);
  flushSync();
  expect(t.state()).toBe('closing');
  setOpen(true);
  await flushMicrotasks(); // (flushSync() would settle the whole open sequence at once)
  expect(t.state()).toBe('scheduled-open');
  vi.advanceTimersByTime(1000);
  expect(t.state()).toBe('scheduled-open'); // the close timer was cancelled
  await frame(); // the not-open class, the flip booked
  await frame(); // the flip
  expect(t.state()).toBe('open');
  setNoClose(true);
  setOpen(false);
  flushSync();
  expect(t.state()).toBe('closed');
  setForce(true);
  flushSync();
  expect(t.state()).toBe('open');
  setForce(false);
  flushSync();
  expect(t.state()).toBe('closed'); // isOpen is false, noCloseTransition
});

it('createMediaTransition: no mount transition when the data is already there, the slow class', () => {
  const [has] = createSignal(true);
  const el = document.createElement('img');
  createRoot(() => {
    const t = createMediaTransition({ hasMediaData: has });
    t.ref(el);
    expect(t.state()).toBe('open');
  });
  expect(classes(el)).toBe('opacity-transition slow shown open');
});

it('<ShowTransition>: a div with the rest props spread, children kept while closing, removed after; isHidden keeps it closed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const root = container();
  const [open, setOpen] = createSignal(true);
  const [hidden, setHidden] = createSignal(false);
  const [text, setText] = createSignal('a');
  const clicks = vi.fn();
  const refs: Element[] = [];
  createRoot(() => {
    insert(
      root,
      createComponent(ShowTransition, {
        get isOpen() { return open(); },
        get isHidden() { return hidden(); },
        id: 'panel',
        get class() { return `panel ${text()}`; },
        onClick: clicks,
        ref: (el: HTMLDivElement) => refs.push(el),
        get children() {
          const b = document.createElement('b');
          insert(b, () => text());
          return b;
        },
      }),
    );
  });
  const el = root.firstElementChild as HTMLDivElement;
  expect(el.id).toBe('panel');
  expect(classes(el)).toBe('opacity-transition fast shown open panel a'); // open at once: no first-render animation
  expect(el.innerHTML).toBe('<b>a</b>');
  expect(refs).toEqual([el]);
  el.click();
  expect(clicks).toHaveBeenCalledTimes(1);
  setText('b');
  await frame();
  expect(el.innerHTML).toBe('<b>b</b>');
  expect(el.classList.contains('b')).toBe(true);
  setOpen(false);
  await flushMicrotasks();
  await frame();
  expect(el.classList.contains('closing')).toBe(true);
  expect(el.innerHTML).toBe('<b>b</b>'); // children stay while closing
  vi.advanceTimersByTime(350);
  await frame();
  expect(root.innerHTML).toBe('');
  setOpen(true);
  setHidden(true);
  await flushMicrotasks();
  await frame();
  const again = root.firstElementChild!;
  expect(classes(again)).toBe('opacity-transition fast not-shown not-open panel b'); // rendered because isHidden, but closed
});

it('<ShowTransition>: isHidden toggled while open keeps the same element through closing and closed', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const root = container();
  const [hidden, setHidden] = createSignal(false);
  let made = 0;
  createRoot(() => {
    insert(
      root,
      createComponent(ShowTransition, {
        isOpen: true,
        get isHidden() { return hidden(); },
        get children() {
          made++;
          return document.createElement('b');
        },
      }),
    );
  });
  const el = root.firstElementChild!;
  expect(made).toBe(1); // created once (the DEV children check reads the descriptor, not the getter)
  setHidden(true);
  await flushMicrotasks();
  await frame();
  expect(root.firstElementChild).toBe(el);
  expect(el.classList.contains('closing')).toBe(true);
  vi.advanceTimersByTime(350);
  await frame();
  expect(root.firstElementChild).toBe(el); // closed but kept: isHidden
  expect(el.classList.contains('not-shown')).toBe(true);
  expect(el.classList.contains('closing')).toBe(false);
  expect(made).toBe(1);
});

it('disposal while closing or scheduled-open: no close callback, no state change, no class write after it (clean-room finding 5)', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const [open, setOpen] = createSignal(true);
  const ends = vi.fn();
  const el = document.createElement('div');
  let t!: ReturnType<typeof createShowTransition>;
  const dispose = createRoot((d) => {
    t = createShowTransition({ isOpen: open, noMountTransition: true, onCloseAnimationEnd: ends });
    t.ref(el);
    return d;
  });
  setOpen(false);
  flushSync();
  expect(t.state()).toBe('closing');
  expect(classes(el)).toBe('opacity-transition fast shown not-open closing');
  dispose(); // inside the close timer
  vi.advanceTimersByTime(1000);
  setOpen(true);
  await frame();
  await frame();
  expect(ends).not.toHaveBeenCalled();
  expect(t.state()).toBe('closing'); // frozen where it was
  expect(classes(el)).toBe('opacity-transition fast shown not-open closing');

  const [open2, setOpen2] = createSignal(false);
  const el2 = document.createElement('div');
  let t2!: ReturnType<typeof createShowTransition>;
  const dispose2 = createRoot((d) => {
    t2 = createShowTransition({ isOpen: open2 });
    t2.ref(el2);
    return d;
  });
  setOpen2(true);
  await flushMicrotasks();
  expect(t2.state()).toBe('scheduled-open');
  await frame(); // not-open written, the flip booked for the next measure phase
  expect(classes(el2)).toBe('opacity-transition fast shown not-open');
  dispose2(); // before the flip
  await frame();
  await frame();
  expect(t2.state()).toBe('scheduled-open');
  expect(classes(el2)).toBe('opacity-transition fast shown not-open');
});

it('per-instance cost: creating an instance is a few microseconds (a regression bound; the measured numbers are in the clean-room report) (clean-room finding 7)', () => {
  const [open] = createSignal(true);
  const make = () => createShowTransition({ isOpen: open, noMountTransition: true });
  createRoot((d) => {
    for (let i = 0; i < 500; i++) make(); // warm-up
    d();
  });
  const n = 2000;
  const start = performance.now();
  const dispose = createRoot((d) => {
    for (let i = 0; i < n; i++) make();
    return d;
  });
  const perInstanceUs = ((performance.now() - start) * 1000) / n;
  dispose();
  // ≈ 1.5 µs in jsdom (2 signal nodes, 1 tickEnd effect, 1 mutation effect); the bound is an order
  // of magnitude up so that CI noise never trips it while an extra memo/effect per instance would show.
  expect(perInstanceUs).toBeLessThan(25);
});
