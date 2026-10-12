import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import frameact from '../../src/vite/index.ts';

const src = (file: string) => fileURLToPath(new URL(`../../src/${file}`, import.meta.url));

// Micro-benchmarks (not part of `pnpm test`):  pnpm exec vitest run --config bench/dom/vitest.config.ts
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [frameact({ dev: false })],
  resolve: {
    alias: [
      { find: 'frameact/dom', replacement: src('dom/index.ts') },
      { find: 'frameact/jsx-runtime', replacement: src('jsx-runtime.ts') },
      { find: /^frameact$/, replacement: src('index.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['bench/dom/*.bench.test.ts'],
    setupFiles: ['test/setup.ts'],
    testTimeout: 120_000,
  },
});
