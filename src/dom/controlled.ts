import { getRunningEffect, isEffectClean, isEffectDisposed, type EffectNode } from '../core/effects';
import { createMutationEffect } from '../core/frame';
import { DEV } from '../env';
import { getOwner, onCleanup, untrack } from '../index';
import { requestMutation } from '../scheduler/fasterdom';
import { defineBuiltinDirective } from './directives';
import { delegateEvents, onClearDelegated } from './events';

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
  /**
   * The effect whose apply delivered to us (plain form, or an accessor inside an apply), else null.
   * Plain form: the check waits while it is not CLEAN. Both: its disposal releases the element.
   */
  effect: EffectNode | null;
  /** The deferred check, bound once per binding (no closure per event). */
  readonly runDeferred: () => void;
  /** IME composition in progress (text controls only): no rollback, programmatic writes deferred. */
  composing: boolean;
}

interface ValueBinding extends Binding<TextControl> {
  /**
   * Caret snapshot taken at event time (measure phase), relative to the DOM value of that moment;
   * the mutate-phase applier only restores from it (it never reads the selection).
   */
  hasSelection: boolean;
  selStart: number;
  selEnd: number;
  /** An expiry task is queued: the snapshot lives until the end of the frame it was taken in. */
  expiring: boolean;
  readonly expire: () => void;
  /** A programmatic write arrived during composition: compositionend applies the newest value. */
  deferredWrite: boolean;
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

/**
 * Compare the live DOM with the authoritative value and restore it if they differ. Never mid-composition,
 * and never over an intermediate number text ('-', '1e'): it reads as '' with `validity.badInput`, it is
 * not a value yet, and a handler like `if (!isNaN(n)) setN(n)` must let the user type '-5'. (Programmatic
 * writes still go through `write`: a real change of the signal replaces the half-typed text.)
 */
function check(b: Binding<any>): void {
  if (b.composing || (b.el as HTMLInputElement).validity?.badInput) return;
  b.kind.write(b, current(b));
}

/** The element's live binding of this kind; a binding whose delivering effect was disposed is dropped. */
function lookup<B extends Binding<any>>(kind: Kind<B>, el: unknown): B | undefined {
  const b = kind.bindings.get(el as Element);
  if (b && b.effect !== null && isEffectDisposed(b.effect)) {
    kind.bindings.delete(b.el);
    return undefined;
  }
  return b;
}

function runDeferred(b: Binding<any>): void {
  b.pending = false;
  if (lookup(b.kind, b.el) !== b) return; // released or replaced since the check was queued
  // A dirty, queued or gating-parked compiler effect may still have a delivery to make, and that
  // delivery is authoritative (for an accepted input it equals the DOM, so nothing is written). It
  // may also turn clean WITHOUT a delivery (its compute returned the same value), so the check is
  // not dropped: it is re-queued (from a mutate task, that is the next frame) until the effect is
  // clean, then it compares.
  if (b.live || b.effect === null || isEffectClean(b.effect)) check(b);
  else {
    b.pending = true;
    requestMutation(b.runDeferred);
  }
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
  else deferCheck(b);
}

/** Queue the check into the mutate phase (one per frame per binding). */
function deferCheck(b: Binding<any>): void {
  if (b.pending) return;
  b.pending = true;
  requestMutation(b.runDeferred);
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
    composing: false,
  };
  return b;
}

// ---- use:value ----

function toText(v: unknown): string {
  return v == null ? '' : String(v);
}

/**
 * The DOM already shows `v`. A number input bound to a number compares numerically, so "1.0" or
 * "1.50" typed on the way to another number are not rolled back to "1" / "1.5" (an empty field
 * matches NaN, what valueAsNumber reports for it).
 */
function showsValue(el: TextControl, v: unknown, text: string): boolean {
  const shown = el.value;
  if (typeof v === 'number' && (el as HTMLInputElement).type === 'number') {
    return shown === '' ? Number.isNaN(v) : Number(shown) === v;
  }
  return shown === text;
}

function snapshot(b: ValueBinding): void {
  const input = b.el as HTMLInputElement;
  const start = 'selectionStart' in input ? input.selectionStart : null;
  if (start == null) {
    b.hasSelection = false; // selects, inputs without a text selection
    return;
  }
  b.hasSelection = true;
  b.selStart = start;
  b.selEnd = input.selectionEnd ?? start;
}

/**
 * A snapshot is valid for the frame it was taken in (the deferred check and the deliveries of that
 * frame use it), or until the selection changes (see onSelectionChange). Afterwards a click or arrow
 * key may have moved the caret without an input event, and a programmatic write must not jump back
 * to the last keystroke. The expiry task is queued after the event's check, so it runs after it;
 * while a deferred check is still waiting (re-armed, see runDeferred), the snapshot waits with it.
 */
function armExpiry(b: ValueBinding): void {
  if (b.expiring) return;
  b.expiring = true;
  requestMutation(b.expire);
}

function expire(b: ValueBinding): void {
  b.expiring = false;
  if (b.pending) armExpiry(b);
  else b.hasSelection = false;
}

function isHighSurrogate(c: number): boolean {
  return c >= 0xd8_00 && c <= 0xdb_ff;
}

/** `i` falls between the two halves of a surrogate pair. */
function splitsPair(s: string, i: number): boolean {
  return i > 0 && i < s.length && isHighSurrogate(s.charCodeAt(i - 1)) && (s.charCodeAt(i) & 0xfc_00) === 0xdc_00;
}

/** Length of the common suffix of `a` and `b`, never ending inside a surrogate pair. */
function commonSuffix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let n = 0;
  while (n < max && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n++;
  while (n > 0 && (splitsPair(a, a.length - n) || splitsPair(b, b.length - n))) n--;
  return n;
}

/**
 * Map a caret index from `prev` (the DOM value it was taken on) to `next`. A caret inside the common
 * tail keeps its distance from the end (a rejected or truncated edit before it puts it back where it
 * was); a caret inside the changed part keeps its index, clamped to that part. Never inside a pair.
 */
function mapCaret(i: number, prev: string, next: string, suffix: number): number {
  let j = i >= prev.length - suffix ? next.length - (prev.length - i) : Math.min(i, next.length - suffix);
  if (j < 0) j = 0;
  if (splitsPair(next, j)) j++;
  return j;
}

/** Focus is read from the element's own root (its document, or the shadow root it lives in). */
function isFocused(el: Element): boolean {
  return (el.getRootNode() as Document | ShadowRoot).activeElement === el;
}

function writeValue(b: ValueBinding, v: unknown): void {
  const el = b.el;
  const next = toText(v);
  const same = showsValue(el, v, next);
  if (b.composing) {
    // IME: writing now would break the composition. Only programmatic writes reach this point
    // (rollback checks are off while composing): remember it, compositionend applies the newest
    // value. A delivery equal to the DOM (the handler accepted composing input) changes nothing.
    if (!same) b.deferredWrite = true;
    return;
  }
  if (same) return;
  const prev = el.value;
  el.value = next;
  if (b.hasSelection && isFocused(el) && 'setSelectionRange' in el) {
    const suffix = commonSuffix(prev, next);
    const start = mapCaret(b.selStart, prev, next, suffix);
    const end = b.selEnd === b.selStart ? start : mapCaret(b.selEnd, prev, next, suffix);
    // The snapshot follows the DOM: a later write in the same frame maps from this value.
    b.selStart = start;
    b.selEnd = end;
    try {
      el.setSelectionRange(start, end);
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
    b.expiring = false;
    (b as { expire: () => void }).expire = () => expire(b);
    b.deferredWrite = false;
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

/**
 * The element the event happened on. A document listener sees events from inside a shadow root
 * retargeted at the host; the first entry of the composed path is the real target (open roots).
 * Only hosts pay for composedPath() (it allocates).
 */
function targetOf(e: Event): unknown {
  const t = e.target as Element | null;
  return t !== null && t.shadowRoot ? e.composedPath()[0] : t;
}

function onInput(e: Event): void {
  const b = lookup(valueKind, targetOf(e));
  if (!b || (e as InputEvent).isComposing || b.composing) return;
  snapshot(b);
  verify(b);
  armExpiry(b);
}

/** The deepest focused element (through open shadow roots). */
function deepActiveElement(doc: Document): Element | null {
  let active = doc.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/** Measure-time event: a caret moved by clicks or arrows refreshes a still-valid snapshot (never creates one). */
function onSelectionChange(e: Event): void {
  const target = targetOf(e);
  // Fired at the element (current engines) or at the document (older ones). No instanceof: iframes.
  const isDocument = target !== null && (target as Node).nodeType === 9; // Node.DOCUMENT_NODE
  const b = lookup(valueKind, isDocument ? deepActiveElement(target as Document) : target);
  if (b && b.hasSelection) snapshot(b);
}

function onCompositionStart(e: Event): void {
  const b = lookup(valueKind, targetOf(e));
  if (b) b.composing = true;
}

function onCompositionEnd(e: Event): void {
  const b = lookup(valueKind, targetOf(e));
  if (!b) return;
  b.composing = false;
  snapshot(b);
  armExpiry(b);
  if (b.deferredWrite) {
    // A programmatic write (Send -> setText('')) arrived during the composition: it wins over the
    // composed text. The newest authoritative value is applied and this end skips the rollback check.
    b.deferredWrite = false;
    writeValue(b, current(b));
    return;
  }
  // Deferred in both forms: handlers that skip composing input (`if (e.isComposing) return`) accept
  // the committed text in a compositionend handler, or in the input event that some engines fire
  // after compositionend — both run after this listener.
  deferCheck(b);
}

function onFocusOut(e: Event): void {
  const b = lookup(valueKind, targetOf(e));
  if (!b) return;
  b.hasSelection = false;
  // A composition cannot outlive the focus; compositionend may never come (the element was hidden
  // or removed mid-composition), which would otherwise block every later write.
  b.composing = false;
  if (b.deferredWrite) {
    b.deferredWrite = false;
    writeValue(b, current(b));
  }
}

/**
 * Checking a radio silently unchecks the previously checked one of its group (no change event
 * there), so a rejected switch must check the whole group: same name, same form owner (or, without
 * a form, the same root).
 */
function verifyRadioGroup(el: HTMLInputElement): void {
  const form = el.form;
  const candidates = form ? form.elements : (el.getRootNode() as ParentNode).querySelectorAll('input[type="radio"]');
  for (let i = 0; i < candidates.length; i++) {
    const r = candidates[i] as HTMLInputElement;
    if (r.localName !== 'input' || r.type !== 'radio' || r.name !== el.name || r.form !== form) continue;
    const b = lookup(checkedKind, r);
    if (b) verify(b);
  }
}

function onChange(e: Event): void {
  const el = targetOf(e) as HTMLInputElement;
  if (el && el.localName === 'input' && el.type === 'radio' && el.name) return verifyRadioGroup(el);
  const b = lookup(checkedKind, el);
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
  doc.addEventListener('selectionchange', onSelectionChange);
}

onClearDelegated((doc) => {
  if (!installed.has(doc)) return;
  installed.delete(doc);
  doc.removeEventListener('input', onInput);
  doc.removeEventListener('change', onChange);
  doc.removeEventListener('compositionstart', onCompositionStart);
  doc.removeEventListener('compositionend', onCompositionEnd);
  doc.removeEventListener('focusout', onFocusOut);
  doc.removeEventListener('selectionchange', onSelectionChange);
});

// ---- the directive entry (three forms, shared by value and checked) ----

const APPLY_HINTS = {
  value: ['use:value={text}', 'use:value={props.text()}'],
  checked: ['use:checked={flag}', 'use:checked={props.flag()}'],
} as const;

/**
 * The effect whose apply is running right now, or null. An apply runs with no owner; a compute runs
 * with its effect as the owner (a subtree created there is not a delivery from that effect).
 */
function applyingEffect(): EffectNode | null {
  return getOwner() === null ? getRunningEffect() : null;
}

/** DEV: an accessor reached a controlled-input directive where no binding effect can be owned. */
function reportUnownedAccessor(name: keyof typeof APPLY_HINTS, inApply: boolean): void {
  const [accessorForm, valueForm] = APPLY_HINTS[name];
  const where = inApply
    ? `inside an effect apply (a compiler-wrapped use:${name}={props.x} where props.x is a function)`
    : 'outside any owner (no component or createRoot)';
  console.error(
    `[frameact] use:${name} received an accessor ${where}, so it cannot own a binding effect: the value is written once and later changes are not followed (input is still checked against the accessor). Pass the accessor directly under an owner: ${accessorForm}, or a value: ${valueForm}.`,
  );
}

function bind<B extends Binding<any>>(kind: Kind<B>, el: Element, value: unknown): void {
  installListeners(el.ownerDocument);
  let b = lookup(kind, el);
  if (!b) kind.bindings.set(el, (b = kind.create(el)));
  const applying = applyingEffect();
  if (typeof value === 'function') {
    const accessor = value as () => unknown;
    const owned = b;
    owned.accessor = accessor; // the document-level rollback check always reads the live accessor
    owned.live = true;
    owned.effect = applying; // inside an apply: that effect's disposal releases the element
    if (getOwner() === null) {
      // No owner: inside an effect apply (the compiler wrapped `use:value={props.text}` where
      // `props.text` is itself an accessor) or imperative code outside any root. An effect created
      // here would be unowned (DEV throws inside an apply), so write once and tell the author how to
      // get a live binding.
      if (DEV) reportUnownedAccessor(kind.name, applying !== null);
      kind.write(owned, untrack(accessor));
      return;
    }
    // Static form: the directive owns the binding effect (created under the component's owner). The
    // compute returns a fresh box so the apply runs on every change and compares with the DOM: input
    // the user already typed ('abc', accepted) followed by a programmatic change back to the last
    // applied value ('ab') in the same frame must still be written.
    onCleanup(() => {
      if (kind.bindings.get(el) === owned && owned.accessor === accessor) kind.bindings.delete(el);
    });
    createMutationEffect(
      () => ({ v: accessor() }),
      ({ v }) => {
        kind.write(owned, v);
      },
      { name: `use:${kind.name}` },
    );
  } else {
    // Effect-driven form: the compiler's effect calls us with plain values; the rollback check is
    // deferred to the mutate phase (see `verify`). No allocation per delivery. Outside an apply (a
    // constant written while a subtree is created) nothing will deliver again: effect stays null.
    b.accessor = null;
    b.live = false;
    b.effect = applying;
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
