// Tree-shaking guard: a production build of an app bundles the controlled-input machinery and the
// heavy-animation gate only when the app uses them (the runtime registers neither at load).
import { resolve } from 'node:path';
import { build, type Rollup } from 'vite';
import frameact from '../../src/vite/index';

// vitest runs from the repository root (vitest.config.ts); import.meta.url is rewritten under vitest, so paths are cwd-based.
const src = (file: string) => resolve('src', file);
const fixture = (name: string) => resolve('test/vite/fixtures/treeshake', name);

/** Production IIFE bundle of one fixture (unminified: the assertions are on identifiers and string literals). */
async function bundle(name: string): Promise<string> {
  const result = (await build({
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [frameact({ dev: false })],
    resolve: {
      alias: [
        { find: 'frameact/dom', replacement: src('dom/index.ts') },
        { find: 'frameact/jsx-runtime', replacement: src('jsx-runtime.ts') },
        { find: /^frameact$/, replacement: src('index.ts') },
      ],
    },
    build: {
      write: false,
      minify: false,
      target: 'esnext',
      rollupOptions: { input: fixture(name), output: { format: 'iife' } },
    },
  })) as Rollup.RollupOutput;
  return result.output[0].code;
}

it('an app without controlled inputs or heavy animations bundles neither; one that uses them does', async () => {
  const plain = await bundle('plain.jsx');
  expect(plain).toContain('template(');
  expect(plain).not.toContain('compositionend'); // dom/controlled.ts
  expect(plain).not.toContain('registerControlledDirectives');
  expect(plain).not.toContain('isBlockingAnimating'); // scheduler/heavyAnimation.ts
  expect(plain).not.toContain('requestIdleCallback'); // scheduler onIdle (only onFullyIdle uses it)
  expect(plain).not.toContain('[frameact] use:'); // DEV strings are dead in prod

  const inputs = await bundle('inputs.jsx');
  expect(inputs).toContain('compositionend');
  expect(inputs).toContain('registerControlledDirectives');
  expect(inputs).not.toContain('isBlockingAnimating');

  const animation = await bundle('animation.jsx');
  expect(animation).toContain('isBlockingAnimating');
  expect(animation).not.toContain('compositionend');
}, 30_000);

it('manual-order lists are bundled only through <ManualFor>: an app with just <For> has no reconcileManual / orderKey code', async () => {
  const plain = await bundle('plain.jsx'); // uses <For>
  expect(plain).toContain('mapArray');
  expect(plain).not.toContain('reconcileManual');
  expect(plain).not.toContain('orderKey failed'); // manualFor.ts
  const manual = await bundle('manual.jsx');
  expect(manual).toContain('reconcileManual');
  expect(manual).toContain('orderKey failed');
}, 30_000);
