/**
 * Simulate what a browser does to a `<form>` with a descendant named `name` (`<input name>` or any
 * `<img id>`): jsdom does not implement form named properties, so the test defines what
 * `[LegacyOverrideBuiltIns]` presents — an own, non-writable, non-enumerable data property (an
 * assignment to it throws in strict mode).
 */
export function clobber(form: HTMLFormElement, name: string, value: unknown = document.createElement('img')): void {
  Object.defineProperty(form, name, { value, writable: false, enumerable: false, configurable: true });
}

/** A `<form>` whose listed built-ins are all shadowed by one `<img>` child. */
export function clobberedForm(...names: string[]): HTMLFormElement {
  const form = document.createElement('form');
  const img = document.createElement('img');
  form.appendChild(img);
  for (const name of names) clobber(form, name, img);
  return form;
}
