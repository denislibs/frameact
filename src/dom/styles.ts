// Adapted from solidjs/solid packages/web/src/client.ts style() (MIT, © 2016-2025 Ryan Carniato);
// setExtraStyles mirrors teact (MIT, © 2022 Alexander Zinchuk).
//
// Object form: per-property diff against the declarations this binding applied (held on the
// element), so imperative styles survive. String form: `cssText` replaces every declaration, so the
// extra styles set through `setExtraStyles` are kept in a per-element registry and re-applied after
// every cssText write (teact's `updateStyle` parity): a `<div style={props.style}>` whose
// `Transition`/`restoreHeight` sets `height` imperatively keeps that height across style updates.
// The binding's state lives on the element (the object it applied, or the string), so
// `style(el, null)`, string -> object transitions and a repeated identical string work without the
// caller's `prev` (spread calls pass it unreliably).
//
// Interactions: a property the object form drops is removed from the element even if `style:x` or
// `setExtraStyles` also set it; and the "unchanged" check compares with what the binding last wrote,
// not with the DOM, so an imperative overwrite of a bound property lives until the binding's value
// for it changes. Keep bound and imperative properties disjoint (the registry only guards against
// cssText, i.e. the string form).
//
// Names are CSS property names (kebab-case or `--custom`): `style={{ fontSize }}` is ignored by the
// CSSOM, as in Solid (DEV hint). `setExtraStyles` is the odd one out and takes camelCase (teact),
// translated to the CSS name and written with `setProperty`.
// A trailing `!important` in a value is passed as the priority; numbers get no `px`.

import { DEV } from '../env';

// string = the cssText this binding wrote; object = the declarations it applied.
const appliedStyles = new WeakMap<Element, string | Record<string, unknown>>();
// The extra styles in force per element (CSS property name → value), re-applied after cssText writes.
// A Map, not a record: names come from data-driven objects and must not touch a prototype (own keys only, as above).
const extraStyles = new WeakMap<Element, Map<string, string | number>>();

type Styled = Element & { style: CSSStyleDeclaration };

const IMPORTANT = /\s*!important\s*$/i;
// Properties where a bare number is valid CSS.
const UNITLESS =
  /^(?:--|opacity$|z-index$|flex(?:-grow|-shrink)?$|order$|line-height$|font-weight$|zoom$|scale$|aspect-ratio$|columns?$|column-count$|orphans$|widows$|tab-size$|animation-iteration-count$|grid-(?:row|column|area)|.*-opacity$|stroke-(?:miterlimit|width|dashoffset)$)/;
const hinted = new Set<string>();

function hintOnce(key: string, message: string): void {
  if (hinted.has(key)) return;
  hinted.add(key);
  console.error(message);
}

function writeProperty(nodeStyle: CSSStyleDeclaration, name: string, value: unknown): void {
  if (DEV) {
    if (name.startsWith('--')) {
      if (typeof value === 'string' && value.includes(';')) {
        hintOnce(`;${name}`, `[frameact] style: the value of ${name} contains ";" — it can inject declarations when the style attribute is re-parsed.`);
      }
    } else if (!name.includes('-') && name !== name.toLowerCase()) {
      hintOnce(`c${name}`, `[frameact] style: "${name}" is not a CSS property name and is ignored; use the kebab-case "${name.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}" (only setExtraStyles takes camelCase).`);
    }
    if (typeof value === 'number' && value !== 0 && !UNITLESS.test(name)) {
      hintOnce(`n${name}`, `[frameact] style: "${name}: ${value}" is a number without a unit and is ignored; write "${value}px" or similar.`);
    }
  }
  const text = String(value);
  if (IMPORTANT.test(text)) nodeStyle.setProperty(name, text.replace(IMPORTANT, ''), 'important');
  else nodeStyle.setProperty(name, text);
}

/**
 * The CSS property name for a `setExtraStyles` key: camelCase → kebab-case (`WebkitTransform`,
 * `webkitTransform` → `-webkit-transform`, `cssFloat` → `float`); `--custom` and names that already
 * have a dash pass through. Names are written with `setProperty`, never assigned as JS properties of
 * the declaration: a key like `cssText` or `setProperty` from data stays a (rejected) CSS name.
 */
function cssName(name: string): string {
  if (name.startsWith('--') || name.includes('-')) return name;
  if (name === 'cssFloat') return 'float';
  if (name === name.toLowerCase()) return name;
  const kebab = name.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return /^(?:webkit|moz|ms)-/.test(kebab) ? `-${kebab}` : kebab;
}

function writeExtra(nodeStyle: CSSStyleDeclaration, name: string, v: string | number | null | undefined): void {
  if (v == null) nodeStyle.removeProperty(name);
  else nodeStyle.setProperty(name, String(v));
}

/** `cssText = value`, then the element's extra styles on top (a cssText write drops every declaration). */
function writeCssText(node: Element, value: string): void {
  const nodeStyle = (node as Styled).style;
  nodeStyle.cssText = value;
  const extra = extraStyles.get(node);
  if (extra !== undefined) for (const [name, v] of extra) writeExtra(nodeStyle, name, v);
}

/** Compiler primitive for `style=`. */
export function style(node: Element, value: unknown, prev?: unknown): void {
  const nodeStyle = (node as Styled).style;
  const applied = appliedStyles.get(node);
  if (!value) {
    if (typeof applied === 'string' || typeof prev === 'string') writeCssText(node, '');
    if (applied !== undefined) {
      if (typeof applied === 'object') for (const name of Object.keys(applied)) nodeStyle.removeProperty(name);
      appliedStyles.delete(node);
    }
    return;
  }
  if (typeof value === 'string') {
    if (applied === value) return;
    writeCssText(node, value);
    appliedStyles.set(node, value);
    return;
  }
  const previous = typeof applied === 'object' ? applied : undefined;
  if (typeof applied === 'string' || typeof prev === 'string') writeCssText(node, '');
  const next: Record<string, unknown> = {};
  const obj = value as Record<string, unknown>;
  if (previous) {
    for (const name of Object.keys(previous)) if (!Object.hasOwn(obj, name) || obj[name] == null) nodeStyle.removeProperty(name);
  }
  for (const name of Object.keys(obj)) {
    const v = obj[name];
    if (v == null) continue;
    if (!previous || previous[name] !== v) writeProperty(nodeStyle, name, v);
    next[name] = v;
  }
  appliedStyles.set(node, next);
}

/** Compiler primitive for `style:name=` and inline style literals. */
export function setStyleProperty(node: Element, name: string, value: unknown): void {
  const nodeStyle = (node as Styled).style;
  if (value == null) nodeStyle.removeProperty(name);
  else writeProperty(nodeStyle, name, value);
}

/**
 * Imperative styles (teact API): camelCase (or kebab-case, or `--custom`) names, written with
 * `setProperty` under the CSS property name (so a key that is not a CSS property, `cssText` or
 * `setProperty` included, does nothing); null/undefined removes. Names are constants of your code,
 * not data. The declarations accumulate in a per-element registry (teact replaces the registry on
 * every call; here `setExtraStyles(el, { transition })` then `setExtraStyles(el, { height })` keeps
 * both) and are re-applied after every string `style=` write.
 */
export function setExtraStyles(el: Element, styles: Record<string, string | number | null | undefined>): void {
  const nodeStyle = (el as Styled).style;
  let extra = extraStyles.get(el);
  for (const key of Object.keys(styles)) {
    const name = cssName(key);
    const v = styles[key];
    if (v == null) extra?.delete(name);
    else {
      if (extra === undefined) extraStyles.set(el, (extra = new Map()));
      extra.set(name, v);
    }
    writeExtra(nodeStyle, name, v);
  }
}
