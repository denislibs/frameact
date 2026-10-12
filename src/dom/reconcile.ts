// Adapted from solidjs/solid packages/web/src/reconcile.ts (MIT, © 2016-2025 Ryan Carniato),
// itself a modified https://github.com/WebReflection/udomdiff (ISC, © 2020 Andrea Giammarchi).

/** Nodes inserted under a marker are tagged with it: a node that migrated to another slot of the same parent is not ours. */
export const SLOT: unique symbol = Symbol('frameact.slot');

/**
 * Tag a node with the slot that inserted it: its marker, or `null` for the last slot (and for root
 * mode). Always written, so a node that migrates between slots never keeps a stale tag.
 */
export function tagSlot(n: any, marker: Node | null | undefined): void {
  n[SLOT] = marker ?? null;
}

/** `undefined` tag = never inserted by a slot (static template nodes): owned by whoever holds it. */
export function ownedBy(n: any, parentNode: any, marker: any): boolean {
  if (!n || n.parentNode !== parentNode) return false;
  const tag = n[SLOT];
  return tag === undefined || tag === (marker ?? null);
}

/** Diff `a` (current nodes) → `b` (next nodes) inside `parentNode`, minimal moves. `a` must be non-empty. */
export function reconcileArrays(parentNode: any, a: any[], b: any[], marker?: Node | null): void {
  const bLength = b.length;
  let aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    map: Map<any, number> | null = null;
  const tail = a[aEnd - 1];
  const after = ownedBy(tail, parentNode, marker) ? tail.nextSibling : marker || null;

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
          node = ownedBy(prev, parentNode, marker) ? prev.nextSibling : after;
        } else node = b[bEnd - bStart];
      } else node = after;
      while (bStart < bEnd) {
        const n = b[bStart++];
        parentNode.insertBefore(n, node);
        tagSlot(n, marker);
      }
    } else if (bEnd === bStart) {
      // remove
      while (aStart < aEnd) {
        const n = a[aStart++];
        if ((!map || !map.has(n)) && ownedBy(n, parentNode, marker)) n.remove();
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1] && ownedBy(a[aStart], parentNode, marker)) {
      // swap backward: walk inward with a stable front anchor
      const anchor = a[aStart];
      do {
        const n = a[--aEnd];
        parentNode.insertBefore(n, anchor);
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
              parentNode.insertBefore(n, node);
              tagSlot(n, marker);
            }
          } else {
            const oldNode = a[aStart++];
            const newNode = b[bStart++];
            if (ownedBy(oldNode, parentNode, marker)) parentNode.replaceChild(newNode, oldNode);
            else parentNode.insertBefore(newNode, after);
            tagSlot(newNode, marker);
          }
        } else aStart++;
      } else {
        const n = a[aStart++];
        if (ownedBy(n, parentNode, marker)) n.remove();
      }
    }
  }
}

/**
 * Marks a node array as manually ordered (`For order="manual"`): `insertExpression` then applies it with
 * `reconcileManual` (insert-only) instead of `reconcileArrays`. The value is the set of rows that must
 * be (re)inserted at their array position even though they are already in the DOM (changed `orderKey`).
 * A non-enumerable symbol property, so it is invisible to spreads and `Object.keys`.
 */
export const MANUAL_ORDER: unique symbol = Symbol('frameact.manualOrder');

export function tagManualOrder(array: any[], moved: ReadonlySet<unknown>): void {
  Object.defineProperty(array, MANUAL_ORDER, { value: moved, configurable: true });
}

/** The set of rows to move if `array` is tagged as manually ordered. */
export function manualOrderOf(array: any[]): ReadonlySet<unknown> | undefined {
  return (array as any)[MANUAL_ORDER];
}

/**
 * Insert-only counterpart of `reconcileArrays`. `next` lists the slot's nodes in DOM order, except
 * for new nodes (placed at their list index) and the `moved` ones. Kept, unmoved nodes are never
 * touched (no `remove`, `replaceChild` or `insertBefore`); a contiguous run of nodes to insert goes
 * before one anchor (the next kept node, else the marker); a `moved` node is moved exactly once.
 * `prev` must be non-empty. A kept node that is out of DOM order despite not being listed in `moved`
 * (the memo ran ahead of the applied DOM) is moved too: correctness first.
 */
export function reconcileManual(
  parentNode: any,
  prev: any[],
  next: any[],
  marker: Node | null | undefined,
  moved: ReadonlySet<unknown>,
): void {
  const nextSet = new Set<any>(next);
  const prevIndex = new Map<any, number>();
  for (let i = 0; i < prev.length; i++) {
    const n = prev[i];
    if (!nextSet.has(n)) {
      if (ownedBy(n, parentNode, marker)) n.remove();
    } else if (ownedBy(n, parentNode, marker)) prevIndex.set(n, i);
  }
  // Stable nodes: already in the DOM, not moved, in increasing DOM order. Walking backwards gives
  // every position the anchor to insert before.
  const length = next.length;
  const stable: boolean[] = [];
  let last = -1;
  for (let i = 0; i < length; i++) {
    const n = next[i];
    const at = prevIndex.get(n);
    stable[i] = at !== undefined && at > last && !moved.has(n);
    if (stable[i]) last = at!;
  }
  const anchors: (Node | null)[] = [];
  let anchor: Node | null = marker ?? null;
  for (let i = length - 1; i >= 0; i--) {
    anchors[i] = anchor;
    if (stable[i]) anchor = next[i];
  }
  for (let i = 0; i < length; i++) {
    if (stable[i]) continue;
    const n = next[i];
    parentNode.insertBefore(n, anchors[i]);
    tagSlot(n, marker);
  }
}
