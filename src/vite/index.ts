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
  /** Files to skip (default `/node_modules/`). */
  exclude?: RegExp;
}

/**
 * `<input value={…}>` is written as a property by the compiler — only `use:value` controls it (spec §3.3).
 * The scan walks the opening tag up to the first `>`, stepping over `=>`, so an arrow function in an
 * earlier attribute (`onInput={e => …}`) does not end it. Known false negative: a bare `>` in an earlier
 * attribute expression (`disabled={n() > 1} value={v()}`) ends the scan early and the lint stays silent.
 * A source lint, not a parser; the runtime cannot see this misuse at all.
 */
const CONTROLLED_PROP = /<(input|textarea|select)\b(?:=>|[^>])*?\s(value|checked)=\{/g;

/** Vite plugin: compile JSX/TSX with the Solid 2.0 compiler targeting `frameact/dom`. */
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
      const file = id.split('?')[0];
      if (!include.test(file) || exclude.test(file)) return null;
      if (dev) {
        for (const match of code.matchAll(CONTROLLED_PROP)) {
          this.warn(
            `<${match[1]} ${match[2]}={…}> is not controlled in frameact (the compiler writes the property directly). Use use:${match[2]}={accessor}.`,
          );
        }
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
