// Store/core micro-benchmarks: each bench/store/*.bench.ts is bundled with the production runtime
// (`process.env.NODE_ENV` defined as production → DEV = false, one module: no test-runner import
// shims on the hot path) and run in its own `node --expose-gc` process. Plain Vite (no frameact
// plugin: the benches are .ts, not JSX), so the same files run on any baseline worktree.
//   node bench/store/run.mjs [filter]
import { build } from 'vite';
import { spawnSync } from 'node:child_process';
import { readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = fileURLToPath(new URL('.', import.meta.url));
const out = join(dir, '.out');
mkdirSync(out, { recursive: true });
const filter = process.argv[2] ?? '';
const files = readdirSync(dir).filter((f) => f.endsWith('.bench.ts') && f.includes(filter));
for (const f of files) {
  const name = f.replace(/\.ts$/, '');
  await build({
    configFile: false,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': '"production"' },
    build: {
      lib: { entry: join(dir, f), formats: ['es'], fileName: () => `${name}.mjs` },
      outDir: out,
      emptyOutDir: false,
      minify: false,
      target: 'esnext',
      rolldownOptions: { external: ['jsdom', /^node:/] },
    },
  });
  process.stdout.write(`\n## ${f}\n`);
  const r = spawnSync(process.execPath, ['--expose-gc', join(out, `${name}.mjs`)], { stdio: 'inherit' });
  if (r.status !== 0) process.exitCode = 1;
}
