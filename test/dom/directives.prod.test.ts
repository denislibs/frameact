import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// `DEV` is read from process.env.NODE_ENV when src/env.ts loads: re-import in prod mode.
const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
beforeEach(() => {
  errors.mockClear();
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('prod: an unregistered use:value / use:checked is reported once per directive name, in a short message; other misses stay silent', async () => {
  const { DEV } = await import('../../src/env');
  expect(DEV).toBe(false);
  const { runDirective } = await import('../../src/dom/directives');
  const el = document.createElement('input');
  runDirective(el, 'value', 'a');
  runDirective(el, 'value', 'b');
  expect(errors).toHaveBeenCalledTimes(1);
  const message = String(errors.mock.calls[0][0]);
  expect(message).toContain('use:value');
  expect(message).toContain('registerControlledDirectives');
  expect(message.length).toBeLessThan(100);
  runDirective(el, 'checked', true);
  runDirective(el, 'checked', false);
  expect(errors).toHaveBeenCalledTimes(2);
  expect(String(errors.mock.calls[1][0])).toContain('use:checked');
  runDirective(el, 'tooltip', 1); // an unknown user directive: no prod message (unchanged)
  expect(errors).toHaveBeenCalledTimes(2);
  expect(el.value).toBe('');
});

it('prod: once registered, nothing is reported', async () => {
  const { registerControlledDirectives } = await import('../../src/dom/controlled');
  const { runDirective } = await import('../../src/dom/directives');
  registerControlledDirectives();
  const el = document.createElement('input');
  document.body.append(el);
  runDirective(el, 'value', 'ok');
  expect(el.value).toBe('ok');
  expect(errors).not.toHaveBeenCalled();
});
