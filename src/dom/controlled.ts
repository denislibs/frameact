import { markLiveRead, pinLive } from '../core/core';
import { getRunningEffect, isEffectClean, isEffectDisposed, type EffectNode } from '../core/effects';
import { createMutationEffect } from '../core/frame';
import { DEV } from '../env';
import { getOwner, onCleanup, untrack } from '../index';
import { getPhase, requestMutation } from '../scheduler/fasterdom';
import { defineBuiltinDirective } from './directives';
import { delegateEvents, onClearDelegated } from './events';
import { getNatives } from './natives';

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
  /** forceControlledValue cancelled a composition: its late compositionend is only checked, never trusted. */
  cancelled: boolean;
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
 *
 * Lifetime, exactly: the snapshot lives until the end of the frame of the event, plus as long as a
 * re-armed deferred check keeps expiry waiting. A delivery that arrives after that (a timer, a
 * third-party callback writing the signal later) finds no snapshot and does not restore the caret:
 * the browser places it (at the end of the new value). A handler that writes the signal in the event
 * itself, or in a microtask after it, is covered.
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
  const root = el.getRootNode() as Document | ShadowRoot;
  return (root.nodeType === 9 ? getNatives().activeElement.call(root as Document) : (root as ShadowRoot).activeElement) === el;
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
    b.cancelled = false;
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

/** The element forceControlledValue is blurring / writing / refocusing right now. */
const forcing: Element[] = []; // a stack: an app blur handler may force another field in the middle of a cycle

/**
 * Capture-phase, on the document: the commit an engine fires synchronously inside `blur()` (a
 * `compositionend` and an `input` with the old text) would otherwise reach the app's handlers and put
 * the cleared text back into the signal. Nothing below the document sees these events.
 */
function swallowWhileForcing(e: Event): void {
  const target = targetOf(e) as Element;
  if (!forcing.includes(target)) return;
  e.stopImmediatePropagation();
  if (e.type === 'compositionend') {
    const b = valueKind.bindings.get(target);
    if (b) b.cancelled = false; // the cancelled composition has ended here
  }
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
  let active = getNatives().activeElement.call(doc);
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
  if (b) {
    b.composing = true;
    b.cancelled = false; // a new composition: the cancelled one is over
  }
}

function onCompositionEnd(e: Event): void {
  const b = lookup(valueKind, targetOf(e));
  if (!b) return;
  b.composing = false;
  if (b.cancelled) {
    // The end of a composition forceControlledValue cancelled: its text must not come back. No
    // snapshot, no deferred write; the check restores the authoritative value if the engine re-inserted it.
    b.cancelled = false;
    deferCheck(b);
    return;
  }
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
  const { formElements, querySelectorAll } = getNatives(); // forms shadow `elements` / `querySelectorAll` by name
  let candidates: ArrayLike<Element>;
  if (form) candidates = formElements.call(form);
  else {
    const root = el.getRootNode();
    const query = root.nodeType === 9 ? querySelectorAll.document : root.nodeType === 11 ? querySelectorAll.fragment : querySelectorAll.element;
    candidates = (query as (this: Node, selectors: string) => NodeListOf<Element>).call(root, 'input[type="radio"]');
  }
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
let clearHooked = false;

function installListeners(doc: Document): void {
  if (installed.has(doc)) return;
  installed.add(doc);
  if (!clearHooked) {
    // Registered on first use, not at module load: this module has no top-level side effect, so an app
    // without controlled inputs does not bundle it (see registerControlledDirectives).
    clearHooked = true;
    onClearDelegated(uninstallListeners);
  }
  delegateEvents(['input'], doc);
  const { addEventListener: add } = getNatives();
  add.call(doc, 'input', swallowWhileForcing, true);
  add.call(doc, 'compositionend', swallowWhileForcing, true);
  add.call(doc, 'input', onInput);
  add.call(doc, 'change', onChange);
  add.call(doc, 'compositionstart', onCompositionStart);
  add.call(doc, 'compositionend', onCompositionEnd);
  add.call(doc, 'focusout', onFocusOut);
  add.call(doc, 'selectionchange', onSelectionChange);
}

function uninstallListeners(doc: Document): void {
  if (!installed.has(doc)) return;
  installed.delete(doc);
  const { removeEventListener: remove } = getNatives();
  remove.call(doc, 'input', swallowWhileForcing, true);
  remove.call(doc, 'compositionend', swallowWhileForcing, true);
  remove.call(doc, 'input', onInput);
  remove.call(doc, 'change', onChange);
  remove.call(doc, 'compositionstart', onCompositionStart);
  remove.call(doc, 'compositionend', onCompositionEnd);
  remove.call(doc, 'focusout', onFocusOut);
  remove.call(doc, 'selectionchange', onSelectionChange);
}

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
      () => {
        // A controlled input never waits for a heavy animation (store gate, spec §3.5 req. 7): a
        // programmatic write and the rollback of rejected input must reach the DOM now.
        markLiveRead();
        return { v: accessor() };
      },
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
    // The delivering compiler effect is pinned live: the store gate never parks it (nor the other
    // attributes of the element it groups into this effect — spec §3.5 req. 7).
    if (applying !== null) pinLive(applying);
    b.delivered = value;
    kind.write(b, value);
  }
}

/**
 * `use:value`. Known limitation: on a `<select>` the value is applied when the signal delivers it. An
 * `<option>` that is added LATER (a dynamic list that arrives after the value) is not picked up: the
 * browser has already selected another option and nothing re-applies the last delivered value, so the
 * DOM diverges from the signal until the signal changes. Options that exist at the first application
 * are fine (the compiler emits their `insert` before the `use:value` effect). Same as Solid; see
 * spec §3.3. Workaround: call `forceControlledValue(select)` (no `value`) after the list changes; it
 * re-applies the binding's current authoritative value.
 */
function valueDirective(el: Element, value: unknown): void {
  if (DEV && !('value' in el)) console.error('[frameact] use:value expects an input, textarea or select', el);
  bind(valueKind, el, value);
}

function checkedDirective(el: Element, value: unknown): void {
  if (DEV && !('checked' in el)) console.error('[frameact] use:checked expects a checkbox or radio input', el);
  bind(checkedKind, el, value);
}

/**
 * Registers the built-in `use:value` / `use:checked`. The runtime never calls it itself, so an app without
 * controlled inputs does not bundle this module. Three ways it gets called: the Vite plugin (or the exported
 * Babel plugin) injects it into every module whose compiled code contains the quoted directive name,
 * `import 'frameact/dom/controlled'` runs it as a side effect, or call it once at startup. Idempotent.
 */
export function registerControlledDirectives(): void {
  defineBuiltinDirective('value', valueDirective);
  defineBuiltinDirective('checked', checkedDirective);
}

/**
 * Explicit write-through for a control bound with `use:value`: writes `value` into the DOM at once,
 * whatever the IME is doing. For "Send -> clear the field" on Android, where every word is a
 * composition and a programmatic write would otherwise wait for `compositionend` (and lose to the
 * user's next letters). Call it after the signal already holds the value (in the plain form, where the
 * compiler's effect has not delivered yet, pass `value`).
 *
 * `value` omitted: the binding's current authoritative value (the live accessor, or the last
 * delivered plain value). The value is recorded as delivered, so no rollback or re-apply follows; a
 * deferred programmatic write and the composition state are dropped. A focused field in the middle of a
 * composition is blurred and focused again (`preventScroll`) to cancel the composition; the caret goes
 * to the end of the new value. The cancelled composition's late `compositionend` cannot bring its text
 * back: while the cycle runs, `input` and `compositionend` aimed at the element are stopped at the
 * document in the capture phase, so the commit an engine fires inside `blur()` never reaches app
 * handlers. An element without a `use:value` binding just gets `el.value = value` (and a DEV warning).
 *
 * Call it synchronously from a user event handler (click or Enter on "Send"): from an effect apply
 * (the mutate phase) `focus()` forces a layout, and without user activation iOS Safari and Android
 * Chrome do not bring the keyboard back after the refocus. DEV warns about both when a composition is
 * active. Without a composition it is a plain write, fine in any phase.
 *
 * Side effects of the cycle: the app's `blur`, `focusout`, `focus` and `focusin` handlers DO fire
 * (`relatedTarget` is null, as for any blur); `isForcingControlledValue(el)` tells them apart.
 */
export function forceControlledValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value?: unknown): void {
  const b = lookup(valueKind, el);
  if (!b) {
    if (DEV) console.warn('[frameact] forceControlledValue: the element has no use:value binding; writing el.value directly.', el);
    if (value !== undefined) el.value = toText(value);
    return;
  }
  const wasComposing = b.composing;
  const focused = isFocused(el);
  if (DEV) {
    if (wasComposing && focused) {
      const inactive = typeof navigator !== 'undefined' && (navigator as { userActivation?: { isActive: boolean } }).userActivation?.isActive === false;
      if (getPhase() === 'mutate' || inactive) {
        console.warn(
          `[frameact] forceControlledValue cancels an IME composition (blur + focus) and must run synchronously inside a user event handler (click or Enter on Send)${getPhase() === 'mutate' ? ', not from an effect apply (the mutate phase)' : ': the page has no active user activation, so a mobile browser may not bring the keyboard back'}.`,
          el,
        );
      }
    }
    if (value === undefined && b.accessor === null && b.effect !== null && !isEffectClean(b.effect)) {
      console.error(
        '[frameact] forceControlledValue(el) without `value` in the plain form: the compiler effect has not delivered the new value yet, so the stale one would be written. Pass `value` explicitly.',
        el,
      );
    }
  }
  const next = toText(value === undefined ? current(b) : value);
  b.composing = false;
  b.deferredWrite = false;
  b.cancelled = wasComposing;
  b.delivered = value === undefined ? b.delivered : value;
  b.hasSelection = false;
  const cycle = wasComposing && focused;
  forcing.push(el);
  try {
    if (cycle) el.blur(); // ends the composition: the engine commits or drops its text first
    el.value = next;
    if (cycle) el.focus({ preventScroll: true });
  } finally {
    // The engine may commit inside focus() and put the old text back; the window swallowed our own
    // listeners too, so nobody else would notice. Fix it here, and re-check next frame for a commit
    // delivered asynchronously after the cycle (covered only by this deferred check).
    if (el.value !== next) el.value = next;
    forcing.pop();
  }
  if (cycle) deferCheck(b);
  if (isFocused(el) && 'setSelectionRange' in el) {
    try {
      el.setSelectionRange(next.length, next.length);
    } catch {
      // input types without a selection API
    }
  }
}

/**
 * True while `forceControlledValue` runs its blur / write / focus cycle (for `el`, when given). An
 * app `blur` / `focusout` / `focus` / `focusin` handler uses it to tell that synthetic focus cycle
 * from the user leaving the field (draft saving, "stopped typing", closing a tooltip).
 */
export function isForcingControlledValue(el?: Element): boolean {
  return el === undefined ? forcing.length > 0 : forcing.includes(el);
}
