import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
beforeEach(() => {
  errors.mockClear();
  vi.resetModules(); // fresh directive registry: other files register the built-ins in their own module graph
});
afterEach(() => vi.resetModules());

it("import 'frameact/dom/controlled' registers use:value / use:checked as a side effect", async () => {
  const { runDirective } = await import('../../src/dom/directives');
  const el = document.createElement('input');
  runDirective(el, 'value', 'x');
  expect(errors).toHaveBeenCalledTimes(1); // not registered yet: the DEV hint

  await import('../../src/dom/controlledRegister');
  errors.mockClear();
  document.body.append(el);
  runDirective(el, 'value', 'typed');
  expect(el.value).toBe('typed');
  const box = document.createElement('input');
  box.type = 'checkbox';
  document.body.append(box);
  runDirective(box, 'checked', true);
  expect(box.checked).toBe(true);
  expect(errors).not.toHaveBeenCalled();
});

it('frameact/dom exports the explicit function as well (the other form of the escape hatch)', async () => {
  const dom = await import('../../src/dom/index');
  const { runDirective } = await import('../../src/dom/directives');
  dom.registerControlledDirectives();
  const el = document.createElement('input');
  document.body.append(el);
  runDirective(el, 'value', 'y');
  expect(el.value).toBe('y');
  expect(errors).not.toHaveBeenCalled();
});
