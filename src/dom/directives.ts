import { DEV } from '../env';
import { untrack } from '../index';

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
