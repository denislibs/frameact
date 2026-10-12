// use:value bound directly to the store (spec §3.5 req. 7), inside a subtree whose non-blocking
// animation is running: accepted input is not rolled back, rejected input is restored, a programmatic
// write ("Send → clear") is delivered at once — in the accessor form and in the compiler's plain form,
// without live(). (The gate-free behaviour of both forms is covered by test/dom/controlled.test.ts.)
import { createHeavyAnimationScope, createRoot, provideHeavyAnimationScope } from '../../src/index';
import { setAttribute } from '../../src/dom/attributes';
import { effect } from '../../src/dom/component';
import { delegateEvents, EVENT_KEY } from '../../src/dom/events';
import { createStore } from 'frameact/store';
import { container, useDomHarness } from '../helpers/dom';
import { flushMicrotasks } from '../helpers/micro';

const { frame } = useDomHarness();

function textInput() {
  const input = document.createElement('input');
  container().appendChild(input);
  input.focus();
  return input;
}
function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}
async function settle() {
  await flushMicrotasks();
  await frame();
}

for (const form of ['accessor', 'plain'] as const) {
  it(`${form} form: accepted, rejected and programmatic store writes during an animation, no live() needed`, async () => {
    const [state, setState] = createStore({ draft: '', placeholder: 'p' });
    const scope = createHeavyAnimationScope();
    const input = textInput();
    createRoot(() => {
      provideHeavyAnimationScope(scope);
      if (form === 'accessor') setAttribute(input, 'use:value', () => state.draft);
      else {
        // the compiler groups an element's dynamic attributes into one effect: use:value and placeholder together
        effect(() => ({ v: state.draft, p: state.placeholder }), ({ v, p }) => {
          setAttribute(input, 'use:value', v);
          setAttribute(input, 'placeholder', p);
        });
      }
    });
    (input as any)[EVENT_KEY + 'input'] = (e: Event) => {
      const v = (e.currentTarget as HTMLInputElement).value;
      if (/^[a-z]*$/.test(v)) setState('draft', v);
    };
    delegateEvents(['input']);
    const end = scope.begin(Infinity);
    try {
      type(input, 'ab');
      expect(input.value).toBe('ab');
      await settle();
      expect(input.value).toBe('ab'); // accepted: no rollback, no flicker
      type(input, 'ab1');
      if (form === 'accessor') expect(input.value).toBe('ab'); // synchronous rollback
      await settle();
      expect(input.value).toBe('ab'); // rejected: restored (plain form: in the next frame)
      setState('draft', ''); // "Send → clear" while the animation still runs
      await settle();
      expect(input.value).toBe(''); // delivered now: the binding is never parked
      type(input, 'c');
      await settle();
      expect(state.draft).toBe('c');
      expect(input.value).toBe('c');
      if (form === 'plain') {
        // the pinned compiler effect is the whole grouped effect: its sibling attribute is not parked either
        setState('placeholder', 'q');
        await settle();
        expect(input.getAttribute('placeholder')).toBe('q');
      }
    } finally {
      end();
    }
  });
}
