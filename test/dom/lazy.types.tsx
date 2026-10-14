// Type-level tests for `lazy`: checked by `pnpm typecheck` (never run). `@ts-expect-error` lines MUST error.
import { lazy } from 'frameact/dom';

interface OwnProps {
  name: string;
  count?: number;
}
const Named = (props: OwnProps) => <b>{props.name}</b>;
const NoProps = () => <i />;
const bundle = Promise.resolve({ Named, NoProps, default: Named });

// 1. default export: props inferred from the component
const LazyDefault = lazy(() => bundle);
// 2. named export re-wrapped as default (the `loadBundle(...).then((m) => ({ default: m.X }))` form)
const LazyNamed = lazy(() => bundle.then((m) => ({ default: m.Named })));
// 3. a component without props
const LazyNoProps = lazy(() => bundle.then((m) => ({ default: m.NoProps })));

export function accepted() {
  return [
    <LazyDefault name="a" />,
    <LazyDefault name="a" count={1} />,
    <LazyNamed name="a" />,
    <LazyNoProps />,
  ];
}

export function rejected() {
  return [
    // @ts-expect-error missing required prop
    <LazyDefault />,
    // @ts-expect-error wrong prop type
    <LazyNamed name={1} />,
    // @ts-expect-error unknown prop
    <LazyNamed name="a" extra />,
    // @ts-expect-error a component without props takes none
    <LazyNoProps name="a" />,
  ];
}

export async function preloads() {
  const C = await LazyNamed.preload();
  return C({ name: 'a' });
}

// 4. the explicit form stays accepted
const LazyExplicit = lazy<OwnProps>(() => bundle.then((m) => ({ default: m.Named })));
const LazyExplicitNone = lazy<Record<string, never>>(() => bundle.then((m) => ({ default: m.NoProps })));
export function explicit() {
  return [
    <LazyExplicit name="a" />,
    <LazyExplicitNone />,
    // @ts-expect-error missing required prop
    <LazyExplicit />,
  ];
}

// 5. an optional props parameter, a generic component (its parameter instantiates to unknown, as on main) and an
//    untyped loader (`Promise<any>`): accepted, as before the overloads
const Optional = (props?: { size?: number }) => <i>{props?.size}</i>;
const Generic = <T,>(props: { item: T; render: (t: T) => string }) => <i>{props.render(props.item)}</i>;
const more = Promise.resolve({ Optional, Generic });
const LazyOptional = lazy(() => more.then((m) => ({ default: m.Optional })));
const LazyGeneric = lazy(() => more.then((m) => ({ default: m.Generic })));
const LazyUntyped = lazy(() => Promise.resolve() as Promise<any>);
export function edges() {
  return [
    <LazyOptional size={1} />,
    <LazyOptional />,
    <LazyGeneric item={1} render={String} />,
    <LazyUntyped />,
    <LazyUntyped anything />,
    // @ts-expect-error wrong prop type
    <LazyOptional size="x" />,
    // @ts-expect-error missing required prop
    <LazyGeneric item={1} />,
  ];
}
