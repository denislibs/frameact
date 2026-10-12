// Adapted from solidjs/solid (MIT, © 2016-2025 Ryan Carniato): Show/Switch/Match/Dynamic from
// packages/solid/src/render/flow.ts and component.ts, Portal from packages/web/src/client.ts (2.0 branch).
// frameact: the same flow on its own core, with Portal's DOM attach going through the stricterdom seam.
import { DEV } from '../env';
import { createRenderEffect } from '../core/frame';
import type { Scope } from '../core/types';
import type { JSX } from '../jsx-runtime';
import { createMemo, createRoot, getOwner, runWithOwner, untrack } from '../index';
import { children, createComponent } from './component';
import { SVG_NS, SVGElements } from './constants';
import { insert } from './insert';
import { spread } from './props';
import { strictHooks } from './strict';
import { template } from './template';

type Falsy = undefined | null | false;
type JSXElement = JSX.Element;
type Accessor<T> = () => T;
/** A render function must take its parameter; a bare `() => Element` is already a `JSX.Element`. */
type RequiredParameter<T> = T extends () => unknown ? never : T;

const sameTruthiness = (a: unknown, b: unknown) => !a === !b;

function staleError(name: string) {
  return new Error(`[frameact] <${name}>: the narrowed accessor was read after the condition turned falsy`);
}

/**
 * `<Show when keyed fallback>`. A function child receives an accessor (non-keyed: the child is kept
 * while `when` stays truthy) or the value itself (keyed: recreated when the identity changes).
 */
export function Show<T, TRenderFunction extends (item: Accessor<NonNullable<T>>) => JSXElement>(props: {
  when: T | Falsy;
  keyed?: false;
  fallback?: JSXElement;
  children: JSXElement | RequiredParameter<TRenderFunction>;
}): JSXElement;
export function Show<T, TRenderFunction extends (item: NonNullable<T>) => JSXElement>(props: {
  when: T | Falsy;
  keyed: true;
  fallback?: JSXElement;
  children: JSXElement | RequiredParameter<TRenderFunction>;
}): JSXElement;
export function Show(props: { when: unknown; keyed?: boolean; fallback?: unknown; children: unknown }): unknown {
  const keyed = props.keyed;
  const condition = createMemo<unknown>(() => props.when, keyed ? undefined : { equals: sameTruthiness });
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
  children: unknown;
}

/** A branch of `<Switch>`: returns its props, which Switch reads. Function children are typed like `Show`'s. */
export function Match<T, TRenderFunction extends (item: Accessor<NonNullable<T>>) => JSXElement>(props: {
  when: T | Falsy;
  keyed?: false;
  children: JSXElement | RequiredParameter<TRenderFunction>;
}): JSXElement;
export function Match<T, TRenderFunction extends (item: NonNullable<T>) => JSXElement>(props: {
  when: T | Falsy;
  keyed: true;
  children: JSXElement | RequiredParameter<TRenderFunction>;
}): JSXElement;
export function Match(props: MatchProps<unknown>): unknown {
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
              if (untrack(() => switchFunc()())?.[0] !== index) throw staleError('Match');
              return conditionValue();
            },
      ),
    );
  });
}

const isComponentKey = (key: string) => key === 'component';

/**
 * `props` without the `component` key, read live: the key set follows `props` on every access (a
 * `mergeProps` with a function source is a Proxy whose keys come and go), values stay lazy getters.
 */
function omitComponent(props: Record<string, unknown>): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get: (_target, key) => (key === 'component' ? undefined : props[key as string]),
    has: (_target, key) => key !== 'component' && key in props,
    ownKeys: () => Reflect.ownKeys(props).filter((key) => key !== 'component'),
    getOwnPropertyDescriptor: (_target, key) =>
      key !== 'component' && Object.prototype.hasOwnProperty.call(props, key) && Object.prototype.propertyIsEnumerable.call(props, key)
        ? { enumerable: true, configurable: true, get: () => props[key as string] }
        : undefined,
  });
}

const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9-]*$/;

// A `<script>` made by `createElement` is live; one cloned from a parsed template carries the
// "already started" flag and stays inert (what the compiler's own `<script>` templates rely on).
const inertScript = template('<script></script>');

/**
 * `<Dynamic component={tagOrComponent} …props>`.
 *
 * TRUST: a string `component` is a tag name and a trust boundary. It must come from the author, never
 * from content: `style`, `base`, `meta`, `link`, `iframe`, `object`, `embed` are all reachable by
 * name and the attribute policy cannot help (the tag name is a key, not a value). The name is
 * validated (`/^[a-zA-Z][a-zA-Z0-9-]*$/`; anything else renders nothing, with a DEV error), and
 * `script` is created inert (cloned from a parsed template), so its text never runs.
 */
export function Dynamic(props: { component?: ((props: any) => unknown) | string | Falsy; [prop: string]: unknown }): unknown {
  return createMemo(() => {
    const component = props.component;
    if (!component) return undefined;
    if (typeof component === 'function') return untrack(() => createComponent(component, omitComponent(props)));
    if (typeof component === 'string') {
      if (!TAG_NAME.test(component)) {
        if (DEV) console.error(`[frameact] <Dynamic component="${component}">: invalid tag name, nothing is rendered.`);
        return undefined;
      }
      const node =
        component.toLowerCase() === 'script'
          ? inertScript()
          : SVGElements.has(component)
            ? document.createElementNS(SVG_NS, component)
            : document.createElement(component);
      spread(node, props, false, isComponentKey);
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
  // Compared by identity: a getter that re-runs and returns the same element must not rebuild the portal.
  const mount = createMemo<Element>(() => props.mount || document.body);
  const content = createMemo(() => [startMarker, props.children]);
  createRenderEffect<[Element, Scope | null]>(
    () => [mount(), getOwner()],
    ([m, owner]) => {
      const dispose = strictHooks.forceMutation(() => {
        m.appendChild(endMarker);
        return runWithOwner(owner, () =>
          createRoot((d) => {
            // `content` goes in as an accessor: a children change is a reconcile inside the mount, not a rebuild.
            insert(m, content, endMarker, undefined, { host: () => treeMarker.parentNode });
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
