import { createHeavyAnimationScope, createRoot, createSignal, provideHeavyAnimationScope } from '../../src/index';
import { setAttribute } from '../../src/dom/attributes';
import { effect } from '../../src/dom/component';
import { delegateEvents, EVENT_KEY } from '../../src/dom/events';
import { container, useDomHarness } from '../helpers/dom';

const { frame, pending } = useDomHarness();

function textInput() {
  const input = document.createElement('input');
  container().appendChild(input);
  input.focus();
  return input;
}

function checkbox() {
  const box = document.createElement('input');
  box.type = 'checkbox';
  container().appendChild(box);
  return box;
}

/** Simulate a keystroke: the browser has already changed the value and moved the caret when `input` fires. */
function type(input: HTMLInputElement, value: string, caret = value.length) {
  input.value = value;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

/** A controlled input whose delegated onInput handler is built from the signal's setter. */
function controlled(
  input: HTMLInputElement,
  handler: (setText: (v: string) => void) => (e: Event) => void,
  initial = 'ab',
) {
  const [text, setText] = createSignal(initial);
  createRoot(() => setAttribute(input, 'use:value', text));
  (input as any)[EVENT_KEY + 'input'] = handler(setText);
  delegateEvents(['input']);
  return { text, setText };
}

it('writes the initial value and programmatic updates (next frame)', async () => {
  const input = textInput();
  const { setText } = controlled(input, () => () => {});
  expect(input.value).toBe('ab');
  setText('zz');
  expect(input.value).toBe('ab');
  await frame();
  expect(input.value).toBe('zz');
});

it('rejected input is rolled back synchronously in the event, caret restored', () => {
  const input = textInput();
  controlled(input, (setText) => (e) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (/^[a-z]*$/.test(v)) setText(v);
  });
  type(input, 'ab1');
  expect(input.value).toBe('ab');
  expect(input.selectionStart).toBe(2);
});

it('accepted input is left alone (no write, no frame needed); formatted input is applied at once with the caret kept', async () => {
  const input = textInput();
  let mode: 'accept' | 'upper' = 'accept';
  controlled(input, (setText) => (e) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    setText(mode === 'upper' ? v.toUpperCase() : v);
  });
  type(input, 'abc');
  expect(input.value).toBe('abc');
  await frame();
  expect(input.value).toBe('abc');
  mode = 'upper';
  type(input, 'abxc', 3); // caret after the inserted 'x'
  expect(input.value).toBe('ABXC');
  expect(input.selectionStart).toBe(3);
  type(input, 'ABXCd'); // caret at the end stays at the end after formatting
  expect(input.value).toBe('ABXCD');
  expect(input.selectionStart).toBe(5);
});

it('does not write during IME composition; applies after compositionend', () => {
  const input = textInput();
  controlled(input, () => () => {}); // the handler never accepts
  input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  type(input, 'abか');
  expect(input.value).toBe('abか');
  input.dispatchEvent(new Event('compositionend', { bubbles: true }));
  expect(input.value).toBe('ab');
});

it('the check runs after a delegated handler registered later (delegation order is fixed by the directive)', () => {
  const input = textInput();
  const [text, setText] = createSignal('a');
  createRoot(() => setAttribute(input, 'use:value', text));
  // a later-loaded chunk delegating `input` must not reorder the check before its handlers
  delegateEvents(['input']);
  (input as any)[EVENT_KEY + 'input'] = (e: Event) => setText((e.currentTarget as HTMLInputElement).value);
  type(input, 'ab');
  expect(input.value).toBe('ab');
});

it('value mode (effect-driven): plain values are written with the caret kept', () => {
  const input = textInput();
  setAttribute(input, 'use:value', 'plain');
  expect(input.value).toBe('plain');
  type(input, 'plainx');
  setAttribute(input, 'use:value', 'PLAINX');
  expect(input.value).toBe('PLAINX');
  expect(input.selectionStart).toBe(6);
});

it('an accepted input followed, in the same frame, by a programmatic change back to the last applied value still lands', async () => {
  const input = textInput();
  const { setText } = controlled(input, (set) => (e) => set((e.currentTarget as HTMLInputElement).value));
  type(input, 'abc'); // accepted: signal and DOM are 'abc'; the effect's last applied value is still 'ab'
  setText('ab');
  await frame();
  expect(input.value).toBe('ab');
});

it('compiler-wrapped form (use:value={props.text()}): an accepted keystroke is never rolled back, not even between the event and the next frame', async () => {
  const input = textInput();
  const [text, setText] = createSignal('ab');
  createRoot(() => effect(() => text(), (v) => { setAttribute(input, 'use:value', v); }));
  (input as any)[EVENT_KEY + 'input'] = (e: Event) => setText((e.currentTarget as HTMLInputElement).value);
  delegateEvents(['input']);
  expect(input.value).toBe('ab');
  const writes = vi.spyOn(HTMLInputElement.prototype, 'value', 'set');
  type(input, 'abc', 2); // the browser wrote 'abc' (one write below) and put the caret after 'b'
  expect(input.value).toBe('abc');
  expect(input.selectionStart).toBe(2);
  expect(writes.mock.calls.map((call) => call[0])).toEqual(['abc']); // nobody reset it in the event
  await frame();
  expect(input.value).toBe('abc');
  expect(input.selectionStart).toBe(2);
  expect(writes.mock.calls.map((call) => call[0])).toEqual(['abc']); // ...nor in the frame: the check saw the delivered value
  writes.mockRestore();
});

it('compiler-wrapped form: a rejected keystroke is rolled back in the next frame, not in the event', async () => {
  const input = textInput();
  const [text, setText] = createSignal('ab');
  createRoot(() => effect(() => text(), (v) => { setAttribute(input, 'use:value', v); }));
  setText('abcd');
  await frame();
  expect(input.value).toBe('abcd');
  const writes = vi.spyOn(HTMLInputElement.prototype, 'value', 'set');
  type(input, 'abcd1'); // nothing accepts it
  type(input, 'abcd12');
  expect(input.value).toBe('abcd12'); // no synchronous rollback
  await frame();
  expect(input.value).toBe('abcd');
  expect(writes.mock.calls.map((call) => call[0])).toEqual(['abcd1', 'abcd12', 'abcd']); // one restore for both events
  writes.mockRestore();
});

/**
 * The compiler's effect for `use:value={props.text()}`, created inside a heavy-animation scope
 * (what `<HeavyAnimationScope scope>` from Task 11 does: provide the scope, then create the children).
 */
function gatedPlainInput(input: HTMLInputElement, text: () => string) {
  const scope = createHeavyAnimationScope();
  createRoot(() => {
    provideHeavyAnimationScope(scope);
    effect(() => text(), (v) => { setAttribute(input, 'use:value', v); });
  });
  return scope;
}

it('plain form inside a gated subtree: an accepted keystroke stays visible while the effect is parked and after the release', async () => {
  const input = textInput();
  const [text, setText] = createSignal('ab');
  const scope = gatedPlainInput(input, text);
  (input as any)[EVENT_KEY + 'input'] = (e: Event) => setText((e.currentTarget as HTMLInputElement).value);
  delegateEvents(['input']);
  const end = scope.begin(Infinity, true);
  type(input, 'abc', 2);
  await frame(); // the compiler's effect is dirty and parked: the check must not restore the stale 'ab'
  expect(input.value).toBe('abc');
  expect(input.selectionStart).toBe(2);
  end();
  await frame(); // released: the delivery writes 'abc', which is already there
  expect(input.value).toBe('abc');
  expect(input.selectionStart).toBe(2);
});

it('plain form inside a gated subtree: a rejected keystroke is restored next frame; a rejected one after an accepted one waits for the parked delivery', async () => {
  const input = textInput();
  const [text, setText] = createSignal('ab');
  const scope = gatedPlainInput(input, text);
  (input as any)[EVENT_KEY + 'input'] = (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (/^[a-z]*$/.test(v)) setText(v);
  };
  delegateEvents(['input']);
  const end = scope.begin(Infinity, true);
  type(input, 'ab1'); // rejected; the effect is clean, so the check restores the delivered value at once
  await frame();
  expect(input.value).toBe('ab');
  type(input, 'abc'); // accepted: the effect is now dirty and parked
  await frame();
  expect(input.value).toBe('abc');
  type(input, 'abc1'); // rejected, but the parked delivery of 'abc' will settle it
  await frame();
  expect(input.value).toBe('abc1');
  end();
  await frame();
  expect(input.value).toBe('abc');
});

it('an accessor received inside an effect apply (use:value={props.text} with props.text a function): dev error with a hint, one-shot write, no owned effect, rollback follows the live signal', async () => {
  const input = textInput();
  const [text, setText] = createSignal('ab');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  // What the compiler emits for use:value={props.text}: its effect delivers the function itself, from inside an apply.
  createRoot(() => effect(() => text, (accessor) => { setAttribute(input, 'use:value', accessor); }));
  expect(input.value).toBe('ab');
  expect(err).toHaveBeenCalledTimes(1);
  expect(String(err.mock.calls[0][0])).toContain('use:value={text}');
  type(input, 'ab1'); // an unaccepted keystroke is still rolled back against the live accessor
  expect(input.value).toBe('ab');
  expect(err).toHaveBeenCalledTimes(1);
  err.mockRestore();
  setText('zz');
  await frame();
  expect(input.value).toBe('ab'); // documented: the fallback does not follow programmatic changes
});

it('use:checked: a rejected toggle is reverted after the change handlers; an accepted one stays', async () => {
  const box = checkbox();
  const [flag, setFlag] = createSignal(false);
  createRoot(() => setAttribute(box, 'use:checked', flag));
  expect(box.checked).toBe(false);
  let accept = false;
  box.addEventListener('change', () => {
    if (accept) setFlag(box.checked);
  });
  box.click(); // toggles, fires input + change
  expect(box.checked).toBe(false);
  accept = true;
  box.click();
  expect(box.checked).toBe(true);
  setFlag(false);
  await frame();
  expect(box.checked).toBe(false);
});

it('use:checked inside an effect apply (accessor, no owner): dev error with a hint, one-shot write, a rejected toggle is still reverted', () => {
  const box = checkbox();
  const [flag] = createSignal(true);
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  createRoot(() => effect(() => flag, (accessor) => { setAttribute(box, 'use:checked', accessor); }));
  expect(box.checked).toBe(true);
  expect(err).toHaveBeenCalledTimes(1);
  expect(String(err.mock.calls[0][0])).toContain('use:checked={flag}');
  err.mockRestore();
  box.click(); // toggles to false; nothing accepted it, so the change check restores the live value
  expect(box.checked).toBe(true);
});

it('use:checked, compiler-wrapped plain form: an accepted toggle never flickers back; a rejected one is reverted in the next frame', async () => {
  const box = checkbox();
  const [flag, setFlag] = createSignal(false);
  createRoot(() => effect(() => flag(), (v) => { setAttribute(box, 'use:checked', v); }));
  let accept = true;
  box.addEventListener('change', () => {
    if (accept) setFlag(box.checked);
  });
  box.click();
  expect(box.checked).toBe(true); // no synchronous rollback
  await frame();
  expect(box.checked).toBe(true);
  accept = false;
  box.click();
  expect(box.checked).toBe(false); // the toggle stays until the deferred check runs
  await frame();
  expect(box.checked).toBe(true);
});

// ---- fix round 1 -------------------------------------------------------------

it('M6: an accessor outside any owner (imperative, no effect running) gets a dev error that does not claim an effect apply', () => {
  const input = textInput();
  const [text] = createSignal('ab');
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  setAttribute(input, 'use:value', text);
  expect(input.value).toBe('ab');
  expect(err).toHaveBeenCalledTimes(1);
  const message = String(err.mock.calls[0][0]);
  expect(message).not.toContain('inside an effect apply');
  expect(message).toContain('outside any owner');
  err.mockRestore();
  type(input, 'ab1'); // still rolled back against the live accessor
  expect(input.value).toBe('ab');
});

it('M1: a plain value written from a parent compute (subtree creation) is not tied to that parent: a rejected keystroke is restored while the parent is parked', async () => {
  const input = textInput();
  const [n, setN] = createSignal(0);
  const scope = createHeavyAnimationScope();
  createRoot(() => {
    provideHeavyAnimationScope(scope);
    effect(
      () => {
        const v = n();
        if (v === 0) setAttribute(input, 'use:value', 'x'); // a constant, written once at creation
        return v;
      },
      () => {},
    );
  });
  const end = scope.begin(Infinity, true);
  setN(1); // the parent is dirty and parked: it will never deliver to the input
  type(input, 'x1');
  await frame();
  expect(input.value).toBe('x');
  end();
});

describe('M3: disposing the binding releases the element', () => {
  it('accessor form: after the owner is disposed, input is no longer rolled back', () => {
    const input = textInput();
    const [text] = createSignal('ab');
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      setAttribute(input, 'use:value', text);
    });
    dispose();
    type(input, 'ab1');
    expect(input.value).toBe('ab1');
  });

  it('accessor inside an apply: disposing the delivering effect releases the element', () => {
    const input = textInput();
    const [text] = createSignal('ab');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      effect(() => text, (accessor) => { setAttribute(input, 'use:value', accessor); });
    });
    err.mockRestore();
    dispose();
    type(input, 'ab1');
    expect(input.value).toBe('ab1');
  });

  it('plain form: after the compiler effect is disposed the element is released (no check, nothing left queued), and can be bound again', async () => {
    const input = textInput();
    const [text, setText] = createSignal('ab');
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      effect(() => text(), (v) => { setAttribute(input, 'use:value', v); });
    });
    dispose();
    type(input, 'ab1');
    await frame();
    expect(input.value).toBe('ab1');
    await frame();
    expect(pending()).toBe(0);
    createRoot(() => setAttribute(input, 'use:value', text)); // a fresh binding works normally
    expect(input.value).toBe('ab');
    setText('zz');
    await frame();
    expect(input.value).toBe('zz');
  });
});

it('M1: a skipped deferred check is re-armed: the effect turning clean without a delivery (same compute result) still gets the rejected keystroke rolled back', async () => {
  const input = textInput();
  // use:value={props.draft().text}; the handler rejects the text but touches another draft field
  const [draft, setDraft] = createSignal({ text: 'ab', touched: 0 }, { equals: false });
  const scope = gatedPlainInput(input, () => draft().text);
  (input as any)[EVENT_KEY + 'input'] = () => setDraft((d) => ({ text: d.text, touched: d.touched + 1 }));
  delegateEvents(['input']);
  const end = scope.begin(Infinity, true);
  type(input, 'ab1');
  await frame(); // the compiler effect is dirty and parked: the check waits
  expect(input.value).toBe('ab1');
  end();
  await frame(); // released: recomputes 'ab' (unchanged), so no delivery
  await frame();
  expect(input.value).toBe('ab');
  await frame();
  expect(pending()).toBe(0); // the re-armed check stopped once it ran
});

/** Handler factory for `controlled`: accepts every input. */
function acceptAll(setText: (v: string) => void) {
  return (e: Event) => setText((e.currentTarget as HTMLInputElement).value);
}

/** Handler factory for `controlled`: accepts input only up to `max` characters (rejects longer). */
function limit(max: number) {
  return (setText: (v: string) => void) => (e: Event) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    if (v.length <= max) setText(v);
  };
}

/** Handler factory for `controlled`: accepts input truncated to `max` characters. */
function truncate(max: number) {
  return (setText: (v: string) => void) => (e: Event) => setText((e.currentTarget as HTMLInputElement).value.slice(0, max));
}

describe('I1: the caret is anchored on the common suffix of the DOM value and the written value', () => {
  it('a rejected keystroke mid-string puts the caret back where it was (limit 5, after the "h" of "hello")', () => {
    const input = textInput();
    controlled(input, limit(5), 'hello');
    input.setSelectionRange(1, 1);
    type(input, 'hxello', 2);
    expect(input.value).toBe('hello');
    expect(input.selectionStart).toBe(1);
    type(input, 'hxello', 2); // the next rejected keystroke does not creep to the right
    expect(input.selectionStart).toBe(1);
    expect(input.selectionEnd).toBe(1);
  });

  it('a rejected emoji (surrogate pair) inserted mid-string puts the caret back at 1', () => {
    const input = textInput();
    controlled(input, (setText) => (e) => {
      const v = (e.currentTarget as HTMLInputElement).value;
      if (/^[a-z]*$/.test(v)) setText(v);
    });
    type(input, 'a😀b', 3);
    expect(input.value).toBe('ab');
    expect(input.selectionStart).toBe(1);
  });

  it('max-length truncation keeps the caret after the typed character, and after the kept part of a paste', () => {
    const input = textInput();
    controlled(input, truncate(5), 'hello');
    type(input, 'hxello', 2);
    expect(input.value).toBe('hxell');
    expect(input.selectionStart).toBe(2);

    const pasted = textInput();
    controlled(pasted, truncate(7), 'hello');
    type(pasted, 'heXYZllo', 5); // paste "XYZ" after "he"
    expect(pasted.value).toBe('heXYZll');
    expect(pasted.selectionStart).toBe(5);
  });

  it('a length-changing replacement (":)" -> emoji) puts the caret after the replacement, never inside the pair', () => {
    const input = textInput();
    controlled(input, (setText) => (e) => setText((e.currentTarget as HTMLInputElement).value.replace(':)', '🙂')));
    type(input, 'a:)b', 3);
    expect(input.value).toBe('a🙂b');
    expect(input.selectionStart).toBe(3);
  });
});

describe('I2: a caret snapshot is valid only for the frame it was taken in, or until the selection changes', () => {
  it('a programmatic write in a later frame, after the user moved the caret, does not jump back to the last keystroke (2 -> 5)', async () => {
    const input = textInput();
    const { setText } = controlled(input, acceptAll, 'abc');
    type(input, 'abcd', 2); // the keystroke left the caret at 2
    await frame();
    input.setSelectionRange(4, 4); // a click at the end: no input event
    setText('abcd!');
    await frame();
    expect(input.value).toBe('abcd!');
    expect(input.selectionStart).toBe(5);
  });

  it('a selection change in the same frame refreshes the snapshot', async () => {
    const input = textInput();
    const { setText } = controlled(input, acceptAll, 'abc');
    type(input, 'abcd', 2);
    input.setSelectionRange(1, 1); // arrow keys: no input event, a selectionchange
    input.dispatchEvent(new Event('selectionchange', { bubbles: true }));
    setText('Xabcd'); // delivered in this frame: the caret keeps its place after "a"
    await frame();
    expect(input.value).toBe('Xabcd');
    expect(input.selectionStart).toBe(2);
  });
});

function radio(name: string, parent: ParentNode = container()) {
  const r = document.createElement('input');
  r.type = 'radio';
  r.name = name;
  parent.appendChild(r);
  return r;
}

describe('I3: radio groups', () => {
  it('a rejected switch restores the previously checked radio too (the browser unchecked it without a change event)', () => {
    const a = radio('g');
    const b = radio('g');
    const [flagA] = createSignal(true);
    const [flagB] = createSignal(false);
    createRoot(() => {
      setAttribute(a, 'use:checked', flagA);
      setAttribute(b, 'use:checked', flagB);
    });
    expect([a.checked, b.checked]).toEqual([true, false]);
    b.click(); // nothing accepts it
    expect([a.checked, b.checked]).toEqual([true, false]);
  });

  it('an accepted switch stays', async () => {
    const a = radio('g');
    const b = radio('g');
    const [selected, setSelected] = createSignal('a');
    createRoot(() => {
      setAttribute(a, 'use:checked', () => selected() === 'a');
      setAttribute(b, 'use:checked', () => selected() === 'b');
    });
    b.addEventListener('change', () => setSelected('b'));
    b.click();
    expect([a.checked, b.checked]).toEqual([false, true]);
    await frame();
    expect([a.checked, b.checked]).toEqual([false, true]);
  });

  it('plain form: a rejected switch restores the whole group in the next frame', async () => {
    const a = radio('g');
    const b = radio('g');
    const [selected] = createSignal('a');
    createRoot(() => {
      effect(() => selected() === 'a', (v) => { setAttribute(a, 'use:checked', v); });
      effect(() => selected() === 'b', (v) => { setAttribute(b, 'use:checked', v); });
    });
    b.click();
    expect([a.checked, b.checked]).toEqual([false, true]); // no synchronous rollback in the plain form
    await frame();
    expect([a.checked, b.checked]).toEqual([true, false]);
  });

  it('the group is the same name within the same form: a same-named radio in another form is left alone', () => {
    const form1 = container().appendChild(document.createElement('form'));
    const form2 = container().appendChild(document.createElement('form'));
    const a = radio('g', form1);
    const b = radio('g', form1);
    const other = radio('g', form2);
    other.checked = true; // uncontrolled, in its own group
    const [flagA] = createSignal(true);
    const [flagB] = createSignal(false);
    createRoot(() => {
      setAttribute(a, 'use:checked', flagA);
      setAttribute(b, 'use:checked', flagB);
    });
    b.click();
    expect([a.checked, b.checked, other.checked]).toEqual([true, false, true]);
  });
});

/** An IME keystroke: the browser changed the value inside an active composition. */
function compose(input: HTMLInputElement, value: string) {
  input.value = value;
  input.setSelectionRange(value.length, value.length);
  input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
}

describe('I4: a programmatic write during composition is deferred to compositionend, not dropped', () => {
  it('accessor form, Android "Send -> setText(\'\')": the field is cleared at compositionend and later typing does not resurrect the text', async () => {
    const input = textInput();
    const { text, setText } = controlled(input, acceptAll, '');
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    compose(input, 'hello'); // Gboard composes every word; the handler accepts composing input
    expect(text()).toBe('hello');
    setText(''); // Send
    await frame();
    expect(input.value).toBe('hello'); // the composition is not interrupted
    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(input.value).toBe('');
    type(input, 'w');
    expect(input.value).toBe('w');
    expect(text()).toBe('w');
  });

  it('plain form: the same deferral applies to the compiler effect\'s delivery', async () => {
    const input = textInput();
    const [text, setText] = createSignal('');
    createRoot(() => effect(() => text(), (v) => { setAttribute(input, 'use:value', v); }));
    (input as any)[EVENT_KEY + 'input'] = (e: Event) => setText((e.currentTarget as HTMLInputElement).value);
    delegateEvents(['input']);
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    compose(input, 'hello');
    await frame();
    setText('');
    await frame();
    expect(input.value).toBe('hello');
    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(input.value).toBe('');
    type(input, 'w');
    await frame();
    expect(input.value).toBe('w');
    expect(text()).toBe('w');
  });

  it('composing input the handler accepted after the programmatic write is the newest value: compositionend keeps it (field and signal agree)', async () => {
    const input = textInput();
    const { text, setText } = controlled(input, acceptAll, '');
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    compose(input, 'hello');
    setText('');
    await frame();
    compose(input, 'hello w');
    input.dispatchEvent(new Event('compositionend', { bubbles: true }));
    expect(input.value).toBe(text());
    expect(input.value).toBe('hello w');
  });
});

describe('M2: focusout ends a composition whose compositionend never came', () => {
  it('later programmatic writes are applied again', async () => {
    const input = textInput();
    const { setText } = controlled(input, () => () => {});
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    input.blur(); // removed/hidden mid-composition: no compositionend
    setText('zz');
    await frame();
    expect(input.value).toBe('zz');
  });

  it('a write deferred during the composition is applied at focusout', async () => {
    const input = textInput();
    const { setText } = controlled(input, () => () => {});
    input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    setText('zz');
    await frame();
    expect(input.value).toBe('ab');
    input.blur();
    expect(input.value).toBe('zz');
  });
});
