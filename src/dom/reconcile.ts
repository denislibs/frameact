// Adapted from solidjs/solid packages/web/src/reconcile.ts (MIT, © 2016-2025 Ryan Carniato),
// itself a modified https://github.com/WebReflection/udomdiff (ISC, © 2020 Andrea Giammarchi).
// frameact: structure is read and written through the prototype natives (natives.ts): a row that is
// a <form> with a descendant named `remove`, `parentNode` or `nextSibling` must not break the diff.
import { getNatives } from './natives';

/** Nodes inserted under a marker are tagged with it: a node that migrated to another slot of the same parent is not ours. */
export const SLOT: unique symbol = Symbol('frameact.slot');

/**
 * Tag a node with the slot that inserted it: its marker, or `null` for the last slot (and for root
 * mode). Always written, so a node that migrates between slots never keeps a stale tag.
 */
export function tagSlot(n: any, marker: Node | null | undefined): void {
  n[SLOT] = marker ?? null;
}

/** The native `parentNode` getter, cached on first use: `ownedBy` runs once per kept row in the prefix scan. */
let parentOf: ((this: Node) => Node | null) | undefined;

/** `undefined` tag = never inserted by a slot (static template nodes): owned by whoever holds it. */
export function ownedBy(n: any, parentNode: any, marker: any): boolean {
  if (!n || (parentOf ??= getNatives().parentNode).call(n) !== parentNode) return false;
  const tag = n[SLOT];
  return tag === undefined || tag === (marker ?? null);
}

/** Diff `a` (current nodes) → `b` (next nodes) inside `parentNode`, minimal moves. `a` must be non-empty. */
export function reconcileArrays(parentNode: any, a: any[], b: any[], marker?: Node | null): void {
  const { nextSibling, insertBefore, replaceChild, removeChild } = getNatives();
  const bLength = b.length;
  let aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    map: Map<any, number> | null = null;
  const tail = a[aEnd - 1];
  const after = ownedBy(tail, parentNode, marker) ? nextSibling.call(tail) : marker || null;

  while (aStart < aEnd || bStart < bEnd) {
    // common prefix
    if (a[aStart] === b[bStart] && ownedBy(a[aStart], parentNode, marker)) {
      aStart++;
      bStart++;
      continue;
    }
    // common suffix
    while (a[aEnd - 1] === b[bEnd - 1] && ownedBy(a[aEnd - 1], parentNode, marker)) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      // append
      let node: any;
      if (bEnd < bLength) {
        if (bStart) {
          const prev = b[bStart - 1];
          node = ownedBy(prev, parentNode, marker) ? nextSibling.call(prev) : after;
        } else node = b[bEnd - bStart];
      } else node = after;
      while (bStart < bEnd) {
        const n = b[bStart++];
        insertBefore.call(parentNode, n, node);
        tagSlot(n, marker);
      }
    } else if (bEnd === bStart) {
      // remove
      while (aStart < aEnd) {
        const n = a[aStart++];
        if ((!map || !map.has(n)) && ownedBy(n, parentNode, marker)) removeChild.call(parentNode, n);
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1] && ownedBy(a[aStart], parentNode, marker)) {
      // swap backward: walk inward with a stable front anchor
      const anchor = a[aStart];
      do {
        const n = a[--aEnd];
        insertBefore.call(parentNode, n, anchor);
        tagSlot(n, marker);
        bStart++;
        if (aStart >= aEnd - 1 || bStart >= bEnd) break;
      } while (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
    } else {
      // fallback to map
      if (!map) {
        map = new Map();
        let i = bStart;
        while (i < bEnd) map.set(b[i], i++);
      }
      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1,
            t: number | undefined;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const head = a[aStart];
            const node = ownedBy(head, parentNode, marker) ? head : after;
            while (bStart < index) {
              const n = b[bStart++];
              insertBefore.call(parentNode, n, node);
              tagSlot(n, marker);
            }
          } else {
            const oldNode = a[aStart++];
            const newNode = b[bStart++];
            if (ownedBy(oldNode, parentNode, marker)) replaceChild.call(parentNode, newNode, oldNode);
            else insertBefore.call(parentNode, newNode, after);
            tagSlot(newNode, marker);
          }
        } else aStart++;
      } else {
        const n = a[aStart++];
        if (ownedBy(n, parentNode, marker)) removeChild.call(parentNode, n);
      }
    }
  }
}

/**
 * Marks a node array as manually ordered (`<ManualFor>`): `insertExpression` then applies it with the
 * insert-only reconciler that manualFor.ts registered (`applyManualOrder`) instead of `reconcileArrays`. The
 * value is the set of rows that must be (re)inserted at their array position even though they are already in
 * the DOM (changed `orderKey`). A non-enumerable symbol property, so it is invisible to spreads and `Object.keys`.
 * Only this tag and its hook live here; the reconciler itself ships with `ManualFor`, so apps without it do not bundle it.
 */
export const MANUAL_ORDER: unique symbol = Symbol('frameact.manualOrder');

export function tagManualOrder(array: any[], moved: ReadonlySet<unknown>): void {
  Object.defineProperty(array, MANUAL_ORDER, { value: moved, configurable: true });
}

/** The set of rows to move if `array` is tagged as manually ordered. */
export function manualOrderOf(array: any[]): ReadonlySet<unknown> | undefined {
  return (array as any)[MANUAL_ORDER];
}

type ManualReconciler = (parentNode: any, prev: any[], next: any[], marker: Node | null | undefined, moved: ReadonlySet<unknown>) => void;
let manualReconciler: ManualReconciler | undefined;

/** @internal manualFor.ts registers the insert-only reconciler when the module is evaluated. */
export function setManualReconciler(fn: ManualReconciler): void {
  manualReconciler = fn;
}

/** A tagged array only exists once manualFor.ts ran (and registered); the fallback keeps the DOM right regardless. */
export function applyManualOrder(parentNode: any, prev: any[], next: any[], marker: Node | null | undefined, moved: ReadonlySet<unknown>): void {
  if (manualReconciler) manualReconciler(parentNode, prev, next, marker, moved);
  else reconcileArrays(parentNode, prev, next, marker);
}
