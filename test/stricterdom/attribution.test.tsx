import { beginHeavyAnimation, createMeasureEffect, createMutationEffect, createSignal, flushSync, onCleanup } from 'frameact';
import { delegateEvents, Dynamic, For, Portal, render, Show, Switch, Match } from 'frameact/dom';
import { createStore } from 'frameact/store';
import { disableStrict, enableStrict, setHandler, suppressStrict, type StrictViolationError } from 'frameact/stricterdom';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

let violations: StrictViolationError[];
const disposers: (() => void)[] = [];
beforeEach(() => {
  violations = [];
  // The compiled module registers its delegated events once, at load; the harness clears delegation after every test.
  delegateEvents(['click', 'input']);
  enableStrict();
  setHandler((error) => { violations.push(error); });
});
afterEach(async () => {
  for (const d of disposers.splice(0)) d();
  flushSync();
  await flushMicrotasks();
  setHandler();
  disableStrict();
});

const summary = (v: StrictViolationError) => `${v.kind}:${v.detail}:${v.phase}:${v.path ?? '-'}`;

/** `render()` into an attached container (the container's own append is a test-time write). */
function mount(code: () => unknown) {
  const el = suppressStrict(container);
  disposers.push(render(code, el));
  return el;
}

function type(input: HTMLInputElement, value: string, caret = value.length) {
  input.value = value;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

// ---- attribution through the compiler's sourceNames -------------------------------------------

function MessageMeta(props: { t: () => string }) {
  return <span class="meta" style={{ color: props.t() }}>{props.t()}</span>;
}

function Message(props: { color: () => string }) {
  return (
    <div class="message">
      <span>text</span>
      <MessageMeta t={props.color} />
    </div>
  );
}

it('a layout read inside a compiled binding is attributed `Component > Child > element.binding [mutate]`', () => {
  const [tint, setTint] = createSignal('red');
  let meta!: HTMLElement;
  const el = mount(() => <Message color={() => (tint() === 'red' ? 'red' : `rgb(${meta.offsetWidth},0,0)`)} />);
  meta = el.querySelector('.meta')!;
  expect(violations).toEqual([]);
  setTint('measured');
  flushSync();
  // the style effect and the insert effect of MessageMeta both read the prop (compiler order: children first)
  expect(violations.map(summary)).toEqual([
    'measure:offsetWidth:mutate:Message > MessageMeta > span.children',
    'measure:offsetWidth:mutate:Message > MessageMeta > span.style:color',
  ]);
  expect(violations[1].message).toBe(
    '[frameact/stricterdom] Unexpected measurement `offsetWidth` in Message > MessageMeta > span.style:color [mutate]',
  );
});

it('an event handler that writes the DOM directly is reported as a mutation outside an effect; writing a signal instead is fine', async () => {
  const [on, setOn] = createSignal(false);
  const el = mount(() => (
    <div>
      <button id="direct" onClick={(e) => { e.currentTarget.classList.add('clicked'); }} />
      <button id="signal" class={{ on: on() }} onClick={() => setOn(true)} />
    </div>
  ));
  (el.querySelector('#direct') as HTMLButtonElement).click();
  await flushMicrotasks();
  expect(violations.map(summary)).toEqual(['mutation:class:measure:-']);
  expect(violations[0].message).toBe('[frameact/stricterdom] Unexpected mutation `class` of <button id="direct" class="clicked"> outside an effect [measure]');
  violations.length = 0;
  (el.querySelector('#signal') as HTMLButtonElement).click();
  await frame();
  expect(el.querySelector('#signal')!.className).toBe('on');
  expect(violations).toEqual([]);
});

// ---- the runtime's own phase discipline (spec §5: "render into an attached container gives no error") ----

interface Item { id: number; label: string }

interface Chat { title: string; tags: string[] }
type ChatView = { readonly title: string; readonly tags: readonly string[] };

function App(props: { items: () => Item[]; mode: () => 'list' | 'grid' | 'none'; text: () => string; setText: (s: string) => void; chat: ChatView }) {
  const [portalOpen, setPortalOpen] = createSignal(true);
  const text = props.text; // a plain identifier: `use:value={text}` compiles to the static (accessor) form
  let box!: HTMLDivElement;
  const [h, setH] = createSignal(0);
  onCleanup(() => setPortalOpen(false));
  const view = (
    <div ref={(el) => { box = el; }} class="app" classList={{ grid: props.mode() === 'grid' }} data-count={props.items().length}>
      <h1 class={{ long: props.chat.title.length > 3 }}>{props.chat.title}</h1>
      <For each={props.chat.tags}>{(tag) => <b>{tag}</b>}</For>
      <input use:value={text} onInput={(e) => props.setText(e.currentTarget.value.trimStart().toUpperCase())} />
      <Switch fallback={<p>none</p>}>
        <Match when={props.mode() === 'list'}>
          <ul>
            <For each={props.items()}>{(item) => <li class={{ odd: item.id % 2 === 1 }}>{item.label}</li>}</For>
          </ul>
        </Match>
        <Match when={props.mode() === 'grid'}>
          <For each={props.items()} order="manual" orderKey={(item) => item.id}>
            {(item, i) => <div style={{ transform: `translateY(${i() * 10}px)` }}>{item.label}</div>}
          </For>
        </Match>
      </Switch>
      <Show when={props.items().length > 2}>
        <Dynamic component={props.mode() === 'grid' ? 'section' : 'aside'}>many</Dynamic>
      </Show>
      <Show when={portalOpen()}>
        <Portal>
          <div class="toast">
            {props.text()}
            <Portal><i class="tip" /></Portal>
          </div>
        </Portal>
      </Show>
    </div>
  );
  // after the JSX: `box` is assigned by the ref, and a mutation effect's first apply is synchronous
  createMeasureEffect(() => props.items().length, () => { setH(box.offsetHeight); }); // layout in measure: allowed
  createMutationEffect(() => h(), (v) => { box.style.minHeight = `${v}px`; });
  return view;
}

it('a full app — render, For (keyed and manual), Show/Switch/Dynamic/Portal (nested), use:value, class/style/attr bindings, measure + mutate effects, heavy-animation parking, dispose — produces no violation', async () => {
  const [items, setItems] = createSignal<Item[]>([{ id: 1, label: 'a' }, { id: 2, label: 'b' }]);
  const [mode, setMode] = createSignal<'list' | 'grid' | 'none'>('list');
  const [text, setText] = createSignal('');
  const [chat, setChat] = createStore<Chat>({ title: 'ab', tags: ['x'] });
  const el = mount(() => <App items={items} mode={mode} text={text} setText={setText} chat={chat} />);
  await frame(); // first measure apply
  expect(el.querySelectorAll('li').length).toBe(2);
  expect(document.querySelector('.toast')).not.toBeNull();
  expect(document.querySelector('.tip')).not.toBeNull(); // a Portal inside a Portal: both sanction <body>

  setItems([{ id: 3, label: 'c' }, ...items()]);
  await frame();
  setMode('grid');
  await frame();
  setItems([items()[1], items()[0], items()[2], { id: 4, label: 'd' }]); // manual order: moves + append
  await frame();
  expect(el.querySelector('section')).not.toBeNull();

  const input = el.querySelector('input')!;
  type(input, ' hi'); // rejected (trimStart) → synchronous rollback before paint; then formatted (upper case)
  await frame();
  expect(input.value).toBe('HI');
  type(input, 'HI!');
  await frame();
  expect(document.querySelector('.toast')!.textContent).toBe('HI!');

  const end = beginHeavyAnimation(300, true);
  setMode('none');
  setItems([]);
  setChat('title', 'abcd'); // store writes: the store gate parks their readers, release drains them in a measure task
  setChat('tags', (tags) => [...tags, 'y']);
  await frame(); // parked
  expect(el.querySelector('p')).toBeNull();
  expect(el.querySelector('h1')!.textContent).toBe('ab');
  end();
  await frame(); // released: measure then mutate in one frame
  expect(el.querySelector('p')!.textContent).toBe('none');
  expect(el.querySelector('h1')!.textContent).toBe('abcd');
  expect(el.querySelector('h1')!.className).toBe('long');
  expect([...el.querySelectorAll('b')].map((b) => b.textContent)).toEqual(['x', 'y']);

  for (const d of disposers.splice(0)) d();
  await frame();
  expect(el.innerHTML).toBe('');
  expect(document.querySelector('.toast')).toBeNull();
  expect(document.querySelector('.tip')).toBeNull();
  await flushMicrotasks();
  expect(violations.map(summary)).toEqual([]);
});

it('selectionStart may be read at event time, never in a mutation apply (the directive snapshots it for the applier)', async () => {
  const [text, setText] = createSignal('');
  let caretInMutate = -1;
  const el = mount(() => {
    const input = (<input use:value={text} onInput={(e) => setText(e.currentTarget.value)} />) as HTMLInputElement;
    createMutationEffect(() => text(), () => { caretInMutate = input.selectionStart ?? -1; }); // first apply: creation, measure phase
    return input;
  });
  const input = el.querySelector('input')!;
  type(input, 'ab', 1);
  await frame();
  expect(caretInMutate).toBe(1);
  expect(violations.map(summary)).toEqual(['measure:selectionStart:mutate:mutation']);
});
