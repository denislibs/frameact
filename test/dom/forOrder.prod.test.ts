import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// `DEV` is read from process.env.NODE_ENV when src/env.ts loads: re-import in prod mode.
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('prod: <For order="manual"> fails loudly with a short message instead of rendering with keyed semantics', async () => {
  const { DEV } = await import('../../src/env');
  expect(DEV).toBe(false);
  const { For } = await import('../../src/dom/list');
  const ForC = For as unknown as (props: Record<string, unknown>) => unknown;
  let message = '';
  try {
    ForC({ each: [1], order: 'manual', children: () => document.createElement('li') });
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toContain('ManualFor');
  expect(message.length).toBeLessThan(80);
  // an ordinary For is unaffected
  expect(() => ForC({ each: [1], children: () => document.createElement('li') })).not.toThrow();
});
