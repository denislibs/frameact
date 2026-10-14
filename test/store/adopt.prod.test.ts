// Production behaviour of adopt()'s ownership (DEV = false, the graph re-imported): the atomicity fix is
// not DEV-only, and the outside-mutation detector is — prod accepts the mutated object silently, exactly
// as the documented contract says.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
  return import('../../src/store/index');
}

it('prod: a throwing adopt leaves nothing owned — the retry walks the value again', async () => {
  const { createStore, unwrap } = await load();
  const [state, setState] = createStore<any>({ x: null, other: { v: 1 } });
  let first = true;
  const v = { a: { inner: state.other }, b: { get g() { if (first) { first = false; throw new Error('getter'); } return 1; } } };
  expect(() => setState('x', v)).toThrow('getter');
  setState('x', v);
  expect(unwrap(state.x.a.inner)).toBe(unwrap(state.other));
});

it('prod: an owned object mutated from outside is neither re-validated nor reported (the contract: adoption runs once)', async () => {
  const { createStore, unwrap } = await load();
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const [state, setState] = createStore<any>({ byId: {}, search: null });
    const msg: any = { id: 1, content: { text: 't' } };
    setState('byId', 1, msg);
    msg.content = JSON.parse('{"__proto__": {"polluted": 1}, "text": "u"}');
    setState('search', { results: [{ msg }] });
    expect(err).not.toHaveBeenCalled();
    expect(Object.hasOwn(unwrap(state.byId[1]).content, '__proto__')).toBe(true);
    expect(({} as any).polluted).toBeUndefined(); // (an own key, not a prototype change: nothing is polluted)
  } finally {
    err.mockRestore();
  }
});
