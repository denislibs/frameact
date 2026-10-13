// Ambient types for the untyped Babel packages travel with the plugin source (an `import` cannot pull in
// an ambient `declare module` file).
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./modules.d.ts" />
import { transformAsync } from '@babel/core';
import typescript from '@babel/preset-typescript';
import solid from '@solidjs/babel-plugin';
import type { Plugin } from 'vite';

export const BUILT_INS = ['For', 'Show', 'Switch', 'Match', 'Portal', 'Dynamic'] as const;

/**
 * The compiler configuration frameact pins (spec §3.6): `@solidjs/babel-plugin@2.0.0-rc.14` with
 * `moduleName: "frameact/dom"`, an explicit `builtIns` list (no Loading/Reveal/Errored/Repeat) and,
 * in dev, `sourceNames` (component and binding labels for attribution). The acceptance test compiles
 * the compiler's own fixtures with it.
 */
export function compilerOptions(dev: boolean) {
  return {
    moduleName: 'frameact/dom',
    generate: 'dom',
    hydratable: false,
    delegateEvents: true,
    builtIns: [...BUILT_INS],
    dev,
    sourceNames: dev,
    requireImportSource: false,
  };
}

export interface FrameactPluginOptions {
  /** Defaults to Vite's `!isProduction`. Dev: names for attribution, source lints. */
  dev?: boolean;
  /** Files to compile (default `/\.[jt]sx$/`). */
  include?: RegExp;
  /**
   * Files to skip (default `/node_modules/`). A custom `exclude` REPLACES the default: pass
   * `/node_modules|legacy/` to keep skipping dependencies. Virtual modules (ids starting with `\0`) are
   * always skipped.
   */
  exclude?: RegExp;
}

/**
 * Dev source lints. A scan over the JSX source, not a parser; the runtime cannot see these misuses.
 *
 * 1. `<input value={…}>` / `checked={…}` is written as a property by the compiler — only `use:value`
 *    controls it (spec §3.3). The scan walks the opening tag up to the first `>`, stepping over `=>`, so
 *    an arrow function in an earlier attribute (`onInput={e => …}`) does not end it. Literal values
 *    (`value={"x"}`, `checked={true}`, numbers, `null`) are skipped: the compiler inlines them into the
 *    template. Known false negative: a bare `>` in an earlier attribute expression
 *    (`disabled={n() > 1} value={v()}`) ends the scan early and the lint stays silent. Known false
 *    positive: a constant identifier (`value={LABEL}`) is not distinguished from a signal read.
 * 2. A static string event attribute on an intrinsic element (`<div onclick="…">`): the compiler inlines
 *    it into the template HTML, so the runtime's "no string handlers" check never sees it.
 * 3. Destructured props (trap no. 1 for a team coming from hooks): `function Chat({ isOpen })`,
 *    `const Chat = ({ isOpen }) =>`, `const Chat: FC<P> = function ({ … })` and, in a body,
 *    `const { isOpen } = props`. A component runs once, so a destructured prop is read once at creation
 *    and never updates. Only capitalised names are checked (a helper named `Format({ a })` is a
 *    known false positive; the message says so), and so is the body form inside a memo/effect compute,
 *    where the read is tracked and re-runs. A type annotation containing `=` or `=>`, or longer than 200
 *    characters, ends the declaration scan (known false negative). `props` is the conventional parameter
 *    name for the body form. The body form is skipped inside an `on*={…}` attribute: a handler reads the
 *    props fresh at event time, which is the right pattern (`onClick={() => { const { id } = props; … }}`).
 *    Comments and strings are not masked: a match in either is a known false positive.
 *
 * Every pattern is linear on any input (a missing closing token cannot make a scan run to the end of
 * the file from each start): the scans stop at the next `<` / `>` / `=` / `;` / newline or after a
 * bounded span. The price is a few more false negatives (a `<` inside the tag's attributes ends the
 * tag scan).
 */
const CONTROLLED_PROP =
  /<(input|textarea|select)\b(?:=>|[^<>])*?\s(value|checked)=\{(?!\s*(?:"[^"]{0,200}"|'[^']{0,200}'|`[^`$]{0,200}`|-?\d[\d.]*|true|false|null|undefined)\s*\})/g;
const STRING_HANDLER = /<[a-z][\w-]*\b(?:=>|[^<>])*?\s(on[A-Za-z]+)=["']/g;
const DESTRUCTURED_PARAM = /\b(?:function\s+([A-Z][\w$]*)\s*\(|(?:const|let|var)\s+([A-Z][\w$]*)\s*(?::[^=;\n]{0,200})?=\s*(?:function\s*\(|\())\s*\{/g;
const DESTRUCTURED_BODY = /\b(?:const|let|var)\s*\{[^}]{0,500}\}\s*=\s*props\b/g;
/**
 * Controlled inputs (`use:value` / `use:checked`) are not registered by the runtime (an app without them does not
 * bundle `dom/controlled.ts`), so every module that can WRITE one must run `registerControlledDirectives()` first.
 * The name of the directive reaches the runtime as a string literal (the name with its `use:` prefix, in quotes)
 * in every form: the compiler's `setAttribute` call for the JSX attribute, an object key (`mergeProps`, a JSX
 * spread), a pre-compiled library's output. Three paths look for that literal:
 * the Babel plugin below (JSX/TSX modules of the app: the AST of the compiled output, so comments do not count),
 * the plain-module scan of `transform` (`.js`/`.mjs`/`.ts`, node_modules included) and the exported
 * `registerControlledBabelPlugin` for pipelines without Vite.
 */
// Built from parts on purpose: a quoted literal in this file would make the plain-module scan register it in the plugin's own tests.
const CONTROLLED_NAMES = new Set(['value', 'checked'].map((name) => `use:${name}`));
/** The same literal in plain module text, in single or double quotes (backticks would match every doc comment). */
const CONTROLLED_LITERAL = /(["'])use:(?:value|checked)\1/;
/** A module that can take a top-level `import` (ESM). CommonJS is left alone: an `import` would turn it into a mixed module. */
const ESM_SYNTAX = /(?:^|[\n;}])[ \t]*(?:import|export)\b[\s{*"']/;
/** Plain modules the literal scan covers (the JSX pipeline handles `.jsx`/`.tsx`). */
const PLAIN_MODULE = /\.[cm]?[jt]s$/;
/** Vite asset queries: the module is a string/URL/worker wrapper, not code that runs the directive. */
const ASSET_QUERY = /[?&](?:raw|url|inline|no-inline|worker|sharedworker)(?:[&=]|$)/;

interface Lint {
  index: number;
  message: string;
}

function lintSource(code: string): Lint[] {
  const found: Lint[] = [];
  for (const match of code.matchAll(CONTROLLED_PROP)) {
    found.push({
      index: match.index,
      message: `<${match[1]} ${match[2]}={…}> is not controlled in frameact (the compiler writes the property directly). Use use:${match[2]}={accessor}.`,
    });
  }
  for (const match of code.matchAll(STRING_HANDLER)) {
    found.push({
      index: match.index,
      message: `${match[1]}="…" is a static string attribute: the compiler inlines it into the template HTML, bypassing the runtime's check. Use onClick={fn}-style handlers.`,
    });
  }
  for (const match of code.matchAll(DESTRUCTURED_PARAM)) {
    const name = match[1] ?? match[2];
    found.push({
      index: match.index,
      message: `<${name}> destructures its props: a component runs once, so a destructured prop is read at creation and never updates. Take \`props\` and read \`props.x\` where it is used (or splitProps). If ${name} is not a component, ignore this.`,
    });
  }
  for (const match of code.matchAll(DESTRUCTURED_BODY)) {
    if (insideHandlerAttribute(code, match.index)) continue;
    found.push({
      index: match.index,
      message:
        'const { … } = props reads the props once: the values never update. Read `props.x` where it is used (or splitProps). Inside an event handler this is fine (the read happens at event time); if this is one, ignore the warning.',
    });
  }
  return found;
}

/**
 * True when `index` lies inside the braces of an `on*={…}` attribute that opened before it (within
 * the last 2000 characters): its code runs at event time, not at component creation.
 */
function insideHandlerAttribute(code: string, index: number): boolean {
  const window = code.slice(Math.max(0, index - 2000), index);
  let start = -1;
  for (const open of window.matchAll(/\bon[A-Z][\w]*=\{/g)) start = open.index + open[0].length;
  if (start === -1) return false;
  let depth = 1;
  for (let i = start; i < window.length; i++) {
    const ch = window[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return false;
  }
  return true;
}

function markControlled(state: any, value: string | null | undefined): void {
  if (value != null && CONTROLLED_NAMES.has(value)) state.set('frameact.controlled', true);
}

/**
 * Babel plugin: prepend `import { registerControlledDirectives } from 'frameact/dom'; registerControlledDirectives();`
 * to a module whose (compiled) code contains the string literal for `use:value` or `use:checked`. The runtime does not
 * register the built-in controlled-input directives at load (an app without inputs does not bundle them); the call
 * runs before the module body, so the first directive write finds them.
 *
 * Put it AFTER the Solid compiler plugin (the compiler turns the JSX attribute into that string), as `babelPlugins`
 * does; the Vite plugin uses it, and so can any other Babel pipeline (Storybook, a library build, Jest). A module
 * that already imports `registerControlledDirectives` from `frameact/dom` is left alone.
 */
export function registerControlledBabelPlugin({ types: t }: { types: any }) {
  return {
    name: 'frameact-register-controlled',
    visitor: {
      StringLiteral(path: any, state: any) {
        markControlled(state, path.node.value);
      },
      TemplateLiteral(path: any, state: any) {
        if (path.node.expressions.length === 0) markControlled(state, path.node.quasis[0].value.cooked);
      },
      Program: {
        exit(path: any, state: any) {
          if (!state.get('frameact.controlled')) return;
          const registered = path.node.body.some(
            (node: any) =>
              node.type === 'ImportDeclaration' &&
              node.source.value === 'frameact/dom' &&
              node.specifiers.some((spec: any) => spec.imported?.name === 'registerControlledDirectives'),
          );
          if (registered) return;
          const local = path.scope.generateUidIdentifier('registerControlled');
          path.unshiftContainer('body', [
            t.importDeclaration([t.importSpecifier(local, t.identifier('registerControlledDirectives'))], t.stringLiteral('frameact/dom')),
            t.expressionStatement(t.callExpression(local, [])),
          ]);
        },
      },
    },
  };
}

/**
 * The Babel plugin list for a non-Vite pipeline that compiles frameact JSX: the Solid compiler with
 * `compilerOptions(dev)` and the controlled-input registration. A library built with it carries the
 * registration in its own output, so its consumers need nothing else.
 */
export function babelPlugins(dev: boolean): [[typeof solid, ReturnType<typeof compilerOptions>], typeof registerControlledBabelPlugin] {
  return [[solid, compilerOptions(dev)], registerControlledBabelPlugin];
}

/**
 * A plain module (`.js`/`.mjs`/`.ts`, a pre-compiled library in node_modules included) that contains the quoted
 * name gets the registration prepended on its first line (line numbers, hence its source map, stay valid). A
 * cheap substring test comes first; modules without the literal are not parsed or touched, and neither are
 * CommonJS modules or modules that already call it.
 */
function registerInPlainModule(code: string) {
  if (!code.includes('use:') || !CONTROLLED_LITERAL.test(code) || code.includes('registerControlledDirectives')) return null;
  if (code.startsWith('#!') || !ESM_SYNTAX.test(code)) return null;
  const local = '_frameactRegisterControlled';
  return { code: `import { registerControlledDirectives as ${local} } from 'frameact/dom';${local}();${code}`, map: null };
}

/** Rollup position (1-based line, 0-based column) of a character index; one scan for the newlines, a binary search per finding. */
function createPositioner(code: string) {
  let newlines: number[] | undefined;
  return (index: number) => {
    if (newlines === undefined) {
      newlines = [];
      for (let at = code.indexOf('\n'); at !== -1; at = code.indexOf('\n', at + 1)) newlines.push(at);
    }
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (newlines[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    return { line: lo + 1, column: index - (lo === 0 ? -1 : newlines[lo - 1]) - 1 };
  };
}

/**
 * Vite plugin: compile JSX/TSX with the Solid 2.0 compiler targeting `frameact/dom`. Client-side DOM
 * only: SSR is not supported in v1, and Vite's `ssr` transform flag is ignored (output is always DOM).
 */
export default function frameact(options: FrameactPluginOptions = {}): Plugin {
  const include = options.include ?? /\.[jt]sx$/;
  const exclude = options.exclude ?? /node_modules/;
  let dev = options.dev ?? true;
  return {
    name: 'frameact',
    enforce: 'pre',
    configResolved(config) {
      dev = options.dev ?? !config.isProduction;
    },
    async transform(code, id) {
      if (id.startsWith('\0') || ASSET_QUERY.test(id)) return null;
      const file = id.split('?')[0];
      if (!include.test(file) || exclude.test(file)) return PLAIN_MODULE.test(file) ? registerInPlainModule(code) : null;
      if (dev) {
        const lints = lintSource(code);
        const position = createPositioner(code);
        for (const lint of lints) this.warn(lint.message, position(lint.index));
      }
      const result = await transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        presets: file.endsWith('.tsx') ? [[typescript, {}]] : [],
        plugins: babelPlugins(dev),
      });
      if (!result || result.code == null) return null;
      return { code: result.code, map: result.map as any };
    },
  };
}

export { frameact };
