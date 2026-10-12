import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync, types as t, type PluginObj } from '@babel/core';
import solid from '@solidjs/babel-plugin';
import * as dom from '../../src/dom/index';
import { createRoot, flushSync } from '../../src/index';
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
 * The only free identifiers that stay real: ES/DOM globals the fixtures use. Everything else, including
 * names that happen to exist on the test environment's global (vitest's `test`, `window.name`), is a stub.
 */
const REAL_GLOBALS = new Set(['__dom', '__stub', 'undefined', 'console', 'Array', 'queueMicrotask']);

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
            (name) => !REAL_GLOBALS.has(name),
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
 * coerces to the string "stub", and is never mistaken for a DOM node or an array. Because a stub
 * iterates as empty, `For` rows (the `mapArray` row mapper) are not executed here: unit tests cover them
 * (for.test.ts, forManual.test.ts).
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
  flushSync();
  dispose();
}

/**
 * DEV lints that fixtures legitimately trigger (they are diagnostics, not failures). Every other
 * `console.error` fails the test: the runtime reports a thrown effect, a broken invariant, a failed
 * scheduler task and so on through `console.error`.
 */
const DEV_LINTS = [
  /className= on an element/, // attributeExpressions compiles `className=`
  /refused an unsafe URL/,
  /is an HTML sink/,
  /string event handlers/,
];

/**
 * Fixtures whose own source throws when it is executed as a program against stubs: the compiler output
 * is right, the fixture is just not a runnable module. Each entry is the exact message (anchored, so
 * `props.children is not a function` or `dynamic.children …` still fail) and the number of times it
 * must fire per run, so the exemption cannot go stale silently. `insertChildren`: `{children()()}`
 * compiles to `_$insert(el, () => children()())`, and `children` is a DOM node, not a function
 * (`{children()}` alone compiles to `_$insert(el, children)` and does not call it).
 */
const FIXTURE_USER_ERRORS: Record<string, { message: RegExp; count: number }> = {
  insertChildren: { message: /(?<![\w$.])children is not a function$/, count: 1 },
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
      const exempt = FIXTURE_USER_ERRORS[name];
      const exempted = errors.filter((message) => exempt?.message.test(message));
      if (exempt) expect(exempted, `${name}: the documented fixture error must fire exactly ${exempt.count}x`).toHaveLength(exempt.count);
      expect(errors.filter((message) => !exempted.includes(message) && !DEV_LINTS.some((lint) => lint.test(message)))).toEqual([]);
    });
  }
});

it('covers the full fixture set of the pinned compiler', () => {
  expect(fixtures.length).toBe(17);
  expect(fixtures).toContain('attributeExpressions');
  expect(fixtures).toContain('components');
});
