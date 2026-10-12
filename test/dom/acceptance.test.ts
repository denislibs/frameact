import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync, types as t, type PluginObj } from '@babel/core';
import solid from '@solidjs/babel-plugin';
import * as dom from '../../src/dom/index';
import { createRoot } from '../../src/index';
import { compilerOptions } from '../../src/vite/index';

// Not `new URL('./fixtures/', import.meta.url)`: under the jsdom environment that URL is not a file: URL.
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtures = readdirSync(fixturesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

function compileFixture(name: string, dev: boolean): string {
  const file = join(fixturesDir, name, 'code.js');
  const result = transformSync(readFileSync(file, 'utf8'), {
    filename: file,
    babelrc: false,
    configFile: false,
    plugins: [[solid, compilerOptions(dev)]],
  });
  return result!.code!;
}

// `let`: fixtures assign to their free identifiers (`ref={el => (e = el)}`) and the compiler itself
// emits `r = _el$` for non-function refs.
const stubCall = (name: string) =>
  t.variableDeclaration('let', [
    t.variableDeclarator(t.identifier(name), t.callExpression(t.identifier('__stub'), [t.stringLiteral(name)])),
  ]);

/**
 * Compiled module → function body: `import { x as _$x } from "frameact/dom"` becomes
 * `const _$x = __dom.x`; every other import and every free identifier becomes `__stub(name)`.
 */
function toFunctionBody(code: string): { body: string; domImports: string[] } {
  const domImports: string[] = [];
  const rewrite = (): PluginObj => ({
    visitor: {
      Program: {
        exit(path) {
          const body = path.node.body;
          for (let i = body.length - 1; i >= 0; i--) {
            const node = body[i];
            if (!t.isImportDeclaration(node)) continue;
            const decls: t.Statement[] = [];
            for (const specifier of node.specifiers) {
              const local = specifier.local.name;
              if (node.source.value === 'frameact/dom' && t.isImportSpecifier(specifier)) {
                const imported = t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value;
                domImports.push(imported);
                decls.push(
                  t.variableDeclaration('const', [
                    t.variableDeclarator(t.identifier(local), t.memberExpression(t.identifier('__dom'), t.identifier(imported))),
                  ]),
                );
              } else decls.push(stubCall(local));
            }
            body.splice(i, 1, ...decls);
          }
          path.scope.crawl();
          const globals = Object.keys(path.scope.globals).filter(
            (name) => name !== '__dom' && name !== '__stub' && !(name in globalThis),
          );
          body.unshift(...globals.map(stubCall));
        },
      },
    },
  });
  const out = transformSync(code, { babelrc: false, configFile: false, sourceType: 'module', plugins: [rewrite] });
  return { body: out!.code!, domImports };
}

/** The Proxy target: a function, so a stub is callable and constructible. */
function stubTarget() {}

/**
 * A value that survives whatever compiled output does with a free identifier: callable (two levels
 * deep, so accessor unwrapping terminates), constructible, has any property, iterates as empty,
 * coerces to the string "stub", and is never mistaken for a DOM node or an array.
 */
function makeStub(name: string, depth = 0): any {
  const cache = new Map<PropertyKey, unknown>();
  return new Proxy(stubTarget, {
    apply: () => (depth < 2 ? makeStub(`${name}()`, depth + 1) : undefined),
    construct: () => ({}),
    get(fn, key) {
      if (key === 'prototype') return fn.prototype;
      if (key === Symbol.toPrimitive) return () => 'stub';
      if (key === Symbol.iterator) return function* () {};
      if (typeof key === 'symbol' || key === 'then' || key === 'nodeType' || key === 'name') return undefined;
      if (key === 'length') return 0;
      let value = cache.get(key);
      if (value === undefined) cache.set(key, (value = makeStub(`${name}.${String(key)}`, depth)));
      return value;
    },
    set: () => true,
    has: (_fn, key) => key === 'prototype',
    ownKeys: () => ['prototype'],
    getOwnPropertyDescriptor: (fn, key) => (key === 'prototype' ? Reflect.getOwnPropertyDescriptor(fn, key) : undefined),
  });
}

function runModule(body: string): void {
  // oxlint-disable-next-line no-new-func
  const fn = new Function('__dom', '__stub', body) as (d: unknown, s: unknown) => void;
  const dispose = createRoot((d) => {
    fn.call(undefined, dom, makeStub);
    return d;
  });
  dispose();
}

/** Our own runtime error reports (effects, drains, cleanups, list rows) — unlike dev lint messages, these mean something threw. */
const RUNTIME_ERROR = /Error in effect|entry failed|onCleanup failed|row mapper|keyFn/;

/**
 * Fixtures whose own source throws when it is executed as a program against stubs: the compiler output
 * is right, the fixture is just not a runnable module. Each entry must match the exact message and
 * say why. `insertChildren`: `const children = <div/>; … {children()}` calls a DOM node.
 */
const FIXTURE_USER_ERRORS: Record<string, RegExp> = {
  insertChildren: /children is not a function/,
};

describe.each([false, true])('compiler acceptance (dev=%s)', (dev) => {
  for (const name of fixtures) {
    it(`${name}: every import exists in frameact/dom and the compiled module runs`, () => {
      const { body, domImports } = toFunctionBody(compileFixture(name, dev));
      for (const imported of domImports) {
        expect(typeof (dom as Record<string, unknown>)[imported], `frameact/dom.${imported}`).toBe('function');
      }
      const errors: string[] = [];
      const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errors.push(args.map(String).join(' '));
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        runModule(body);
      } finally {
        error.mockRestore();
        warn.mockRestore();
        log.mockRestore();
        dom.clearDelegatedEvents();
        document.body.textContent = '';
      }
      expect(
        errors.filter((message) => RUNTIME_ERROR.test(message) && !FIXTURE_USER_ERRORS[name]?.test(message)),
      ).toEqual([]);
    });
  }
});

it('covers the full fixture set of the pinned compiler', () => {
  expect(fixtures.length).toBe(17);
  expect(fixtures).toContain('attributeExpressions');
  expect(fixtures).toContain('components');
});
