import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// `DEV` is read from process.env.NODE_ENV when src/env.ts loads: re-import the whole graph in prod mode.
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  const env = await import('../../src/env');
  expect(env.DEV).toBe(false);
  const { createComponent } = await import('../../src/dom/component');
  const api = await import('../../src/index');
  return { createComponent, ...api };
}

it('prod: provideContext in a component body does not leak to sibling components', async () => {
  const { createComponent, createRoot, createContext, provideContext, useContext } = await load();
  const Ctx = createContext('default');
  let seenByB: string | undefined;
  createRoot(() => {
    createComponent(() => { provideContext(Ctx, 'A'); return null; }, {});
    createComponent(() => { seenByB = useContext(Ctx); return null; }, {});
  });
  expect(seenByB).toBe('default');
});

it('prod: onCleanup order matches DEV (component cleanups run when the surrounding root is disposed)', async () => {
  const { createComponent, createRoot, onCleanup } = await load();
  const log: string[] = [];
  const dispose = createRoot((d) => {
    onCleanup(() => log.push('root'));
    createComponent(() => { onCleanup(() => log.push('A')); return null; }, {});
    createComponent(() => { onCleanup(() => log.push('B')); return null; }, {});
    return d;
  });
  dispose();
  expect(log).toEqual(['B', 'A', 'root']);
});

it('prod: memo without an owner (a compiled prop getter read in an apply) derives live, as in DEV', async () => {
  const { createRoot, createEffect, createSignal } = await load();
  const { memo } = await import('../../src/dom/component');
  const { flushMicrotasks } = await import('../helpers/micro');
  const [s, setS] = createSignal('a');
  const props = { get error() { return memo(() => !!s())() ? `err:${s()}` : s(); } };
  const log: unknown[] = [];
  createRoot(() => { createEffect(() => s(), () => { log.push(props.error); }); });
  await flushMicrotasks();
  setS('b');
  await flushMicrotasks();
  expect(log).toEqual(['err:a', 'err:b']);
});
