// DEV attribution helpers (spec §3.4): the names along an owner chain and the description of a
// node. The core keeps these here (they read `id` and the owner link) so that frame.ts and
// stricterdom share one format: `Message > MessageMeta > span.style:color`.
import { SCOPE } from './symbols';
import type { Computation, Scope } from './types';

/** Default ids the core gives unnamed nodes: they say nothing about the program and are left out. */
const GENERIC_IDS = new Set(['effect', 'computed', 'signal', 'component']);

/**
 * Names from the root owner down to `scope` itself: component names (the third argument of
 * `createComponent`, set by the compiler's `sourceNames`) and effect names (the compiler's binding
 * labels such as `div.class`, or a facade's `measure`/`mutation`/`idle`). Consecutive duplicates are
 * collapsed (an `insert` nests a second effect under the same label for function values).
 */
export function ownerPath(scope: Scope | null): string[] {
  const upward: string[] = []; // collected from the effect up to the root
  for (let s: Scope | null | undefined = scope; s != null; s = s[SCOPE]) {
    const id = (s as Computation).id;
    if (id === undefined || GENERIC_IDS.has(id)) continue;
    if (upward.length === 0 || upward[upward.length - 1] !== id) upward.push(id);
  }
  const names: string[] = [];
  for (let i = upward.length - 1; i >= 0; i--) names.push(upward[i]); // (no toReversed in lib ES2022)
  return names;
}

/** `Message > MessageMeta > span.style:color`; an unnamed effect with no named owner is `effect`. */
export function effectPath(node: Scope): string {
  const path = ownerPath(node);
  return path.length === 0 ? 'effect' : path.join(' > ');
}

/** `signal "count"`, `memo "fullName" in Message`, `effect "div.class" in Message`; null → `an unknown source`. */
export function describeNode(node: Computation | null): string {
  if (node === null) return 'an unknown source';
  // (a slim signal node has no _compute / owner fields at all: `typeof`, not `!== null`)
  const kind = node._effect === true ? 'effect' : typeof node._compute === 'function' ? 'memo' : 'signal';
  const owner = kind === 'signal' ? [] : ownerPath(node[SCOPE]);
  return `${kind} "${node.id ?? kind}"${owner.length ? ` in ${owner.join(' > ')}` : ''}`;
}

/** DEV hooks (apply hook, run/drain observers, phase listeners) must never break the core: report, and never throw even from a throwing `console.error`. */
export function reportDevHookError(what: string, error: unknown) {
  try {
    console.error(`[frameact] ${what} failed`, error);
  } catch {
    // a "fail on console.error" setup: nothing more can be done here
  }
}
