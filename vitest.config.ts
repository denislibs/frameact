import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// The explicit `.ts` extension keeps Vite's native config loader from warning about an extensionless import.
import frameact from './src/vite/index.ts';

const src = (file: string) => fileURLToPath(new URL(`./src/${file}`, import.meta.url));

export default defineConfig({
  plugins: [frameact({ dev: true })],
  resolve: {
    alias: [
      { find: 'frameact/dom', replacement: src('dom/index.ts') },
      { find: 'frameact/store', replacement: src('store/index.ts') },
      { find: 'frameact/jsx-runtime', replacement: src('jsx-runtime.ts') },
      { find: /^frameact$/, replacement: src('index.ts') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['test/setup.ts'],
  },
});
