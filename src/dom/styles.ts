// Adapted from solidjs/solid packages/web/src/client.ts style() (MIT, © 2016-2025 Ryan Carniato);
// setExtraStyles mirrors teact (MIT, © 2022 Alexander Zinchuk).
//
// Object form: per-property diff against the declarations this binding applied (held on the
// element), so imperative styles survive. String form: `cssText` — documented as incompatible with
// `setExtraStyles` (a cssText write replaces everything). The binding's state lives on the element
// (the object it applied, or the string), so `style(el, null)`, string -> object transitions and a
// repeated identical string work without the caller's `prev` (spread calls pass it unreliably).
//
// Interactions: a property the object form drops is removed from the element even if `style:x` or
// `setExtraStyles` also set it; and the "unchanged" check compares with what the binding last wrote,
// not with the DOM, so an imperative overwrite of a bound property lives until the binding's value
// for it changes. Keep bound and imperative properties disjoint.
//
// Names are CSS property names (kebab-case or `--custom`): `style={{ fontSize }}` is ignored by the
// CSSOM, as in Solid (DEV hint). `setExtraStyles` is the odd one out and takes camelCase (teact).
// A trailing `!important` in a value is passed as the priority; numbers get no `px`.

import { DEV } from '../env';

// string = the cssText this binding wrote; object = the declarations it applied.
const appliedStyles = new WeakMap<Element, string | Record<string, unknown>>();

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

/** Compiler primitive for `style=`. */
export function style(node: Element, value: unknown, prev?: unknown): void {
  const nodeStyle = (node as Styled).style;
  const applied = appliedStyles.get(node);
  if (!value) {
    if (typeof applied === 'string' || typeof prev === 'string') nodeStyle.cssText = '';
    if (applied !== undefined) {
      if (typeof applied === 'object') for (const name of Object.keys(applied)) nodeStyle.removeProperty(name);
      appliedStyles.delete(node);
    }
    return;
  }
  if (typeof value === 'string') {
    if (applied === value) return;
    nodeStyle.cssText = value;
    appliedStyles.set(node, value);
    return;
  }
  const previous = typeof applied === 'object' ? applied : undefined;
  if (typeof applied === 'string' || typeof prev === 'string') nodeStyle.cssText = '';
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

/** Imperative styles (teact API): camelCase properties are assigned, `--custom` ones set; null removes. */
export function setExtraStyles(el: Element, styles: Record<string, string | number | null | undefined>): void {
  const nodeStyle = (el as Styled).style;
  for (const name of Object.keys(styles)) {
    const v = styles[name];
    if (name.startsWith('--')) {
      if (v == null) nodeStyle.removeProperty(name);
      else nodeStyle.setProperty(name, String(v));
    } else (nodeStyle as unknown as Record<string, string>)[name] = v == null ? '' : String(v);
  }
}
