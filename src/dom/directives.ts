import { getRunningEffect, isEffectClean, type EffectNode } from '../core/effects';
import { createMutationEffect } from '../core/frame';
import { DEV } from '../env';
import { getOwner, untrack } from '../index';
import { requestMutation } from '../scheduler/fasterdom';
import { delegateEvents, onClearDelegated } from './events';

/**
 * A directive receives the raw attribute expression: for `use:x={sig}` the compiler passes the
 * accessor itself (one call at creation — the directive owns any effect); for `use:x={props.v}` it
 * emits an effect that calls `setAttribute(el, 'use:x', value)` with plain values on every change.
 */
export type Directive = (el: Element, value: unknown) => void;

// Two tables: the built-ins (controlled inputs have invariants — rollback, caret, IME — that a
// same-named user directive would silently break) and the user's. A user registration can neither
// take a reserved or built-in name nor replace an earlier one, whatever the module load order.
const RESERVED = new Set(['value', 'checked']);
const builtins = new Map<string, Directive>();
const registry = new Map<string, Directive>();

/** Register `use:<name>`. `value` and `checked` are built in; a taken name is a DEV error and is ignored. */
export function defineDirective(name: string, fn: Directive): void {
  if (RESERVED.has(name) || builtins.has(name) || registry.has(name)) {
    if (DEV) console.error(`[frameact] defineDirective('${name}') ignored: the name is ${RESERVED.has(name) || builtins.has(name) ? 'a built-in' : 'already registered'}. Pick another name.`);
    return;
  }
  registry.set(name, fn);
}

/** Internal: the built-ins (`value`, `checked`, registered by the module that implements them). */
export function defineBuiltinDirective(name: string, fn: Directive): void {
  builtins.set(name, fn);
}

/** `setAttribute(el, 'use:<name>', value)` lands here. */
export function runDirective(el: Element, name: string, value: unknown): void {
  const directive = builtins.get(name) ?? registry.get(name);
  if (!directive) {
    if (DEV) console.error(`[frameact] unknown directive use:${name} — register it with defineDirective('${name}', fn)`);
    return;
  }
  directive(el, value);
}

/** Hand-written form (dom-expressions 1.x API): `use(fn, el, arg)`. */
export function use<A>(fn: (el: Element, arg: A) => void, el: Element, arg: A): void {
  untrack(() => fn(el, arg));
}

// ---- built-in controlled inputs (spec §3.3) ---------------------------------
// Adapted in spirit from teact's processControlled / setAttribute('value') caret logic
// (MIT, © 2022 Alexander Zinchuk).

type TextControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface CaretSnapshot {
  start: number;
  end: number;
  atEnd: boolean;
}

interface ValueState {
  /** The live accessor (accessor forms) or a getter of the last delivered value (plain-value form). */
  read: () => unknown;
  /** `read` is a live accessor: the rollback check runs synchronously in the event. Plain form: deferred to the mutate phase. */
  live: boolean;
  /** A deferred check is already queued for this frame (several input events share it). */
  pending: boolean;
  /** Plain-value form: the compiler's effect whose apply delivers values (null if called outside any effect). */
  effect: EffectNode | null;
  /** Taken at event time (measure phase); the mutate-phase applier only restores from it. */
  selection: CaretSnapshot | null;
  composing: boolean;
}

interface CheckedState {
  read: () => unknown;
  live: boolean;
  pending: boolean;
  effect: EffectNode | null;
}

const valueControlled = new WeakMap<TextControl, ValueState>();
const checkedControlled = new WeakMap<HTMLInputElement, CheckedState>();
const installed = new WeakSet<Document>();

function toText(v: unknown): string {
  return v == null ? '' : String(v);
}

function snapshot(el: TextControl, state: ValueState): void {
  const input = el as HTMLInputElement;
  const start = 'selectionStart' in input ? input.selectionStart : null;
  if (start == null) {
    state.selection = null; // selects, inputs without a text selection
    return;
  }
  const end = input.selectionEnd ?? start;
  state.selection = { start, end, atEnd: start === end && end === input.value.length };
}

function writeValue(el: TextControl, state: ValueState, v: unknown): void {
  if (state.composing) return; // IME: never write mid-composition
  const next = toText(v);
  if (el.value === next) return;
  el.value = next;
  const sel = state.selection;
  if (sel && document.activeElement === el && 'setSelectionRange' in el) {
    try {
      if (sel.atEnd) el.setSelectionRange(next.length, next.length);
      else el.setSelectionRange(sel.start, sel.end);
    } catch {
      // input types without a selection API
    }
  }
}

function check(el: TextControl, state: ValueState): void {
  const v = untrack(state.read);
  if (el.value !== toText(v)) writeValue(el, state, v);
}

/**
 * Live accessor: compare right now, in the event. Plain-value form: the compiler's effect has not
 * delivered what the handler just wrote, so a synchronous compare would roll back an accepted
 * keystroke (flicker). Compare in the frame's mutate phase instead — after that effect: the delegated
 * handler wrote the signal first, which queued the effect's mutate work ahead of this task. Several
 * events in one frame share one task.
 */
function verify(el: TextControl, state: ValueState): void {
  if (state.live) check(el, state);
  else if (!state.pending) {
    state.pending = true;
    requestMutation(() => {
      state.pending = false;
      // A dirty, queued or gating-parked compiler effect still has a delivery to make, and that
      // delivery is authoritative (for an accepted input it equals el.value, so nothing is written).
      if (state.effect === null || isEffectClean(state.effect)) check(el, state);
    });
  }
}

function checkChecked(el: HTMLInputElement, state: CheckedState): void {
  const v = !!untrack(state.read);
  if (el.checked !== v) el.checked = v;
}

function onInput(e: Event): void {
  const el = e.target as TextControl;
  const state = valueControlled.get(el);
  if (!state || (e as InputEvent).isComposing || state.composing) return;
  snapshot(el, state);
  verify(el, state);
}

function onCompositionStart(e: Event): void {
  const state = valueControlled.get(e.target as TextControl);
  if (state) state.composing = true;
}

function onCompositionEnd(e: Event): void {
  const el = e.target as TextControl;
  const state = valueControlled.get(el);
  if (!state) return;
  state.composing = false;
  snapshot(el, state);
  verify(el, state);
}

function onFocusOut(e: Event): void {
  const state = valueControlled.get(e.target as TextControl);
  if (state) state.selection = null;
}

function onChange(e: Event): void {
  const el = e.target as HTMLInputElement;
  const state = checkedControlled.get(el);
  if (!state) return;
  if (state.live) checkChecked(el, state);
  else if (!state.pending) {
    state.pending = true;
    requestMutation(() => {
      state.pending = false;
      if (state.effect === null || isEffectClean(state.effect)) checkChecked(el, state);
    });
  }
}

/**
 * Document listeners, registered AFTER `input` delegation: on one document, listeners run in
 * registration order, so the controlled check always follows the delegated `onInput` dispatcher
 * (and element-level `on:input` listeners, which bubble first).
 */
function installListeners(doc: Document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  delegateEvents(['input'], doc);
  doc.addEventListener('input', onInput);
  doc.addEventListener('change', onChange);
  doc.addEventListener('compositionstart', onCompositionStart);
  doc.addEventListener('compositionend', onCompositionEnd);
  doc.addEventListener('focusout', onFocusOut);
}

onClearDelegated((doc) => {
  if (!installed.has(doc)) return;
  installed.delete(doc);
  doc.removeEventListener('input', onInput);
  doc.removeEventListener('change', onChange);
  doc.removeEventListener('compositionstart', onCompositionStart);
  doc.removeEventListener('compositionend', onCompositionEnd);
  doc.removeEventListener('focusout', onFocusOut);
});

const APPLY_HINTS = {
  value: ['use:value={text}', 'use:value={props.text()}'],
  checked: ['use:checked={flag}', 'use:checked={props.flag()}'],
} as const;

/** DEV: an accessor reached a controlled-input directive from inside an effect apply (no owner). */
function reportAccessorInApply(name: keyof typeof APPLY_HINTS): void {
  const [accessorForm, valueForm] = APPLY_HINTS[name];
  console.error(
    `[frameact] use:${name} received an accessor inside an effect apply (a compiler-wrapped use:${name}={props.x} where props.x is a function), so it cannot own a binding effect and will not follow later changes. Pass the accessor directly: ${accessorForm}, or a value: ${valueForm}.`,
  );
}

function valueDirective(el: Element, value: unknown): void {
  const control = el as TextControl;
  if (DEV && !('value' in control)) console.error('[frameact] use:value expects an input, textarea or select', el);
  installListeners(el.ownerDocument);
  let state = valueControlled.get(control);
  if (!state) valueControlled.set(control, (state = { read: () => undefined, live: true, pending: false, effect: null, selection: null, composing: false }));
  if (typeof value === 'function') {
    const accessor = value as () => unknown;
    const owned = state;
    owned.read = accessor; // the document-level rollback check always reads the live accessor
    owned.live = true;
    if (getOwner() === null) {
      // Inside an effect apply (no owner): the compiler wrapped `use:value={props.text}` where
      // `props.text` is itself an accessor. An effect created here would be unowned (DEV throws), so
      // write once and tell the author how to get a live binding.
      if (DEV) reportAccessorInApply('value');
      writeValue(control, owned, untrack(accessor));
      return;
    }
    // Static form: the directive owns the binding effect (created under the component's owner). The
    // compute returns a fresh box so the apply runs on every change and compares with the DOM: input
    // the user already typed ('abc', accepted) followed by a programmatic change back to the last
    // applied value ('ab') in the same frame must still be written.
    createMutationEffect(
      () => ({ v: accessor() }),
      ({ v }) => {
        writeValue(control, owned, v);
      },
      { name: 'use:value' },
    );
  } else {
    // Effect-driven form: the compiler's effect calls us with plain values. `read` returns the last
    // delivered one and the rollback check is deferred to the mutate phase (see `verify`).
    state.live = false;
    state.effect = getRunningEffect(); // the compiler's effect: we are inside its apply
    state.read = () => value;
    writeValue(control, state, value);
  }
}

function checkedDirective(el: Element, value: unknown): void {
  const box = el as HTMLInputElement;
  if (DEV && !('checked' in box)) console.error('[frameact] use:checked expects a checkbox or radio input', el);
  installListeners(el.ownerDocument);
  let state = checkedControlled.get(box);
  if (!state) checkedControlled.set(box, (state = { read: () => undefined, live: true, pending: false, effect: null }));
  if (typeof value === 'function') {
    const accessor = value as () => unknown;
    state.read = accessor;
    state.live = true;
    if (getOwner() === null) {
      // Inside an effect apply (no owner): see valueDirective. One-shot write, no owned effect.
      if (DEV) reportAccessorInApply('checked');
      const next = !!untrack(accessor);
      if (box.checked !== next) box.checked = next;
      return;
    }
    // A fresh box per change (see valueDirective): the apply compares with the DOM, not with the last applied value.
    createMutationEffect(
      () => ({ v: !!accessor() }),
      ({ v }) => {
        if (box.checked !== v) box.checked = v;
      },
      { name: 'use:checked' },
    );
  } else {
    state.live = false; // plain-value form: the change check is deferred to the mutate phase
    state.effect = getRunningEffect();
    state.read = () => value;
    if (box.checked !== !!value) box.checked = !!value;
  }
}

defineBuiltinDirective('value', valueDirective);
defineBuiltinDirective('checked', checkedDirective);
