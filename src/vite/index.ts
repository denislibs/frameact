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
 *    where the read is tracked and re-runs. A type annotation containing `=` or `=>` ends the declaration
 *    scan (known false negative). `props` is the conventional parameter name for the body form.
 */
const CONTROLLED_PROP =
  /<(input|textarea|select)\b(?:=>|[^>])*?\s(value|checked)=\{(?!\s*(?:"[^"]*"|'[^']*'|`[^`$]*`|-?\d[\d.]*|true|false|null|undefined)\s*\})/g;
const STRING_HANDLER = /<[a-z][\w-]*\b(?:=>|[^>])*?\s(on[A-Za-z]+)=["']/g;
const DESTRUCTURED_PARAM = /\b(?:function\s+([A-Z][\w$]*)\s*\(|(?:const|let|var)\s+([A-Z][\w$]*)\s*(?::[^=]*)?=\s*(?:function\s*\(|\())\s*\{/g;
const DESTRUCTURED_BODY = /\b(?:const|let|var)\s*\{[^}]*\}\s*=\s*props\b/g;

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
    found.push({
      index: match.index,
      message: 'const { … } = props reads the props once: the values never update. Read `props.x` where it is used (or splitProps).',
    });
  }
  return found;
}

/** Rollup position (1-based line, 0-based column) of a character index. */
function position(code: string, index: number) {
  let line = 1;
  let last = -1;
  for (let at = code.indexOf('\n'); at !== -1 && at < index; at = code.indexOf('\n', at + 1)) {
    line++;
    last = at;
  }
  return { line, column: index - last - 1 };
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
      if (id.startsWith('\0')) return null;
      const file = id.split('?')[0];
      if (!include.test(file) || exclude.test(file)) return null;
      if (dev) {
        for (const lint of lintSource(code)) this.warn(lint.message, position(code, lint.index));
      }
      const result = await transformAsync(code, {
        filename: file,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        presets: file.endsWith('.tsx') ? [[typescript, {}]] : [],
        plugins: [[solid, compilerOptions(dev)]],
      });
      if (!result || result.code == null) return null;
      return { code: result.code, map: result.map as any };
    },
  };
}

export { frameact };
