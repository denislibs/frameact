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

/** What `use:value` and `use:checked` share: where the authoritative value comes from and when it is checked. */
interface Binding<E extends Element = Element> {
  readonly el: E;
  readonly kind: Kind<any>;
  /** Accessor forms: the live accessor the rollback check reads. Plain form: null (see `delivered`). */
  accessor: (() => unknown) | null;
  /** Plain-value form: the last value the compiler's effect delivered. */
  delivered: unknown;
  /** The check runs synchronously in the event (accessor forms); plain form: deferred to the mutate phase. */
  live: boolean;
  /** A deferred check is already queued for this frame (several events share it). */
  pending: boolean;
  /** Plain-value form: the compiler's effect whose apply delivers values (null if called outside any effect). */
  effect: EffectNode | null;
  /** The deferred check, bound once per binding (no closure per event). */
  readonly runDeferred: () => void;
}

interface ValueBinding extends Binding<TextControl> {
  /** Caret snapshot taken at event time (measure phase); the mutate-phase applier only restores from it. */
  hasSelection: boolean;
  selStart: number;
  selEnd: number;
  atEnd: boolean;
  composing: boolean;
}

type CheckedBinding = Binding<HTMLInputElement>;

interface Kind<B extends Binding<any>> {
  readonly name: 'value' | 'checked';
  readonly bindings: WeakMap<Element, B>;
  create(el: Element): B;
  /** Writes `v` if the live DOM differs (caret-preserving for text). */
  write(b: B, v: unknown): void;
}

const installed = new WeakSet<Document>();

function current(b: Binding<any>): unknown {
  return b.accessor !== null ? untrack(b.accessor) : b.delivered;
}

/** Compare the live DOM with the authoritative value and restore it if they differ. */
function check(b: Binding<any>): void {
  b.kind.write(b, current(b));
}

function runDeferred(b: Binding<any>): void {
  b.pending = false;
  // A dirty, queued or gating-parked compiler effect still has a delivery to make, and that
  // delivery is authoritative (for an accepted input it equals the DOM, so nothing is written).
  if (b.effect === null || isEffectClean(b.effect)) check(b);
}

/**
 * Live accessor: compare right now, in the event. Plain-value form: the compiler's effect has not
 * delivered what the handler just wrote, so a synchronous compare would roll back an accepted
 * keystroke (flicker). Compare in the frame's mutate phase instead — after that effect: the delegated
 * handler wrote the signal first, which queued the effect's mutate work ahead of this task. Several
 * events in one frame share one task.
 */
function verify(b: Binding<any>): void {
  if (b.live) check(b);
  else if (!b.pending) {
    b.pending = true;
    requestMutation(b.runDeferred);
  }
}

function newBinding<E extends Element>(kind: Kind<any>, el: E): Binding<E> {
  const b: Binding<E> = {
    el,
    kind,
    accessor: null,
    delivered: undefined,
    live: true,
    pending: false,
    effect: null,
    runDeferred: () => runDeferred(b),
  };
  return b;
}

// ---- use:value ----

function toText(v: unknown): string {
  return v == null ? '' : String(v);
}

function snapshot(b: ValueBinding): void {
  const input = b.el as HTMLInputElement;
  const start = 'selectionStart' in input ? input.selectionStart : null;
  if (start == null) {
    b.hasSelection = false; // selects, inputs without a text selection
    return;
  }
  const end = input.selectionEnd ?? start;
  b.hasSelection = true;
  b.selStart = start;
  b.selEnd = end;
  b.atEnd = start === end && end === input.value.length;
}

function writeValue(b: ValueBinding, v: unknown): void {
  if (b.composing) return; // IME: never write mid-composition
  const el = b.el;
  const next = toText(v);
  if (el.value === next) return;
  el.value = next;
  if (b.hasSelection && document.activeElement === el && 'setSelectionRange' in el) {
    try {
      if (b.atEnd) el.setSelectionRange(next.length, next.length);
      else el.setSelectionRange(b.selStart, b.selEnd);
    } catch {
      // input types without a selection API
    }
  }
}

const valueKind: Kind<ValueBinding> = {
  name: 'value',
  bindings: new WeakMap(),
  create(el) {
    const b = newBinding(valueKind, el as TextControl) as ValueBinding;
    b.hasSelection = false;
    b.selStart = 0;
    b.selEnd = 0;
    b.atEnd = false;
    b.composing = false;
    return b;
  },
  write: writeValue,
};

// ---- use:checked ----

const checkedKind: Kind<CheckedBinding> = {
  name: 'checked',
  bindings: new WeakMap(),
  create: (el) => newBinding(checkedKind, el as HTMLInputElement),
  write(b, v) {
    const next = !!v;
    if (b.el.checked !== next) b.el.checked = next;
  },
};

// ---- document listeners ----

function onInput(e: Event): void {
  const b = valueKind.bindings.get(e.target as Element);
  if (!b || (e as InputEvent).isComposing || b.composing) return;
  snapshot(b);
  verify(b);
}

function onCompositionStart(e: Event): void {
  const b = valueKind.bindings.get(e.target as Element);
  if (b) b.composing = true;
}

function onCompositionEnd(e: Event): void {
  const b = valueKind.bindings.get(e.target as Element);
  if (!b) return;
  b.composing = false;
  snapshot(b);
  verify(b);
}

function onFocusOut(e: Event): void {
  const b = valueKind.bindings.get(e.target as Element);
  if (b) b.hasSelection = false;
}

function onChange(e: Event): void {
  const b = checkedKind.bindings.get(e.target as Element);
  if (b) verify(b);
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

// ---- the directive entry (three forms, shared by value and checked) ----

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

function bind<B extends Binding<any>>(kind: Kind<B>, el: Element, value: unknown): void {
  installListeners(el.ownerDocument);
  let b = kind.bindings.get(el);
  if (!b) kind.bindings.set(el, (b = kind.create(el)));
  if (typeof value === 'function') {
    const accessor = value as () => unknown;
    const owned = b;
    owned.accessor = accessor; // the document-level rollback check always reads the live accessor
    owned.live = true;
    if (getOwner() === null) {
      // Inside an effect apply (no owner): the compiler wrapped `use:value={props.text}` where
      // `props.text` is itself an accessor. An effect created here would be unowned (DEV throws), so
      // write once and tell the author how to get a live binding.
      if (DEV) reportAccessorInApply(kind.name);
      kind.write(owned, untrack(accessor));
      return;
    }
    // Static form: the directive owns the binding effect (created under the component's owner). The
    // compute returns a fresh box so the apply runs on every change and compares with the DOM: input
    // the user already typed ('abc', accepted) followed by a programmatic change back to the last
    // applied value ('ab') in the same frame must still be written.
    createMutationEffect(
      () => ({ v: accessor() }),
      ({ v }) => {
        kind.write(owned, v);
      },
      { name: `use:${kind.name}` },
    );
  } else {
    // Effect-driven form: the compiler's effect calls us with plain values; the rollback check is
    // deferred to the mutate phase (see `verify`). No allocation per delivery.
    b.accessor = null;
    b.live = false;
    b.effect = getRunningEffect(); // the compiler's effect: we are inside its apply
    b.delivered = value;
    kind.write(b, value);
  }
}

function valueDirective(el: Element, value: unknown): void {
  if (DEV && !('value' in el)) console.error('[frameact] use:value expects an input, textarea or select', el);
  bind(valueKind, el, value);
}

function checkedDirective(el: Element, value: unknown): void {
  if (DEV && !('checked' in el)) console.error('[frameact] use:checked expects a checkbox or radio input', el);
  bind(checkedKind, el, value);
}

defineBuiltinDirective('value', valueDirective);
defineBuiltinDirective('checked', checkedDirective);
