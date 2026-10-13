// Adapted from solidjs/solid packages/web/src/client.ts (MIT, © 2016-2025 Ryan Carniato);
// the extra-class helpers mirror teact's addExtraClass/removeExtraClass/toggleExtraClass
// (MIT, © 2022 Alexander Zinchuk) without its registry.
//
// Token-diff class writes (spec §3.3).
//
// The set of tokens a binding applied lives on the element (two symbol properties). Every write path — `class=`,
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

/**
 * The tokens a channel applied: `''` (none), one token (a string: the common case — `class={sel ? 'danger' : ''}`
 * on every row of a list — costs no Set) or a Set of two or more.
 */
type Tokens = string | Set<string>;

/**
 * A channel's state lives on the element under two symbol keys (the raw value last applied and its
 * tokens) — not in a WeakMap: a WeakMap's backing table grows with every element ever bound and never
 * shrinks (after five create/clear cycles of 1000 rows a 64 kB table stayed behind), and a symbol
 * property costs a slot in the wrapper's property array that `tagSlot` has already allocated. Symbols
 * cannot be clobbered by content (named properties shadow string names only).
 */
const CLASS_RAW = Symbol('frameact.class');
const CLASS_TOKENS = Symbol('frameact.class.tokens');
const CLASS_LIST_RAW = Symbol('frameact.classList');
const CLASS_LIST_TOKENS = Symbol('frameact.classList.tokens');
type Channel = Element & { [CLASS_RAW]?: unknown; [CLASS_TOKENS]?: Tokens; [CLASS_LIST_RAW]?: unknown; [CLASS_LIST_TOKENS]?: Tokens };

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

/** The canonical `Tokens` of a value: a string for zero or one token, a Set only for two or more. */
function tokensOf(value: unknown): Tokens {
  if (typeof value === 'string' && !WHITESPACE.test(value)) return value;
  if (value == null || typeof value === 'boolean') return '';
  const set = new Set<string>();
  classTokens(value, set);
  if (set.size > 1) return set;
  for (const token of set) return token;
  return '';
}

function hasToken(tokens: Tokens, token: string): boolean {
  return typeof tokens === 'string' ? tokens === token : tokens.has(token);
}

/**
 * Diff `prev` → `next` on the element's token list. `node.classList` is read only when a token is
 * actually added or removed: reading it makes the engine allocate a DOMTokenList (and the element's
 * rare data) per element, which a list of rows whose class is mostly `''` never needs.
 */
function applyTokens(node: Element, RAW: typeof CLASS_RAW | typeof CLASS_LIST_RAW, TOKENS: typeof CLASS_TOKENS | typeof CLASS_LIST_TOKENS, value: unknown): void {
  const el = node as Channel;
  const prev = el[TOKENS];
  // Same primitive as last time (merged effects call className unconditionally): nothing to do.
  if (prev !== undefined && el[RAW] === value && (typeof value !== 'object' || value === null)) return;
  const next = tokensOf(value);
  if (prev === undefined || typeof prev === 'string') {
    if (prev && !hasToken(next, prev)) node.classList.remove(prev);
  } else {
    for (const token of prev) if (!hasToken(next, token)) node.classList.remove(token);
  }
  if (typeof next === 'string') {
    if (next && (prev === undefined || !hasToken(prev, next))) node.classList.add(next);
  } else {
    for (const token of next) if (prev === undefined || !hasToken(prev, token)) node.classList.add(token);
  }
  el[RAW] = value;
  el[TOKENS] = next;
}

/**
 * Compiler primitive for `class=`. `prev` (the compiler's previous compute value) is accepted for
 * signature parity; the element's applied set is authoritative so spreads and `setAttribute` share it.
 */
export function className(node: Element, value: unknown, _prev?: unknown): void {
  applyTokens(node, CLASS_RAW, CLASS_TOKENS, value);
}

/** `classList={{ token: boolean }}` — same diff, its own channel. */
export function classList(node: Element, value: unknown): void {
  applyTokens(node, CLASS_LIST_RAW, CLASS_LIST_TOKENS, value);
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
