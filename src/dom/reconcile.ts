// Adapted from solidjs/solid packages/web/src/reconcile.ts (MIT, © 2016-2025 Ryan Carniato),
// itself a modified https://github.com/WebReflection/udomdiff (ISC, © 2020 Andrea Giammarchi).

/** Nodes inserted under a marker are tagged with it: a node that migrated to another slot of the same parent is not ours. */
export const SLOT: unique symbol = Symbol('frameact.slot');

function ownedBy(n: any, parentNode: any, marker: any): boolean {
  if (!n) return false;
  const tag = n[SLOT];
  return n.parentNode === parentNode && (!tag || tag === marker);
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
        if (marker) n[SLOT] = marker;
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
        if (marker) n[SLOT] = marker;
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
              if (marker) n[SLOT] = marker;
            }
          } else {
            const oldNode = a[aStart++];
            const newNode = b[bStart++];
            if (ownedBy(oldNode, parentNode, marker)) parentNode.replaceChild(newNode, oldNode);
            else parentNode.insertBefore(newNode, after);
            if (marker) newNode[SLOT] = marker;
          }
        } else aStart++;
      } else {
        const n = a[aStart++];
        if (ownedBy(n, parentNode, marker)) n.remove();
      }
    }
  }
}
