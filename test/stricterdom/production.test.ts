// @vitest-environment node
// The DEV-only claim, checked on a real production build: an app that calls the whole
// frameact/stricterdom surface keeps none of the detectors, the observer, the profiler or the
// core's attribution fields — only the thin wrappers.
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';

const src = (file: string) => fileURLToPath(new URL(`../../src/${file}`, import.meta.url));

const ENTRY = `
import { enableStrict, disableStrict, forceMeasure, forceMutation, suppressStrict, setHandler, enableRunLog, getRunStats } from ${JSON.stringify(src('stricterdom/index.ts'))};
import { createMemo, createMutationEffect, createSignal, flushSync } from ${JSON.stringify(src('index.ts'))};
enableStrict();
setHandler(() => {});
enableRunLog();
const [a, setA] = createSignal(0);
const doubled = createMemo(() => a() * 2);
createMutationEffect(() => doubled(), (v) => {
  forceMeasure(() => v);
  forceMutation(() => v, document.body);
  suppressStrict(() => v);
});
setA(1);
flushSync();
console.log(getRunStats());
disableStrict();
`;

/** The app above as a virtual module. */
const entryPlugin: Plugin = {
  name: 'entry',
  resolveId: (id) => (id.endsWith('virtual:app') ? '\0app' : null), // (lib mode resolves the entry against the root first)
  load: (id) => (id === '\0app' ? ENTRY : null),
};

async function bundle(mode: 'production' | 'development'): Promise<string> {
  const out = (await build({
    configFile: false,
    logLevel: 'silent',
    mode,
    plugins: [entryPlugin],
    define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
    build: { write: false, minify: false, lib: { entry: 'virtual:app', formats: ['es'], fileName: 'app' } },
  })) as { output: { code: string }[] }[];
  return out[0].output[0].code;
}

const DEV_ONLY = ['MutationObserver', 'Unexpected measurement', 'getBoundingClientRect', 'Slow effect run', 'performance.now', 'stampNotify', '_dirtyDep', 'effectPath'];

it('a production build keeps none of stricterdom, the profiler or the core attribution (a dev build keeps all)', async () => {
  const prod = await bundle('production');
  const dev = await bundle('development');
  expect(DEV_ONLY.filter((s) => prod.includes(s))).toEqual([]);
  expect(DEV_ONLY.filter((s) => !dev.includes(s))).toEqual([]);
  expect(prod).toContain('function forceMeasure'); // the thin wrappers stay
}, 30_000);
