// Show/Switch/Match follow solid-js's flow components (MIT, © 2016-2025 Ryan Carniato) on frameact's
// core; Portal follows solidjs/solid packages/web (2.0) with the stricterdom seam.
import { DEV } from '../env';
import { createRenderEffect } from '../core/frame';
import type { Scope } from '../core/types';
import { createMemo, createRoot, getOwner, runWithOwner, untrack } from '../index';
import { children, createComponent } from './component';
import { SVG_NS, SVGElements } from './constants';
import { insert } from './insert';
import { spread } from './props';
import { strictHooks } from './strict';

type Falsy = undefined | null | false;
type ChildOrFn = unknown | ((item: any) => unknown);

const sameTruthiness = (a: unknown, b: unknown) => !a === !b;

function staleError(name: string) {
  return new Error(`[frameact] <${name}>: the narrowed accessor was read after the condition turned falsy`);
}

/**
 * `<Show when keyed fallback>`. A function child receives an accessor (non-keyed: the child is kept
 * while `when` stays truthy) or the value itself (keyed: recreated when the identity changes).
 */
export function Show<T>(props: { when: T | Falsy; keyed?: boolean; fallback?: unknown; children: ChildOrFn }): unknown {
  const keyed = props.keyed;
  const condition = createMemo<T | Falsy>(() => props.when, keyed ? undefined : { equals: sameTruthiness });
  return createMemo(() => {
    const c = condition();
    if (c) {
      const child = props.children;
      const fn = typeof child === 'function' && child.length > 0;
      if (!fn) return child;
      return untrack(() =>
        (child as (item: unknown) => unknown)(
          keyed
            ? c
            : () => {
                if (!untrack(condition)) throw staleError('Show');
                return props.when;
              },
        ),
      );
    }
    return props.fallback;
  });
}

export interface MatchProps<T> {
  when: T | Falsy;
  keyed?: boolean;
  children: ChildOrFn;
}

/** A branch of `<Switch>`: returns its props, which Switch reads. */
export function Match<T>(props: MatchProps<T>): unknown {
  return props;
}

type Selected = [index: number, conditionValue: () => unknown, match: MatchProps<unknown>];

const noMatch = (): Selected | undefined => undefined;

/** `<Switch fallback>`: the first `<Match>` whose `when` is truthy wins. */
export function Switch(props: { fallback?: unknown; children: unknown }): unknown {
  const branches = children(() => props.children);
  const switchFunc = createMemo<() => Selected | undefined>(() => {
    const matches = branches.toArray() as MatchProps<unknown>[];
    let func: () => Selected | undefined = noMatch;
    for (let i = 0; i < matches.length; i++) {
      const index = i;
      const mp = matches[i];
      if (mp == null) continue;
      const prevFunc = func;
      const conditionValue = createMemo(() => (prevFunc() ? undefined : mp.when));
      const condition = mp.keyed ? conditionValue : createMemo(conditionValue, { equals: sameTruthiness });
      func = () => prevFunc() || (condition() ? [index, conditionValue, mp] : undefined);
    }
    return func;
  });
  return createMemo(() => {
    const selected = switchFunc()();
    if (!selected) return props.fallback;
    const [index, conditionValue, mp] = selected;
    const child = mp.children;
    const fn = typeof child === 'function' && child.length > 0;
    if (!fn) return child;
    return untrack(() =>
      (child as (item: unknown) => unknown)(
        mp.keyed
          ? conditionValue()
          : () => {
              if (untrack(switchFunc)()?.[0] !== index) throw staleError('Match');
              return conditionValue();
            },
      ),
    );
  });
}

/** Everything but `omit`, as forwarding getters (key set fixed at creation — compiled props objects are). */
function omitProp(props: Record<string, unknown>, omit: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (key !== omit) Object.defineProperty(out, key, { enumerable: true, configurable: true, get: () => props[key] });
  }
  return out;
}

/** `<Dynamic component={tagOrComponent} …props>`. */
export function Dynamic(props: { component?: ((props: any) => unknown) | string | Falsy; [prop: string]: unknown }): unknown {
  const others = omitProp(props, 'component');
  return createMemo(() => {
    const component = props.component;
    if (!component) return undefined;
    if (typeof component === 'function') return untrack(() => createComponent(component, others));
    if (typeof component === 'string') {
      const node = SVGElements.has(component) ? document.createElementNS(SVG_NS, component) : document.createElement(component);
      spread(node, others, false);
      return node;
    }
    if (DEV) console.error('[frameact] <Dynamic component={…}>: expected a component function or a tag name', component);
    return undefined;
  });
}

/**
 * `<Portal mount>`: children render into `mount` (default `document.body`) between two markers, in
 * their own root parented to the Portal's owner (context flows, disposal follows the Portal). The
 * attach is a live-DOM write at creation and goes through the stricterdom seam. Delegated events
 * from the content bubble to the Portal's logical position (`host`).
 */
export function Portal(props: { mount?: Element; children: unknown }): unknown {
  const treeMarker = document.createTextNode('');
  const startMarker = document.createTextNode('');
  const endMarker = document.createTextNode('');
  const mount = () => props.mount || document.body;
  const content = createMemo(() => [startMarker, props.children]);
  createRenderEffect<[Element, unknown, Scope | null]>(
    () => [mount(), content(), getOwner()],
    ([, c, owner]) => {
      const m = untrack(mount);
      const dispose = strictHooks.forceMutation(() => {
        m.appendChild(endMarker);
        return runWithOwner(owner, () =>
          createRoot((d) => {
            insert(m, c, endMarker, undefined, { host: () => treeMarker.parentNode });
            return d;
          }),
        )!;
      }, m);
      return () => {
        dispose();
        strictHooks.forceMutation(() => {
          // remove [startMarker, endMarker] inclusive
          let n: Node | null = startMarker;
          while (n) {
            const next: Node | null = n.nextSibling;
            if (n.parentNode === m) m.removeChild(n);
            if (n === endMarker) break;
            n = next;
          }
        }, m);
      };
    },
    { name: 'Portal' },
  );
  return treeMarker;
}
