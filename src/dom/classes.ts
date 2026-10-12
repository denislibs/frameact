// Adapted from solidjs/solid packages/web/src/client.ts (MIT, © 2016-2025 Ryan Carniato);
// the extra-class helpers mirror teact's addExtraClass/removeExtraClass/toggleExtraClass
// (MIT, © 2022 Alexander Zinchuk) without its registry.
//
// Token-diff class writes (spec §3.3).
//
// The set of tokens a binding applied lives on the element (WeakMap). Every write path — `class=`,
// `classList=`, spreads — adds/removes only the tokens that changed, so imperative classes
// (addExtraClass, third-party code) survive reactive updates. `class` and `classList` are two
// independent channels; `class:x` toggles are per token and tracked by neither. The channels share
// the element's one DOM token list: a token that BOTH channels (or `class:x`) apply is removed as
// soon as either of them drops it. Keep the tokens of the channels disjoint.
//
// The same holds against the imperative helpers: a reactive `class` that drops a token removes it
// even if `addExtraClass` also added it (there is no registry that re-adds extra classes), so keep
// extra classes disjoint from the tokens a binding can produce.
//
// Tokens are separated by ASCII whitespace only (space, \t, \n, \f, \r), like the `class` attribute.

interface Applied {
  raw: unknown;
  tokens: Set<string>;
}

const classChannel = new WeakMap<Element, Applied>();
const classListChannel = new WeakMap<Element, Applied>();
const WHITESPACE = /[ \t\n\f\r]/;
const SPLIT = /[ \t\n\f\r]+/;

function addTokens(str: string, out: Set<string>): void {
  if (!str) return;
  if (!WHITESPACE.test(str)) {
    out.add(str);
    return;
  }
  for (const token of str.split(SPLIT)) if (token) out.add(token);
}

/** Collect the tokens of a class value: string | number | { token: truthy } | nested arrays; booleans/null ignored. */
export function classTokens(value: unknown, out: Set<string>): void {
  if (value == null || typeof value === 'boolean') return;
  if (typeof value === 'string') return addTokens(value, out);
  if (typeof value === 'number') return addTokens(String(value), out);
  if (Array.isArray(value)) {
    for (const item of value) classTokens(item, out);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) if (key && key !== 'undefined' && key !== 'null' && record[key]) addTokens(key, out);
  }
}

function applyTokens(node: Element, channel: WeakMap<Element, Applied>, value: unknown): void {
  const state = channel.get(node);
  // Same primitive as last time (merged effects call className unconditionally): nothing to do.
  if (state && state.raw === value && (typeof value !== 'object' || value === null)) return;
  const next = new Set<string>();
  classTokens(value, next);
  const list = node.classList;
  if (state) {
    for (const token of state.tokens) if (!next.has(token)) list.remove(token);
    for (const token of next) if (!state.tokens.has(token)) list.add(token);
    state.raw = value;
    state.tokens = next;
  } else {
    for (const token of next) list.add(token);
    channel.set(node, { raw: value, tokens: next });
  }
}

/**
 * Compiler primitive for `class=`. `prev` (the compiler's previous compute value) is accepted for
 * signature parity; the element's applied set is authoritative so spreads and `setAttribute` share it.
 */
export function className(node: Element, value: unknown, _prev?: unknown): void {
  applyTokens(node, classChannel, value);
}

/** `classList={{ token: boolean }}` — same diff, its own channel. */
export function classList(node: Element, value: unknown): void {
  applyTokens(node, classListChannel, value);
}

/** `class:name={bool}` — one binding per token. */
export function toggleClassToken(node: Element, name: string, on: boolean): void {
  if (!WHITESPACE.test(name)) {
    if (name) node.classList.toggle(name, on);
    return;
  }
  for (const token of name.split(SPLIT)) if (token) node.classList.toggle(token, on);
}

// Imperative helpers (teact API). Thin: reactive writes only touch their own tokens.
export function addExtraClass(el: Element, cls: string): void {
  el.classList.add(cls);
}
export function removeExtraClass(el: Element, cls: string): void {
  el.classList.remove(cls);
}
export function toggleExtraClass(el: Element, cls: string, force?: boolean): void {
  el.classList.toggle(cls, force);
}
