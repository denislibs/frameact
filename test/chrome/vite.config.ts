import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
// The `.ts` extension keeps Vite's native config loader from warning (as in the root vitest.config.ts); this file
// is inside tsconfig's `include`, where an explicit `.ts` import is TS5097 without allowImportingTsExtensions.
// @ts-expect-error TS5097 — Vite bundles the config, the extension is fine at runtime
import frameact from '../../src/vite/index.ts';

const src = (file: string) => fileURLToPath(new URL(`../../src/${file}`, import.meta.url));

/** The headless-Chrome lane: a dev build (DEV = true, sourceNames on) of test/chrome/main.tsx. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  mode: 'development',
  plugins: [frameact({ dev: true })],
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
  resolve: {
    alias: [
      { find: 'frameact/dom/controlled', replacement: src('dom/controlledRegister.ts') },
      { find: 'frameact/dom', replacement: src('dom/index.ts') },
      { find: 'frameact/stricterdom', replacement: src('stricterdom/index.ts') },
      { find: 'frameact/jsx-runtime', replacement: src('jsx-runtime.ts') },
      { find: /^frameact$/, replacement: src('index.ts') },
    ],
  },
  build: { outDir: 'dist', emptyOutDir: true, minify: false, target: 'es2022' },
  logLevel: 'warn',
});
