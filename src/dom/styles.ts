// Adapted from solidjs/solid packages/web/src/client.ts style() (MIT, © 2016-2025 Ryan Carniato);
// setExtraStyles mirrors teact (MIT, © 2022 Alexander Zinchuk).
//
// Object form: per-property diff against the declarations this binding applied (held on the
// element), so imperative styles survive. String form: `cssText` — documented as incompatible with
// `setExtraStyles` (a cssText write replaces everything).

const appliedStyles = new WeakMap<Element, Record<string, unknown>>();

type Styled = Element & { style: CSSStyleDeclaration };

/** Compiler primitive for `style=`. */
export function style(node: Element, value: unknown, prev?: unknown): void {
  const nodeStyle = (node as Styled).style;
  const applied = appliedStyles.get(node);
  if (!value) {
    if (typeof prev === 'string') nodeStyle.cssText = '';
    if (applied) {
      for (const name in applied) nodeStyle.removeProperty(name);
      appliedStyles.delete(node);
    }
    return;
  }
  if (typeof value === 'string') {
    if (applied) appliedStyles.delete(node);
    nodeStyle.cssText = value;
    return;
  }
  if (typeof prev === 'string') nodeStyle.cssText = '';
  const next: Record<string, unknown> = {};
  const obj = value as Record<string, unknown>;
  if (applied) {
    for (const name in applied) if (!(name in obj) || obj[name] == null) nodeStyle.removeProperty(name);
  }
  for (const name in obj) {
    const v = obj[name];
    if (v == null) continue;
    if (!applied || applied[name] !== v) nodeStyle.setProperty(name, String(v));
    next[name] = v;
  }
  appliedStyles.set(node, next);
}

/** Compiler primitive for `style:name=` and inline style literals. */
export function setStyleProperty(node: Element, name: string, value: unknown): void {
  const nodeStyle = (node as Styled).style;
  if (value == null) nodeStyle.removeProperty(name);
  else nodeStyle.setProperty(name, String(value));
}

/** Imperative styles (teact API): camelCase properties are assigned, `--custom` ones set; null removes. */
export function setExtraStyles(el: Element, styles: Record<string, string | number | null | undefined>): void {
  const nodeStyle = (el as Styled).style;
  for (const name in styles) {
    const v = styles[name];
    if (name.startsWith('--')) {
      if (v == null) nodeStyle.removeProperty(name);
      else nodeStyle.setProperty(name, String(v));
    } else (nodeStyle as unknown as Record<string, string>)[name] = v == null ? '' : String(v);
  }
}
