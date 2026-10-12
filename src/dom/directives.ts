import { DEV } from '../env';
import { untrack } from '../index';

/**
 * A directive receives the raw attribute expression: for `use:x={sig}` the compiler passes the
 * accessor itself (one call at creation — the directive owns any effect); for `use:x={props.v}` it
 * emits an effect that calls `setAttribute(el, 'use:x', value)` with plain values on every change.
 */
export type Directive = (el: Element, value: unknown) => void;

const registry = new Map<string, Directive>();

/** Register `use:<name>` (built-ins: `value`, `checked`). */
export function defineDirective(name: string, fn: Directive): void {
  registry.set(name, fn);
}

/** `setAttribute(el, 'use:<name>', value)` lands here. */
export function runDirective(el: Element, name: string, value: unknown): void {
  const directive = registry.get(name);
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
