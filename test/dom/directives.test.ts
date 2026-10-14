import { defineBuiltinDirective, defineDirective, runDirective } from '../../src/dom/directives';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

it('a user directive cannot take a built-in name, before or after the built-in is registered', () => {
  const el = document.createElement('input');
  const user = vi.fn();
  defineDirective('value', user); // reserved even though nothing is registered yet
  expect(errors).toHaveBeenCalledTimes(1);
  const builtin = vi.fn();
  defineBuiltinDirective('value', builtin);
  defineDirective('value', user);
  expect(errors).toHaveBeenCalledTimes(2);
  runDirective(el, 'value', 1);
  expect(builtin).toHaveBeenCalledWith(el, 1);
  expect(user).not.toHaveBeenCalled();
});

it('checked is reserved too', () => {
  defineDirective('checked', vi.fn());
  expect(errors).toHaveBeenCalledTimes(1);
});

it('a built-in registered after a user directive of another name does not disturb it', () => {
  const el = document.createElement('div');
  const mine = vi.fn();
  defineDirective('mine', mine);
  defineBuiltinDirective('checked', vi.fn());
  runDirective(el, 'mine', 2);
  expect(mine).toHaveBeenCalledWith(el, 2);
  expect(errors).not.toHaveBeenCalled();
});

it('redefining a registered user directive is a DEV error and keeps the first', () => {
  const el = document.createElement('div');
  const first = vi.fn();
  const second = vi.fn();
  defineDirective('twice', first);
  defineDirective('twice', second);
  expect(errors).toHaveBeenCalledTimes(1);
  runDirective(el, 'twice', 3);
  expect(first).toHaveBeenCalledWith(el, 3);
  expect(second).not.toHaveBeenCalled();
});

it('prototype-looking names are plain names', () => {
  const el = document.createElement('div');
  runDirective(el, 'constructor', 1);
  runDirective(el, '__proto__', 1);
  expect(errors).toHaveBeenCalledTimes(2);
});

it('use:value / use:checked before registration: a dev error that names registerControlledDirectives, nothing runs', async () => {
  vi.resetModules(); // a fresh registry: earlier tests in this file registered built-ins
  const { runDirective: runFresh } = await import('../../src/dom/directives');
  const el = document.createElement('input');
  runFresh(el, 'checked', true);
  expect(errors).toHaveBeenCalledTimes(1);
  expect(String(errors.mock.calls[0][0])).toContain("registerControlledDirectives() from 'frameact/dom'");
  expect(String(errors.mock.calls[0][0])).toContain('use:checked');
  runFresh(el, 'tooltip', 1); // an unknown user directive keeps its own message
  expect(String(errors.mock.calls[1][0])).toContain("defineDirective('tooltip', fn)");
});
